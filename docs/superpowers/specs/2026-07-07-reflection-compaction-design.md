# 反思库压缩整理设计

日期：2026-07-07
分支：待建（feat/reflection-compaction）

## 背景与目标

被动反思(`reflection-poller`)只增不减：每判定一条有效客服回答就 `insertKbEntry(doc='human-reflection')`，无去重、无淘汰。结果反思条目持续累积。

**危害澄清**：`kb_search` 每次固定返回 top-5，反思库涨大不会直接抬高每次检索的 token。真正代价是：

1. **质量稀释**——近义重复的反思条目挤占 top-5，把权威的基础文档(`docs/kb`)挤出结果。
2. **体积膨胀**——DB 与向量表无界增长。
3. **过时/矛盾**——早期反思可能已被后来更新的基础文档覆盖或与之冲突，仍被检索命中。

**目标**：定时对 `doc='human-reflection'` 条目做一次压缩整理——近义合并、剔除被基础文档覆盖或与之矛盾的条目——自动应用并通知管理群。整个过程是旁路观察者，失败绝不阻断主链路，且带安全底线防止误清空。

现状实测(2026-07-07)：反思 89 条 ≈3.8k tokens(一次 LLM 调用装得下)；基础文档 9675 chunks ≈393k tokens(不可整喂)。

## 剔除标准（已定）

- **近义合并**：语义相近的多条反思合并为一条规范 FAQ。
- **被基础文档覆盖**：`docs/kb` 正式文档已讲清该问题 → 删冗余反思。
- **矛盾/失效**：与更新的反思或基础文档冲突的旧条目 → 删。
- **不做**纯年龄淘汰(未选)。

## 架构总览

```
setInterval(compactMs) ── registerReflectionCompactor (running 防重入)
                                     │
                                     ▼  runCompact 一轮
   1. 载入全部 human-reflection 条目(id/content/ts)
       └─ 少于 minEntries(默认 10) → 跳过
   2. 取权威上下文:逐条对基础文档做向量检索(searchBaseKb, doc!=human-reflection)
       top-3 → 汇总去重
   3. 单次 LLM 调用(无工具):输入=权威基础片段 + 现有反思条目(带序号)
       产出=整理后的反思条目集(合并/删除后的存活集)
   4. 安全底线校验(见下) → 通过才继续
   5. 整体替换(单事务):删旧 human-reflection chunks+vecs → 插入整理后条目(逐条 embed)
       source = human-reflection:0:{now}(gid 0 = 已压缩,全局归属)
   6. 通知管理群:反思整理:89 → M 条(合并/删 X)
```

模块 `lib/agent/reflection-compactor.ts`，结构与 `reflection-poller.ts` 对齐(`resolve` + `runCompact` 供测试直驱 + `registerReflectionCompactor` 返回 teardown)。

## 组件

### lib/agent/reflection-compactor.ts（新增）

- `CompactorDeps`：`{ repo, adminGroupId, compactMs?, minEntries?, embed?, queryFn?, now? }`。
- `runCompact(deps)`：执行一轮，供测试直驱。
- `registerReflectionCompactor(deps)`：`setInterval` + `running` 防重入门(照抄 poller，上一轮未结束跳过本 tick)，返回 `() => clearInterval`。
- `COMPACT_SYSTEM`：整理指令。硬约束：**只能基于给定条目合并/删除，不得新增事实、不得引入基础片段以外的新知识**；权威基础片段仅用于判断哪些反思已被覆盖/矛盾，不应被当作反思重新写回。输出规格：一个 JSON 数组 `[{"faq":"..."}]`，无可保留输出 `[]`（配合安全底线，空集视为异常而非清空）。

### lib/db/repo.ts（新增方法）

- `searchBaseKb(query: Float32Array, k: number): KbHit[]`：向量近邻，过滤 `c.doc != 'human-reflection'`。因 vec0 的 KNN 需固定 `k`，实现取较大 `k*4` 再 join 后过滤反思、截取前 `k`。
- `replaceReflectionEntries(oldIds: number[], entries: {content: string; embedding: Float32Array}[], sourceTs: number): void`：单事务内按快照 id 删除 `DELETE FROM kb_vec WHERE chunk_id IN (oldIds)` → `DELETE FROM kb_chunks WHERE id IN (oldIds)` → 逐条 `insertKbChunk('human-reflection', content, 'human-reflection:0:'+sourceTs)` + `insertKbVec`。只删 `oldIds`(压缩起始快照)而非按 doc,避免误删压缩 await 期间 poller 并发新增的反思。空 `entries` 由调用方在安全底线拦截。

