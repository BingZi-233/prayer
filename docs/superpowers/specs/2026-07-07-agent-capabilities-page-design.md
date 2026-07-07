# Agent 能力页设计(skills / mcp / plugins / 工具门控)

日期:2026-07-07
分支:`feat/capabilities-page`

## 目标

管理后台新增 `/admin/capabilities` 页,展示 Agent 当前持有的能力面:插件(plugins)、技能(skills)、MCP server(含其工具)、以及本 host 的工具门控白名单。数据经 Claude Agent SDK 运行时上报,如实反映 Agent 真实装配状态。

## 背景 / 现状

- Agent 在 `lib/agent/agent.ts` 用 `@anthropic-ai/claude-agent-sdk` 的 `query()` 装配:
  - `plugins`:来自 `lib/runtime.ts` 的 `pluginPaths`(当前 `plugins/packyapi`),以 `{ type:"local", path, skipMcpDiscovery:true }` 加载 → 只加载插件的 skills/commands,**不注册插件声明的 MCP server**。
  - `mcpServers`:仅 `{ cs: <in-process tool server> }`,提供工具 `mcp__cs__kb_search`。
  - `settingSources:["user"]`、`permissionMode:"default"`、`env:sdkEnv()`(剥 `ANTHROPIC_*`,交 `CLAUDE_CONFIG_DIR/settings.json`)。
  - 工具门控:`TOOL_ALLOWLIST`(`mcp__cs__kb_search` + `WebSearch` + `Skill`)无条件放行;`Bash`/`Read`/`WebFetch` 经 `isToolAllowed` 限 packy 用途;其余拒绝。
- 现有管理页模式:`app/admin/*/page.tsx`(client 组件)+ `app/api/*/route.ts`(`ok`/`fail` 包装,见 `lib/api.ts`)。侧栏 `components/app-sidebar.tsx` 的 `nav` 数组。
- SDK `Query` 对象暴露控制通道内省方法(纯控制请求,**不触发模型调用、零 token**):
  - `reloadPlugins()` → `{ commands, agents:AgentInfo[], plugins:[{name,path,source?}], mcpServers:McpServerStatus[], error_count }`
  - `reloadSkills()` → `{ skills:SlashCommand[] }`(`{name,description,argumentHint,aliases?}`)
  - `mcpServerStatus()` → `McpServerStatus[]`:`{ name, status, serverInfo?, error?, config?, scope?, tools?:[{name,description?,annotations?:{readOnly,...}}] }`

## 决策(已确认)

1. **位置**:新侧栏页 `/admin/capabilities`。
2. **数据源**:运行时 SDK 上报(经上述 `Query` 控制方法)。
3. **范围**:四类全展示 —— plugins + skills + mcp(含工具)+ 工具门控白名单。
4. **探针方式**:独立短命探针 `query()`,取完即 `abort()`,与运行中 Agent 解耦(runtime 停止时仍可探)。
5. **路径显示**:显示完整绝对路径(后台仅管理员可见,便于排障)。

## 架构

三层,复用现有 overview/status 模式。

### 1. 内省模块 `lib/agent/introspect.ts`

导出 `probeCapabilities(cfg: AppConfig, opts?): Promise<Capabilities>`。

归一化返回结构:

```ts
export interface CapabilityTool {
  name: string;
  description?: string;
  readOnly?: boolean;
}
export interface CapabilityMcpServer {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  version?: string;      // serverInfo.version
  error?: string;
  scope?: string;
  tools: CapabilityTool[];
}
export interface CapabilitySkill {
  name: string;
  description: string;
  argumentHint?: string;
}
export interface CapabilityPlugin {
  name: string;
  path: string;          // 完整绝对路径
  source?: string;
}
export interface CapabilityToolPolicy {
  allowlist: string[];   // 无条件放行的工具名
  gated: { tool: string; constraint: string }[]; // Bash/Read/WebFetch 及其约束描述
}
export interface Capabilities {
  plugins: CapabilityPlugin[];
  skills: CapabilitySkill[];
  mcpServers: CapabilityMcpServer[];
  toolPolicy: CapabilityToolPolicy;
  probedAt: number;      // 由调用方(API 层)戳时间,模块不调 Date.now 以便测试
}
```

流程:

1. 设 `process.env.CLAUDE_CONFIG_DIR = resolve(cfg.claudeConfigDir)`(与 `runtime.start` 一致,防 cwd 漂移)。
2. 用与 Agent **相同**的 SDK 选项启探针 `query()`:
   - `prompt`:极简字符串(如 `"probe"`);不消费消息流。
   - `options`:`plugins`(由 `cfg` / pluginPaths 构造,同 runtime 默认 `plugins/packyapi`)、`mcpServers:{ cs: buildToolServer(repo, ctx) }`、`settingSources:["user"]`、`permissionMode:"default"`、`env:sdkEnv()`、`maxTurns:1`、`abortController`。
   - MCP 的 `cs` 需一个最小 `ToolContext`;探针不真正跑工具,给占位 ctx 即可。
