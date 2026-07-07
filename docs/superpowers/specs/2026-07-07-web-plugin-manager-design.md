# Web 插件管理器设计

日期: 2026-07-07
状态: 已批准，待实现

## 背景与问题

Agent 运行时（`lib/runtime.ts`）通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 加载
本仓库本地插件 `plugins/packyapi`。当前存在**两条并行**加载路径：

1. `makeAgent` 里显式传 `pluginPaths: [resolve(process.cwd(), "plugins/packyapi")]`，
   在 `agent.run` 中转成 `plugins: [{ type: "local", path }]`（就地读源码）。
2. `agent.run` 同时设 `settingSources: ["user"]`，读 `CLAUDE_CONFIG_DIR/settings.json` 的
   `enabledPlugins.packyapi@prayer-local` + `extraKnownMarketplaces.prayer-local`
   （`directory` 源，指向仓库根）。

SDK 对同名插件（explicit `plugins` 与 `enabledPlugins`）**无去重文档保证**，双加载/冲突是
「本地更新了插件、agent 不知道」的最可能元凶。此外用户无 web 手段安装 / 更新 / 启停插件。

### 已验证事实

- `claude` CLI 在 PATH 上；`CLAUDE_CONFIG_DIR` 环境变量**被尊重**（实测 `CLAUDE_CONFIG_DIR=... claude plugin list --json`
  输出的正是 `data/claude-config` 下的插件）。官方文档未记载此 override，但实际生效。
- `claude plugin` 子命令：`install|uninstall|enable|disable|update <plugin>@<marketplace> [--scope user|project|local]`、
  `list [--json]`、`details`。非交互可用，`--scope` 默认 `user`。
- marketplace `source` 类型：`github`（`{source:"github", repo:"owner/repo"}`）、`git`（url）、
  `url`（远程 JSON）、`directory`（本地路径）。
- **`directory` 源就地加载，不拷进 cache**；只有 `github` / `git` / `url` 会拷进
  `CLAUDE_CONFIG_DIR/plugins/cache/`。这解释了 `cache/prayer-local/packyapi/` 为空 =
  packyapi 一直就地读源码。

## 核心决策

- **单一真源**：`CLAUDE_CONFIG_DIR/settings.json` 的 `enabledPlugins` + `claude plugin` CLI 管理的
  cache。砍掉 runtime 显式 `pluginPaths`，消除双加载。
- **web 全部操作 → 调 `claude plugin` CLI**（注入 `CLAUDE_CONFIG_DIR=cfg.claudeConfigDir`）→
  成功后自动 `runtime.reconfigure()`，agent 下一条消息即用新插件状态。与现有 `PUT /api/config` 同款。
- **安装来源**：GitHub / git repo（当 marketplace 添加后装其中插件）、本地目录 `directory`。
  上传 zip 不做（YAGNI）。

## 组件

### 1. `lib/plugins/manager.ts`（新）

包 `claude plugin` CLI，用 `execFile`（非 shell，数组参数，杜绝命令注入）。构造时接收
`claudeConfigDir`，每次调用注入 `env: { ...process.env, CLAUDE_CONFIG_DIR: resolve(dir) }`。

| 方法 | CLI |
|---|---|
| `list(): Promise<PluginInfo[]>` | `claude plugin list --json` |
| `install(name, marketplace)` | `claude plugin install <name>@<marketplace> --scope user` |
| `uninstall(id)` | `claude plugin uninstall <id> --scope user` |
| `enable(id)` / `disable(id)` | 对应子命令 |
| `update(id)` | `claude plugin update <id> --scope user`（directory 源可能 no-op，靠 reconfigure 重读） |
| `addMarketplace(name, source)` | `claude plugin marketplace add <src>`；github: `owner/repo`；directory: 绝对路径 |

- **参数校验（安全硬性）**：`name` / `marketplace` / `id` 仅允许 `[A-Za-z0-9._@/-]`；
  git URL 走 `new URL()` 解析校验；directory 路径须绝对且存在。任何非法输入直接拒绝，不拼进命令。