### lib/config-store.ts（新增字段）

- `reflectCompactMs: number`(env `REFLECT_COMPACT_MS`，默认 `86400000` = 每日一次)。
- `reflectCompactMinEntries: number`(env `REFLECT_COMPACT_MIN_ENTRIES`，默认 `10`)。
- 常开(无独立开关)；`REFLECT_COMPACT_MS<=0` 视为关闭(assemble 不注册)。

### lib/assemble.ts / lib/runtime.ts（接线）

- `assemble` 在注册 reflection-poller 后，若 `reflectCompactMs > 0` 注册 `registerReflectionCompactor`，纳入 teardown 列表。
- `runtime.start` 透传 `reflectCompactMs`、`reflectCompactMinEntries`。

## 安全底线（自动应用必备）

`runCompact` 在替换前校验 LLM 产出，任一不满足 → **保留旧库不动**并 `bus.emit('error.occurred', { scope: 'reflection-compact', ... })`：

- JSON 解析失败 / 非数组。
- 空集(`length === 0`)而输入非空 —— 防一次坏输出清空知识库。
- 条目数暴涨：`length > 输入条数 * 1.5` —— 防 LLM 无视约束新增。
- 逐条 `faq` 非空字符串，过滤空白项后仍须非空。

用户选择「自动应用 + 通知」而非备份，故不建备份表；安全底线是替代性防护。

## 数据流与幂等

- 压缩后 source 统一 `human-reflection:0:{ts}`，`reflectionEntries()` 正则 `human-reflection:(\d+):(\d+)` 仍匹配(gid=0)。管理页/统计将该批显示为 groupId 0（已压缩，全局归属）。
- 下一轮压缩把上一轮产物当普通反思再整理，天然幂等：稳定后无可合并/删除则产出≈输入，`replaceReflectionEntries` 重写同内容(可接受；或可加“无变化则跳过”优化，非必须)。
- 与 reflection-poller 并发：两者都是旁路、各自 `running` 门。compactor 整体替换 human-reflection 期间，poller 可能正好 `insertKbEntry` 追加一条 —— `replaceReflectionEntries` 只按快照 id 删除（不按 doc），故该新增条目不会被误删，未纳入本轮整理，下一轮补上。

## 错误处理

- 任何步骤抛错 → `emit error.occurred { scope: 'reflection-compact' }`，不推进、不替换，下一轮重试。
- LLM 调用与 poller 同款:`maxTurns:1`、`canUseTool` 全 deny、`permissionMode:'default'`、`settingSources:['user']`、`env: sdkEnv()`。模型走 CLAUDE_CONFIG_DIR/settings.json 的 `env.ANTHROPIC_MODEL`(同当前配置，不特地指定)。

## 测试（reflection-compactor.test.ts）

- 少于 minEntries → 跳过，不调 LLM，库不变。
- 正常整理:seed 若干近义反思 → 假 query 返回合并后集 → 库被替换为新集、发管理群通知、source 为 `human-reflection:0:*`。
- 安全底线:LLM 返回 `[]` / 非法 JSON / 暴涨集(> ×1.5) → 旧库保留、emit error、不替换。
- `searchBaseKb` 只返回非反思条目。
- 防重入:假计时器 + 卡 gate 慢 query，验证 in-flight 时下一 tick 跳过(照抄 poller 的守卫测试)。
- 幂等:对已压缩集(gid 0)再跑一轮,产出≈输入不报错。

## YAGNI（明确不做）

- 纯年龄淘汰（未选）。
- 管理页新增手动触发按钮 / 压缩历史面板。
- 被删/被合并原条目的备份表（用安全底线替代）。
- 逐条 id 追踪 diff（整体替换更简单）。
- 独立启停开关（`REFLECT_COMPACT_MS<=0` 即关）。
