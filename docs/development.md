# 开发与代码质量

## 环境与验证

Node 版本见 `.node-version`，pnpm 版本见 `package.json` 的 `packageManager`。
使用 `pnpm install --frozen-lockfile` 安装，保证本地与 CI 采用相同依赖。

提交前运行 `pnpm check`，执行 TypeScript、ESLint 和完整 Vitest 测试。
涉及页面、路由或打包边界时，还应运行生产构建；本机已有服务时使用
`NEXT_DIST_DIR=.next-verify pnpm build`，避免覆盖正在服务的 `.next`。
GitHub Actions 会在 PR 和 main 推送时执行检查与构建。

浏览器验证使用临时数据库、独立 Claude 配置目录，清空 QQ/TG 连接参数并关闭
知识库预热与主动回复，避免开发检查触发真实客服应答。配置页至少检查：修改、
切换标签后保留草稿、保存、刷新回读、请求失败后重试。

## 分层结构

`lib/` 已按能力分五层，单向依赖，只准从上往下：

```
    runtime.ts          # 组合根,接通道 + agent + 后台循环
        ↓
   conversation         # 会话与编排
        ↓
  ┌─────┴─────┐
channels   knowledge    # 通道实现 / 知识库与反思(同级,互不依赖)
  └─────┬─────┘
        ↓
      model             # SDK 调用与模型 I/O
        ↓
       core             # 无依赖的纯工具与地基:db、config、日志、总线、通道词汇、UI 展示纯函数
```

- 新增消息通道写 `lib/channels/<通道>/`；新增 Agent 能力写 `lib/conversation/`；
  新增知识库能力写 `lib/knowledge/`。
- `core` 是无依赖的纯工具与地基：除 db、config、日志、总线、通道词汇外，还含
  UI 展示所需的纯函数（`cn()`、`brand`、`channel-labels`、`format-duration`、
  `group-name` hook），这是「`components/` 只可依赖 `core`」这条约束的落点。
  展示工具多到 5 个以上再考虑另立 `lib/format/`（需同步 `layering.test.ts` 映射表）。
- 后台运营与商业化页面写 `app/admin/`；鉴权、品牌、存储等横切能力进 `core/`。
- `app/` 可依赖全部；`components/` 只可依赖 `core` 与 `components/` 自身。
- 规则由 `tests/architecture/layering.test.ts` 执行，不靠自觉。跨层依赖会直接让测试失败。

## 模块边界

- `app/` 负责页面编排和 HTTP 输入输出。路由文件只导出框架支持的处理函数与配置，
  不把校验规则导出给业务模块或测试使用。
- `components/admin/config/` 按功能维护配置区块；`use-config-form.ts` 持有唯一草稿，
  管理数据请求与保存。区块组件不自行持久化，切换标签不会丢失修改。
- `lib/core/config/schema.ts` 定义完整配置、默认值和类型，`AppConfig` 与 `GroupPolicy`
  从 schema 推导。页面使用类型导入，避免把数据库和运行时依赖带入浏览器。
- `lib/core/config/env.ts` 将环境变量转换为种子，`migrate.ts` 处理旧格式兼容，
  `chats.ts` 维护通道引用规范化，`patch.ts` 定义接口更新语义。
- `lib/core/config-store.ts` 负责配置读写及存量导入兼容，依赖 `lib/core/config/` 下的各模块、
  `lib/core/db/repositories/config.ts`，以及 `lib/core/chat/enabled-chats.ts`。新增纯业务规则应放在
  专门模块，便于脱离 Next.js 与数据库测试。
- `lib/core/db/repositories/` 按领域维护 SQL，`Repo` 保留兼容转发，各领域共享连接与事务。
  类型、事务边界和扩展方式见 [数据访问层](data-access.md)。
- `lib/core/db/migrations/` 集中注册并按版本执行结构升级；发布前检查、备份与恢复流程见
  [数据库迁移与备份](database-operations.md)。

