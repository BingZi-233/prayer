---
title: CC Switch CLI 使用
icon: tdesign:ai-terminal-filled
order: 5
---

::: tip
CC Switch CLI 适合服务器、SSH、macOS 终端和自动化场景使用。如果你更习惯图形界面，可以继续使用前面的 CC-Switch 教程。
:::

<div align="center">

# CC-Switch CLI

[![Version](https://img.shields.io/github/v/release/saladday/cc-switch-cli?label=version)](https://github.com/saladday/cc-switch-cli/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/saladday/cc-switch-cli/releases)
[![Built with Rust](https://img.shields.io/badge/built%20with-Rust-orange.svg)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/saladday/cc-switch-cli/blob/main/LICENSE)

**Claude Code、Codex、Gemini、OpenCode 与 OpenClaw 的命令行管理工具**

统一管理多个 AI 编码 CLI 的供应商配置，并支持 MCP、Skills、提示词、本地代理和环境检查等功能。

</div>

![](/assets/image/CC-Switch/018.webp)

## CC-Switch CLI 是什么

CC-Switch CLI 是 CC-Switch 的命令行版本，适合服务器、SSH、macOS 终端和自动化场景使用。

它包含两部分：

- **完整 CLI 命令**：可以用命令完成 Provider 列表查看、切换、环境检查、MCP 同步、Skills 管理、提示词管理、本地代理等操作。
- **完整 TUI 界面**：运行 `cc-switch` 后进入终端图形界面，可以像使用桌面版一样新增 Provider、选择 PackyCode 模板、填写 API Key、保存并切换配置。

如果你只是第一次配置 PackyAPI，推荐先用 TUI。配置完成后，日常切换、检查和排错可以直接用 CLI 命令完成。

## 安装 CC-Switch CLI

macOS 和 Linux 推荐使用一键安装脚本：

```bash
curl -fsSL https://github.com/SaladDay/cc-switch-cli/releases/latest/download/install.sh | bash
```

默认会安装到 `~/.local/bin`。如果终端提示找不到 `cc-switch`，请确认 `~/.local/bin` 已加入 `PATH`。

::: details 手动安装

### macOS

```bash
curl -LO https://github.com/saladday/cc-switch-cli/releases/latest/download/cc-switch-cli-darwin-universal.tar.gz
tar -xzf cc-switch-cli-darwin-universal.tar.gz
chmod +x cc-switch
sudo mv cc-switch /usr/local/bin/

# 如遇 “无法验证开发者” 提示
xattr -cr /usr/local/bin/cc-switch
```

### Linux x64

```bash
curl -LO https://github.com/saladday/cc-switch-cli/releases/latest/download/cc-switch-cli-linux-x64-musl.tar.gz
tar -xzf cc-switch-cli-linux-x64-musl.tar.gz
chmod +x cc-switch
sudo mv cc-switch /usr/local/bin/
```

### Linux ARM64

```bash
curl -LO https://github.com/saladday/cc-switch-cli/releases/latest/download/cc-switch-cli-linux-arm64-musl.tar.gz
tar -xzf cc-switch-cli-linux-arm64-musl.tar.gz
chmod +x cc-switch
sudo mv cc-switch /usr/local/bin/
```

### Windows

前往 [GitHub Releases](https://github.com/saladday/cc-switch-cli/releases/latest) 下载 `cc-switch-cli-windows-x64.zip`，解压后将 `cc-switch.exe` 放到 PATH 目录中，或直接在当前目录运行：

```powershell
.\cc-switch.exe
```

:::

## 两种使用方式

### 进入 TUI 界面

```bash
cc-switch
```

如果要直接配置某个应用，可以加 `--app`：

```bash
cc-switch --app claude
cc-switch --app codex
cc-switch --app gemini
```

TUI 适合第一次配置。你可以在里面选择 PackyCode 模板，填入 API Key，然后保存并切换到该 Provider。

### 使用 CLI 命令

```bash
cc-switch provider list
cc-switch provider current
cc-switch provider switch <id>
cc-switch env tools
cc-switch env check
```

`claude` 是默认应用。管理其他应用时使用 `--app`：

```bash
cc-switch --app codex provider list
cc-switch --app gemini provider current
```

CLI 命令适合服务器、脚本和日常排错，也适合交给 Claude Code / Codex 直接执行。

## 配置前准备

请先确认目标 CLI 已经安装：

```bash
cc-switch env tools
```

建议先运行一次目标 CLI 或帮助命令，让它创建自己的配置目录：

```bash
claude --help
codex --help
gemini --help
```

然后在 PackyAPI 创建对应分组的令牌：

- Claude Code：创建 **CC 分组**令牌
- Codex：创建 **Codex 分组**令牌
- Gemini：创建 **Gemini 分组**令牌

## 配置 PackyAPI

第一次配置推荐使用 TUI，因为它会展示 PackyCode 模板和需要填写的字段。

::: tip
下面以 Claude Code 为例。Codex 和 Gemini 的配置方式相同，只需要用 `--app codex` 或 `--app gemini` 切换目标应用。
:::

1. 运行以下命令进入交互界面：

```bash
cc-switch
```

如果要直接配置 Codex 或 Gemini，可以这样进入：

```bash
cc-switch --app codex
cc-switch --app gemini
```

2. 在左侧选择 `Providers`，进入供应商管理页面，然后新增供应商。

![](/assets/image/CC-Switch/019.webp)

3. 在模板中选择 `* PackyCode`。

![](/assets/image/CC-Switch/020.webp)

4. 在 `API Key` 中填入你从 PackyAPI 复制的令牌，然后保存。

![](/assets/image/CC-Switch/021.webp)

5. 回到供应商列表，确认当前选中的是刚刚添加的 PackyCode Provider。

![](/assets/image/CC-Switch/022.webp)

6. 如果你配置的是 Claude Code，进入 `设置`，找到 `跳过 Claude Code 初次安装确认`，确认开启。

![](/assets/image/CC-Switch/023.png)

这个选项会向 `~/.claude.json` 写入 `hasCompletedOnboarding=true`，避免 Claude Code 首次启动时停在安装确认流程。

7. 打开对应 CLI 测试是否可以正常对话：

```bash
claude
```

Codex 和 Gemini 分别使用：

```bash
codex
gemini
```

## 常用命令

```bash
cc-switch                         # 进入交互界面
cc-switch env tools               # 检查本地 CLI 是否安装
cc-switch env check               # 检查环境变量冲突

cc-switch provider list           # 查看 Claude 供应商
cc-switch provider current        # 查看当前 Claude 供应商
cc-switch provider switch <id>    # 切换 Claude 供应商

cc-switch --app codex provider list
cc-switch --app gemini provider list

cc-switch provider stream-check <id> # 检查供应商流式响应
cc-switch provider fetch-models <id> # 拉取远端模型列表
cc-switch update                     # 更新 CC-Switch CLI
```

管理 Codex、Gemini、OpenCode 或 OpenClaw 时，请使用全局参数 `--app` 指定目标应用。

## 高级玩法：让 AI 助手操作 CC-Switch CLI

如果你已经在 Claude Code 或 Codex 中工作，也可以直接让它们调用 `cc-switch` 命令来检查和切换配置。

例如你可以这样说：

```text
帮我运行 cc-switch provider list，看一下当前有哪些 Claude Provider。
```

```text
帮我运行 cc-switch --app codex provider current，确认 Codex 当前是不是 PackyCode。
```

```text
帮我运行 cc-switch env check --app claude，检查有没有环境变量覆盖配置。
```

```text
帮我切换到 PackyCode provider，然后运行 claude 测试是否能正常回复。
```

这种方式适合已经熟悉终端的人。AI 助手负责执行命令和解释结果，你只需要确认关键操作，比如切换 Provider、覆盖配置文件或删除配置。

## 常见问题

### 切换 Provider 后没有生效

请先确认目标 CLI 已经初始化配置目录。可以运行一次：

```bash
claude --help
codex --help
gemini --help
```

然后重新切换一次 Provider。

### 环境变量覆盖了配置

如果系统里设置了 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY` 等环境变量，目标 CLI 可能会优先读取环境变量，导致 CC-Switch CLI 写入的配置没有生效。

可以运行：

```bash
cc-switch env check --app claude
cc-switch env check --app codex
cc-switch env check --app gemini
```
