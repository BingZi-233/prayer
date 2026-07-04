# 生效群白名单（Enabled Groups）设计

日期：2026-07-04
分支：feat/onebot-agent

## 背景与目的

当前 bot 对**所有** QQ 群生效：任何群里 @bot 都会触发 Agent 回复，且所有群消息都会被缓冲（`message-buffer`）并进入知识沉淀（`reflection-poller`）。这会导致：

- 未授权群里也能唤起 Agent。
- 未授权群的对话被记录、被学习进知识库（隐私面过大）。

需要一个「生效群白名单」：仅列表内的群参与全链路，其余群 bot 完全无视。

## 需求（已澄清）

| 项 | 决策 |
|---|---|
| 配置方式 | Web 管理后台（改 `/api/config` + config 页） |
| 空名单语义 | 空 = 全部不生效（安全默认，收窄为目的） |
| 门控范围 | 完全忽略：不回复 + 不缓冲 + 不沉淀 |
| 管理群 | 永远豁免（命令通道，不受名单影响） |

## 方案

config 字段 `enabledGroups: number[]`，经 `assemble` deps 透传给三个消费者，各自建 `Set` 做 O(1) 成员判断。改名单走现有 PUT `/api/config` → `reconfigure` 重启管线（复用现成热重载，无新机制）。

判定规则（统一）：群参与 ⟺ `groupId === adminGroupId || enabledSet.has(groupId)`。

（备选：独立 DB 表实时查询 —— 当下无按群差异化/审计需求，YAGNI，弃。）

## 数据流

不变，新增一道门：

```
message.received ──▶ [生效群门] ──▶ gateway (回复)
                              └──▶ message-buffer (缓冲) ──▶ reflection-poller (沉淀)
                                                              └─ 循环内同门二次拦截（纵深防御）
```

## 变更清单

### 1. lib/config-store.ts
- `AppConfig` 加字段 `enabledGroups: number[]`。
- `seedFromEnv` 默认 `[]`（不从 env 读，纯 UI 管理；空=全关）。
- 旧库缺字段：现有 `{ ...seedFromEnv(env), ...stored }` merge 已自动补 `[]`（stored 无此键时取 seed 的 `[]`）。

### 2. gateway（lib/agent/gateway.ts）
- `GatewayDeps` 加 `enabledGroups: number[]`。
- `registerGateway` 内建 `const enabled = new Set(enabledGroups)`。
- `onReceived` 首行加门：
  ```ts
  if (msg.groupId !== adminGroupId && !enabled.has(msg.groupId)) return;
  ```
  放在 admin 命令分支之前 —— 因条件排除 adminGroupId，admin 分支仍可达。

### 3. message-buffer（lib/agent/message-buffer.ts）
- `MessageBufferDeps` 加 `enabledGroups: number[]`。
- 建 `enabled` Set，`onReceived` 现有 adminGroup/bot/空文本过滤后加：
  ```ts
  if (!enabled.has(msg.groupId)) return;
  ```

### 4. reflection-poller（lib/agent/reflection-poller.ts）
- `ReflectionPollerDeps` + `Resolved` 加 `enabledGroups: number[]`，`resolve` 透传（默认 `[]`）。
- `scanOnce` 循环内首行：
  ```ts
  if (!enabled.has(groupId)) continue;
  ```
  （buffer 已门控，此为纵深防御 + 覆盖名单收窄后遗留 buffer 行的情况。）

### 5. assemble（lib/assemble.ts）
- `AssembleDeps` 加 `enabledGroups: number[]`。
- 透传给 `registerGateway` / `registerMessageBuffer` / `registerReflectionPoller`。

### 6. runtime（lib/runtime.ts）
- `start` 内 `assemble({ ..., enabledGroups: cfg.enabledGroups })`。

### 7. API（app/api/config/route.ts）
- `patchSchema` 加 `enabledGroups: z.array(z.number()).optional()`。
- `maskConfig` 无需改（非密钥字段透传）。

### 8. 管理 UI（app/admin/config/page.tsx）
- `Cfg` 接口加 `enabledGroups: number[]`。
- OneBot tab 加「生效群」编辑器：群号列表（chip 增删；或逗号/换行分隔输入解析为 number[]）。
- 空列表下方提示：「未配置任何生效群 = bot 对所有群不响应」。
- `save` payload 带上 `enabledGroups`。

## 边界与不变量

- 空名单 ⟹ 全部群不参与（含回复/缓冲/沉淀）。
- adminGroupId 永远豁免，与名单无关（`!reset` 等命令通道不受影响）。
- 改名单经 PUT `/api/config` → `reconfigure`，重启管线后生效（秒级热重载）。
- 名单收窄后：新消息立即被拦；已 buffer 的旧行由 poller 循环内的门二次拦截，不再沉淀。

## 测试

| 文件 | 用例 |
|---|---|
| tests/lib/config-store.test.ts | 默认 `enabledGroups: []`；旧库无此键 merge 补 `[]`；setConfig 写入数组 |
| gateway 测试 | 非生效群 @bot → 不 emit qualified；生效群 @bot → emit；adminGroup 命令豁免仍工作 |
| message-buffer 测试 | 非生效群 → 不 bufferGroupMessage；生效群 → buffer |
| reflection-poller 测试 | scanOnce 跳过非生效群（即使有 buffer 行）；生效群正常沉淀 |
| tests/lib/api.test.ts（如覆盖 config PUT） | PUT enabledGroups 数组校验；非数组拒 400 |

## 非目标（YAGNI）

- 按群差异化配置（不同群不同模型/提示）。
- 名单变更审计日志。
- 管理群聊天命令管理名单（本期用 Web UI）。