- 全程 `execFile`（不经 shell），参数以数组传，从根本上无 shell 注入面。
- 返回结构化 `{ ok: boolean, stdout?: string, error?: string }`；`list` 解析 `--json`。

`PluginInfo`（对齐 CLI `--json` 输出）：`{ id, version, scope, enabled, installPath, mcpServers? }`。

### 2. `app/api/plugins/route.ts` + `app/api/plugins/[id]/route.ts`（新）

- `GET /api/plugins` → `manager.list()`
- `POST /api/plugins` → 安装。body: `{ source: "github"|"directory", marketplaceName, repoOrPath, pluginName }`；
  先 `addMarketplace` 再 `install`
- `PATCH /api/plugins/[id]` → body `{ action: "enable"|"disable"|"update" }`
- `DELETE /api/plugins/[id]` → `uninstall`
- 每个**写操作**成功后：`getRuntime().reconfigure(getConfig(repo()), await defaultBuilders())`
  （照抄 `app/api/config/route.ts` 的 reconfigure 模式）
- zod 校验 body；错误走现有 `ok`/`fail` 包装（`lib/api.ts`）

### 3. `lib/runtime.ts` 改动

`defaultBuilders().makeAgent` 里**删除** `pluginPaths: [resolve(..., "plugins/packyapi")]`。
agent.run 的 `plugins: []` 变空，改由 `settingSources: ["user"]` + `enabledPlugins` 单路加载。

> 注：本地 packyapi 是 `directory` 源就地加载，不进 cache；reconfigure 重启管线后就地重读新源码。
> `agent.ts` 的 `pluginPaths` 参数保留（可选），仅不再由 `defaultBuilders` 传入。

### 4. `app/admin/plugins/page.tsx`（新）+ 侧栏入口

- 已装插件表：名称 / 版本 / marketplace / `enabled` 开关 / 更新按钮 / 删除按钮
- 「添加插件」表单：github（`owner/repo` + marketplace 名 + 插件名）或 目录（绝对路径 + 插件名）
- 照抄现有 admin 页（`app/admin/groups`、`app/admin/proactive`）的 fetch + 表格 + 样式
- 在 `app/admin/layout.tsx` 侧栏加「插件」入口

## 数据流

```
web 表单 → POST/PATCH/DELETE /api/plugins → manager (execFile claude plugin, CLAUDE_CONFIG_DIR 注入)
  → 成功 → runtime.reconfigure() → 下条 QQ 消息由新 CLI 子进程读 settings.json/cache 生效
```

## 错误处理

- CLI 非零退出 → manager 返回 `{ ok:false, error: stderr }`，API 转 `fail(msg)` + 4xx/5xx
- 参数校验失败 → 400，不触达 CLI
- reconfigure 抛错 → runtime 已有 `teardownAll` 回收，状态置 `error`，API 返回 500 并带 lastError

## 测试

- `tests/lib/plugins/manager.test.ts`：mock `execFile`，验证
  ① 参数拼装正确 ② 注入防御（含 `;`、`$()`、空格的名字被拒） ③ `--json` 解析
- `tests/api/plugins.test.ts`（或对齐现有 API 测试目录结构）：mock manager + runtime，
  验证路由分发、reconfigure 被调、zod 拒非法 body

## 风险与待验

- `directory` 源 `update` 可能 no-op（不缓存）；本地插件更新实际靠 reconfigure 就地重读，需在实现时实测确认。
- github 插件才真正进 cache；首次 `install` 会 git clone，网络失败要有清晰报错。
- reconfigure 会重启整条管线（WS 断连重连），写操作频繁时用户可感知短暂断连 —— 与现有 config PUT 行为一致，接受。

## 非目标（YAGNI）

- 上传 zip 安装
- 插件版本回滚 / 多版本共存
- marketplace 浏览 / 搜索 UI