3. 并发 `Promise.allSettled([q.reloadPlugins(), q.reloadSkills(), q.mcpServerStatus()])`;各自失败降级为空区(不整体崩)。
4. `abortController.abort()` 收尾;`try/finally` 保证即使抛错也 abort,不泄漏子进程。
5. 叠加静态工具门控层:`allowlist` 从 `TOOL_ALLOWLIST` 派生;`gated` 硬编码 Bash/Read/WebFetch 三条约束文案(与 `denyMessage`/`isToolAllowed` 语义一致,单一事实源尽量引用 agent.ts 的常量/说明)。
6. **缓存**:进程级 memo(globalThis)+ TTL(默认 60s,能力极少变);`opts.refresh` 或 API `?refresh=1` 绕过缓存重探。

依赖注入:`probeCapabilities` 接受可选 `queryFn`(默认 SDK `query`)与 `makeToolServer`,供测试注入 fake。

### 2. API `app/api/capabilities/route.ts`

- `GET`:读 `getConfig(...)`(同 overview 路由)→ `probeCapabilities(cfg, { refresh: searchParams.has("refresh") })` → `ok(data)`;`probedAt` 在此层戳。
- 探针 spawn/init 失败 → `fail(message)` + `status:500`,message 友好化(如「Agent 未配置或 Claude CLI 不可用,请检查配置」)。

### 3. 页面 `app/admin/capabilities/page.tsx`

- client 组件,挂载即 `fetch("/api/capabilities")`(非轮询,避免反复 spawn CLI)。
- 顶部标题 + 「刷新」按钮(`?refresh=1`,busy 时 Spinner)。
- 四个分区 Card:
  - **插件**:每插件 name + source Badge + 完整 path(等宽小字)。
  - **技能**:name(强调)+ description;有 argumentHint 时附标记。
  - **MCP**:name + status Badge(connected=default、failed=destructive、disabled/其余=secondary)+ error(有则)+ 工具子列表(工具名 + 描述 + `只读` 标记)。
  - **工具门控**:allowlist 芯片列表 + gated 三条(工具名 + 约束文案)。
- loading → Skeleton;错误 → destructive Card(复用 status 页 `lastError` 样式)。
- 空态:某区无数据显「无」。
- 侧栏 `app-sidebar.tsx` `nav` 增 `{ href:"/admin/capabilities", label:"能力", icon: Boxes }`(lucide `Boxes` 或 `Puzzle`)。

## 数据流

页面 → `GET /api/capabilities` → `probeCapabilities`(缓存命中直接返回;未命中启探针 query → SDK 控制通道 `reloadPlugins`/`reloadSkills`/`mcpServerStatus` → abort)→ 归一 + 静态叠加 → JSON。

## 错误处理

- 探针整体失败(spawn/init 异常):API 返回 `fail`,页面显 destructive Card。
- 单个控制方法失败(`allSettled` rejected):该区空态,其余正常。
- `abort` 放在 `finally`,任何路径都不泄漏 CLI 子进程。

## 测试(vitest,follow `tests/lib/` 模式)

- `tests/lib/agent/introspect.test.ts`:
  - 注入 fake `queryFn` 返回带 stub `reloadPlugins`/`reloadSkills`/`mcpServerStatus`/`interrupt` 的 Query;断言归一化字段映射正确。
  - 断言静态工具门控叠加(allowlist 来自 `TOOL_ALLOWLIST`、gated 三条)。
  - 断言 `abortController.abort` 被调(收尾)。
  - 断言单方法 rejected 时该区降级空、其余保留。
  - 断言缓存:二次调用不重启 query;`refresh` 绕过。
- `tests/lib/api.test.ts` 或新增路由测:`ok`/`fail`/`?refresh` 行为(注入桩 `probeCapabilities`)。

## 非目标 / YAGNI

- 不做实时轮询(能力静态,手动刷新足够)。
- 不做能力编辑/开关(纯只读展示)。
- 不修复 packyapi 插件 MCP 因 `skipMcpDiscovery:true` 未加载的现状 —— 如实反映即可(MCP 区仅显 `cs`);若要接入是另一独立任务。
- 不展示 subagents(`reloadPlugins` 虽返回 `agents`,当前 Agent 未用子代理);预留结构,首版不渲染。

## 风险 / 待验证

- 探针 `query()` 的控制方法是否需先启动消息迭代才能 resolve:实现时验证;若需要,则后台启一次 `for await` 并在收到首个 `system/init` 后调控制方法再 abort。
- 每次 refresh spawn 一个 CLI 子进程有启动开销(~秒级);靠缓存 + 手动刷新控制频率。