## 扩展配置

1. 在 `appConfigSchema` 添加字段、校验、默认值及必要的中文说明，类型与 HTTP
   补丁规则自动跟随。若有环境变量入口，在 `env.ts` 添加对应映射。
2. 在相应配置区块添加编辑控件；数值与时长转换使用现有表单工具。
3. 将新字段接入实际消费者，例如 `runtime.ts` / `assemble.ts`；仅能保存还不算功能完成。
4. 增加业务边界测试，特别是默认值、旧配置缺字段、局部更新与运行时行为。

更新语义必须保持一致：

- 未提交或 `undefined` 的字段表示不修改；不要在局部补丁中补默认值。
- 掩码或空字符串密钥表示保留旧密钥，响应只返回掩码。
- 群策略对象整份替换该群覆盖；`null` 或空对象清除该群覆盖，其他群保持原样。
- 管理面与客服生效会话互斥；使用 `channel + chatId` 比较，TG ID 保留字符串。
- 扫描周期至少 1000ms，最多 `2 ** 31 - 1` ms，避免 Node 将非法周期解释为 1ms。
  升格周期允许 0 关闭，历史负数也按关闭处理。
- 主动回复有更保守的专属边界：扫描间隔至少 10 秒、静默阈值至少 30 秒，单轮最多
  发送 10 条主动回复；候选判定预算最多 50 个。这些限制由 schema 和服务端同时执行。
- `maxReplyChars=0` 表示不拆分；`resumeTtlMs=0` 表示关闭续接过期。
- 参数校验错误通常返回 400；请求体超限返回 413，鉴权/限速、资源冲突和运行时依赖
  按路由语义返回 401/403/429、404/409、503 或 500。读取旧库和环境变量时按字段回退
  种子，保留其他有效值。
- `dbPath` 是部署级存储边界的只读例外：管理 API 拒绝在线切换，迁移必须停机、备份并
  在部署环境修改 `DB_PATH`。

## 反思升格与存量拆分

反思入库前先做近似去重；自动升格与手动升格共用按数据库连接协调的任务队列，
手动与定时触发同类任务时复用正在执行的一轮。整理环节已删除，不再把小反思
滚成大 FAQ。

自动升格靠 `reflection_meta` 上的评审账本分流（迁移 v11）：`review_state` 为
NULL（未评审）、`accepted`（评审通过待成文）、`declined`（评审否决）、`failed`
（失败 3 次放弃）、`legacy`（存量整理块，不参与自动升格）；`review_attempts`
记失败次数，`review_note` 记最近一次原因。只有成文校验类失败计次，累计
`MAX_PROMOTE_ATTEMPTS`（3）次转 `failed`；超时、系统故障、并发变化、评审批次失败
只写 note 不计次；评审前就超出字符预算的条目直接 `failed`。`chatId` 为 0 的
条目一律不进自动升格。手动升格失败只写 note。

单轮顺序：先把 `accepted` 条目成文（至多 `reflectPromoteMaxPerRun` 条，不受
`reflectPromoteMinEntries` 门槛限制），再对未评审条目最多评审 3 批（每批最多 20
条、候选字符预算 24,000，来源问答计入预算）。一轮正常结束即推进游标，个别条目
失败不再阻塞游标；整轮异常才保留游标等下一次扫描。评审与成文查询在结束或
超时时取消 SDK 请求，避免遗留查询继续占用资源。

成文输出的四个字段各有 `maxLength`；程序按实际渲染格式计算正文预算并写入 user
prompt，空行折叠后再计长度，渲染超长时同一轮重试一次。分块工具仍在
`compact-chunks.ts`（按 500 字分块，与 ingest 一致），升格来源取值在
`source-context.ts`。

`legacy` 条目是整理环节留下的巨型 FAQ 切块（`chatId` 为 0，完整 FAQ 保存在各块
`reflection_meta.answer`）。一次性拆分脚本 `pnpm kb:split-legacy-reflections`
分两步：

