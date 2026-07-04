---
title: Claude Code 缓存优化代理
icon: material-symbols:cached
order: 5
---

## 一句话介绍

[claude-code-cache-fix](https://github.com/cnighswonger/claude-code-cache-fix)
是一个**第三方开源小工具**，作用是帮 Claude Code **省额度**。

简单理解：它像一个“中间人”，挡在你的电脑和 Claude 服务器之间，
帮你把每次发出去的请求“整理整齐”，让 Claude 更容易**复用之前的对话**
（也就是**命中缓存**），从而少花额度。

> 它不会让 AI 变聪明，只是让你的额度更耐用。

## 为什么需要它？

Claude Code 用得越久，你可能会发现：

- 同样几句话，**额度掉得比想象中快**；
- 恢复一个旧对话（`--resume`），**像重新付了一次费**；
- 开了 MCP、Skills、Hooks 后，**消耗莫名变高**。

这些大多不是 bug，而是 Claude Code 的请求结构有点“不稳定”，
导致服务器认不出“这是同一段上下文”，于是**重新计费**。

`claude-code-cache-fix` 干的事情就一件：**把请求洗干净、排好序、
打上正确的缓存标记**，让 Claude 服务器一眼认出“这段我见过”，
直接走便宜的缓存价。

它具体做了什么（看不懂可以跳过）：

| 它做的事 | 对你的好处 |
| --- | --- |
| 修正恢复会话时的请求结构 | `--resume` 后不再被当成新对话重新计费 |
| 去掉版本号等不稳定标记 | Claude Code 升级后缓存不会突然失效 |
| 把工具、MCP 定义按固定顺序排列 | 同样的配置每次请求长得一样，缓存能命中 |
| 自动打好 `cache_control` 标记 | 主动告诉服务器“这段请缓存” |
| 记录每次缓存命中和额度情况 | 出问题时方便排查，文件存在 `~/.claude/quota-status/` |
| 不依赖老的 `NODE_OPTIONS` 注入 | 新版 Bun 版 Claude Code 也能用 |

## 适合谁用？

- ✅ 重度使用 Claude Code、对额度敏感的用户
- ✅ 经常 `--resume` 长会话、开了一堆 MCP / Skills 的用户
- ✅ 愿意动一点命令行的用户
- ❌ 完全不想碰终端、只想开箱即用的用户（先不用上这个）

::: warning 它不能解决所有额度问题
这个工具只能优化本地请求结构和缓存相关问题。模型本身价格、长上下文消耗、
服务端配额降级、错误模型选择、频繁大文件读取等问题，仍然需要单独排查。
:::

::: danger Windows 原生环境不适用
`claude-code-cache-fix` **不建议在 Windows 原生 CMD / PowerShell 中配置使用**。

Windows 用户请优先在 **WSL 的 Linux 环境** 中完成 Node.js、Claude Code、
PackyAPI 和 `claude-code-cache-fix` 的整套配置。不要把 Windows 原生
Claude Code 与 WSL 代理混在一起使用，否则很容易出现路径、环境变量、
后台服务和本地端口不一致的问题。
:::

::: warning 第三方工具提醒
`claude-code-cache-fix` 不是 PackyAPI 官方维护工具。它会经过本机 API 请求，
安装前请自行审查源码、依赖和配置方式。
:::

## 推荐使用 AI 辅助配置

这个工具涉及本地代理、环境变量和后台服务配置，手动配置容易漏项。
推荐把你的系统环境、PackyAPI Endpoint 和 GitHub 项目链接一起发给 AI，
让 AI 按你的机器生成命令。

可以直接使用下面这段提示词：

```text
请根据 https://github.com/cnighswonger/claude-code-cache-fix 的最新 README，
帮我在当前系统中配置 Claude Code 缓存优化代理。
要求：
1. 我使用 PackyAPI，upstream 必须是 https://www.packyapi.com
2. Claude Code 的 ANTHROPIC_BASE_URL 应指向本地代理 http://127.0.0.1:9801
3. 保留 ANTHROPIC_AUTH_TOKEN，用我的 PackyAPI CC 分组令牌替换
4. Windows 用户请按 WSL Linux 环境来配置，不要使用 Windows 原生 CMD / PowerShell
5. 给出验证代理健康状态和 Claude Code 回复是否正常的命令
6. 长期使用时，请给出适合当前系统的后台服务配置方式
```

## 最小验证流程

下面的命令适合在 Linux / macOS / WSL 中先验证代理是否能跑通：

```bash
npm install -g claude-code-cache-fix
CACHE_FIX_PROXY_UPSTREAM=https://www.packyapi.com cache-fix-proxy server
```

如果你使用的是优化线路 Endpoint，可以把 `CACHE_FIX_PROXY_UPSTREAM` 改成：

```bash
https://api-slb.packyapi.com
```

## 配置 Claude Code

代理启动后，将 Claude Code 的 `settings.json` 中 `ANTHROPIC_BASE_URL`
改为本地代理地址，`ANTHROPIC_AUTH_TOKEN` 继续填写你的 PackyAPI
**CC** 分组令牌：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:9801",
    "ANTHROPIC_AUTH_TOKEN": "xxx",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1"
  }
}
```

## 验证代理

另开一个终端，检查代理健康状态：

```bash
curl http://127.0.0.1:9801/health
```

如果返回 `{"status":"ok"}`，再重新打开终端运行：

```bash
claude
```

能正常进入 Claude Code 并收到回复，说明代理和 PackyAPI 配置已经连通。

## 长期使用建议

手动启动代理只适合临时验证。长期使用时，建议继续让 AI 根据你的系统生成
`systemd`、`launchd` 或其它后台服务配置，避免每次使用 Claude Code 前都要
手动启动代理。

再次提醒：Windows 用户请在 WSL 里完成整套配置，不要使用 Windows 原生
CMD / PowerShell 作为运行环境。