1. dry-run（无参数）：调模型生成拆分计划，写 `data/split-legacy-<ts>.json` 与同名
   `.md` 审阅报告，不改知识库。报告顶部与脚本输出都给出各状态组数、将被替换的
   旧块数，以及不替换（`needs_review` / `failed` / `skipped`）而继续留在检索里的
   旧块数。模型花费按约 $8–10 估计（CLI 计价，记入 `legacy-split` 站点）；
2. `--apply data/split-legacy-<ts>.json`：只读计划、不调模型，先自动备份数据库，
   再逐组替换。组状态为 `split` / `fallback` / `covered` / `needs_review` /
   `failed` / `skipped`：`split` 与 `fallback` 以新条目替换；`covered`（每段产出都
   因与已有知识重复被丢弃）以空条目替换，即删除旧块、只写审计；其余不替换。
   有组 refused / errored 时退出码非 0。

dry-run 与 apply 开始前都先做一次嵌入预热（不套超时、打印耗时），避免首次加载
模型撞上 60s 超时。

前置条件（任一不满足即非 0 退出且不改库）：数据库存在且 schema 为当前版本（须先
`pnpm pm:restart` 完成 v11 迁移）；`reflectPromoteMs` 为 0；`claudeConfigDir` 下有
`settings.json`；计划的截止时间等于固定的 `LEGACY_SPLIT_CUTOFF`（`legacy-split.ts` 导出，
`source-context.ts` 也按它识别拆分产物，直接以摘录作为升格来源）。dry-run 与
apply 之间不要操作反思、不要跑 `pnpm ingest`。apply 打印的备份要长期保留，它是
撤销替换的唯一手段。完整上线步骤见 [数据库迁移与备份](database-operations.md)。

升格成文后另做一次来源忠实性复核。原文没有提到的功能不能写成“不支持”或
“仅支持”；核验拒绝、输出非法或超时均保留原反思。提交时在知识库写锁内再次
确认所用来源仍有效，避免等待模型期间的驳回被重新写入正式知识。

后台浏览器对自动升格和单条升格发送 `Prefer: respond-async`。接口立即返回
202 与任务编号，由 Next.js `after` 执行原有带审计的任务，再通过
`GET /api/reflection/jobs/[id]` 读取原始完成结果；未发送该头的调用者继续使用同步
接口。这样模型调用或维护锁排队不会让浏览器请求一直跨过外网代理的超时限制。
同一数据库连接、同一操作的在途请求复用任务；每个连接最多保留 32 个任务，完成
记录一小时后过期。状态存于单进程内存，重启或过期后需核对反思与审计，不能据
状态记录缺失断言操作未执行。客户端只重读任务状态，不自动重发写请求。

## 注释与测试

注释使用简体中文，解释设计原因、单位、边界和兼容约定。避免逐行翻译代码，
也不要把历史调试过程留作长期说明。名称应直接表达职责，例如 `updateField`。

测试放在 `tests/`，镜像源码目录。纯规则测试只依赖普通对象；存储边界使用内存
SQLite；HTTP 测试只替换外部运行时，不替换正在验证的配置持久化逻辑。
优先保护用户可感知行为，而非组件数量、函数调用细节或文件行数。

## 后续工程重点

已完成配置链路、数据访问层拆分、事务化迁移、数据库备份校验，以及后台四页
（reflection/groups/sessions/kb）的独立区块与状态管理拆分。商业发布前还需逐项
推进并验证：

- 配置热重载已具备进程内串行、失败回滚和运行状态检查；仍需补跨进程
  CAS/原子切换与完整的操作审计，不能把它当作多实例配置协调方案。
- 将自动备份保留策略、部署回滚和鉴权策略纳入发布验证。

这些项目需要各自的验收与测试，本次重构不代表已完成商业发布评审。
