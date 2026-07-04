---
title: CC-Switch使用教程
index: false
icon: fluent:table-switch-16-filled
category:
  - CC-Switch
date: 2025-11-23
---

## 通用步骤

### CC-Switch介绍

<div align="center">

<h3>Claude Code / Codex / Gemini CLI 全方位辅助工具</h3>

[![Version](https://img.shields.io/badge/version-3.7.1-blue.svg)](https://github.com/farion1231/cc-switch/releases)
[![Trending](https://img.shields.io/badge/🔥_TypeScript_Trending-Daily%20%7C%20Weekly%20%7C%20Monthly-ff6b6b.svg)](https://github.com/trending/typescript)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/farion1231/cc-switch/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Downloads](https://img.shields.io/endpoint?url=https://api.pinstudios.net/api/badges/downloads/farion1231/cc-switch/total)](https://github.com/farion1231/cc-switch/releases/latest)

<a href="https://trendshift.io/repositories/15372" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15372" alt="farion1231%2Fcc-switch | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[::mdi:clipboard-text-history::更新日志](https://github.com/farion1231/cc-switch/blob/main/CHANGELOG.md) | [::fa-solid:cloud-download-alt::下载地址](https://github.com/farion1231/cc-switch/releases/latest)

**从供应商切换器到 AI CLI 一体化管理平台**

**统一管理 Claude Code、Codex 与 Gemini CLI 的供应商配置、MCP 服务器、Skills 扩展和系统提示词。**
</div>

使用 CC-Switch，您可以：
- ✅ 一键切换 API 配置 - 在多个 API 提供商之间快速切换
- ✅ 可视化配置管理 - 通过图形界面轻松管理所有配置
- ✅ 内置 PackyAPI 模板 - 预设了 PackyAPI 的配置模板
- ✅ MCP 服务器管理 - 管理 Model Context Protocol 服务器
- ✅ 系统托盘快捷操作 - 通过托盘菜单快速切换

::: tip 温馨提示
CC-Switch 已经内置了 PackyAPI 的快捷配置模板，无需手动编辑配置文件！
:::

### 软件下载

::: tabs

@tab Windows
1. 点击下载链接→[传送门](https://github.com/farion1231/cc-switch/releases/latest)←，进入CC-Switch的Github Release页面

2. 鼠标滚动到最下方选择适合自己版本的安装包，windows系统推荐下载普通msi后缀的安装包进行安装

![](/assets/image/CC-Switch/001.webp)

3. 安装后运行CC-Switch主程序，界面如下。

![](/assets/image/CC-Switch/002.webp)

@tab MacOS
- MacOS安装推荐使用HomeBrew

- 开启终端后，分别运行以下命令：
```bash
# 添加 tap 源
brew tap farion1231/ccswitch

# 安装 CC-Switch
brew install --cask cc-switch
```

- 安装完成后，在“启动台”或“应用程序”文件夹中找到 CC-Switch 并启动。

![](/assets/image/CC-Switch/002.webp)

@tab Linux
> [!important]
> 以下命令中的文件名包含占位符版本号 x.x.x，请访问[GitHub Releases](https://github.com/farion1231/cc-switch/releases/latest) 页面查看最新版本，并替换为实际的版本号和完整文件名。

Debian/Ubuntu 系统：
```bash
# 下载 .deb 包
wget https://github.com/farion1231/cc-switch/releases/latest/download/cc-switch_x.x.x_amd64.deb

# 安装
sudo dpkg -i cc-switch_x.x.x_amd64.deb
```

:::

### 环境检查

::: warning
**请你最好进行此步的环境检查步骤！！！
如果你有经验，能确认你的Nodejs环境以及cc、codex、gemini的cli安装没问题，配置目录也都存在，可以忽略这一步，直接进入以下的CC Switch配置**

点击右侧传送门查看 [如何进行环境检查？](/docs/cli/1-env.html)
:::



## ::material-icon-theme:claude:: Claude Code配置

1. 打开你下载的CC Switch软件，你会看到如下图的初始界面

![](/assets/image/CC-Switch/003.webp)

2. 在分组条中，将分组选择至“Claude”

![](/assets/image/CC-Switch/004.webp)

3. 在供应商分组中，选择如图的“PakcyCode”

![](/assets/image/CC-Switch/005.webp)

4. 回顾 [创建API令牌](/docs/register/4-token.html)，在 PackyApi 中创建 **CC** 分组的令牌，点击复制按钮，复制ApiKey到剪切板

![](/assets/image/Cli/025.webp)

5. 下拉模态框，找到“API Key”配置项，填入你刚才复制的ApiKey，再点击右下角“添加”按钮

![](/assets/image/CC-Switch/006.webp)

6. 添加成功后，在主界面会看到我们配置的分组，在右侧点击“启用”按钮，显示“使用中”，则配置完成

![](/assets/image/CC-Switch/007.webp)

7. 点击左上角“设置”按钮，在通用页面下拉找到 `跳过 Claude Code初次安装确认` ，务必勾选

![](/assets/image/CC-Switch/017.webp)

8. 在终端运行 `claude`，看到对话界面并能正常回复即表示配置完成

![](/assets/image/Cli/016.webp)


## ::hugeicons:chat-gpt:: Codex配置

1. 打开你下载的CC Switch软件，你会看到如下图的初始界面

![](/assets/image/CC-Switch/003.webp)

2. 在分组条中，将分组选择至“Codex”

![](/assets/image/CC-Switch/008.webp)

3. 在供应商分组中，选择如图的“PakcyCode”

![](/assets/image/CC-Switch/009.webp)

4. 回顾 [创建API令牌](/docs/register/4-token.html)，在 PackyApi 中创建 **Codex** 分组的令牌，点击复制按钮，复制ApiKey到剪切板

![](/assets/image/Cli/008.webp)

5. 下拉模态框，找到“API Key”配置项，填入你刚才复制的ApiKey，再点击右下角“添加”按钮

![](/assets/image/CC-Switch/010.webp)

6. 添加成功后，在主界面会看到我们配置的分组，在右侧点击“启用”按钮，显示“使用中”，则配置完成

![](/assets/image/CC-Switch/011.webp)

7. 在终端运行 `codex`，看到对话界面并能正常回复即表示配置完成

![](/assets/image/Cli/010.webp)

## ::vscode-icons:file-type-gemini:: Gemini配置

1. 打开你下载的CC Switch软件，你会看到如下图的初始界面

![](/assets/image/CC-Switch/003.webp)

2. 在分组条中，将分组选择至“Gemini”

![](/assets/image/CC-Switch/012.webp)

3. 在供应商分组中，选择如图的“PakcyCode”

![](/assets/image/CC-Switch/013.webp)

4. 回顾 [创建API令牌](/docs/register/4-token.html)，在 PackyApi 中创建 **Gemini** 分组的令牌，点击复制按钮，复制ApiKey到剪切板

![](/assets/image/Cli/026.webp)

5. 下拉模态框，找到“API Key”配置项，填入你刚才复制的ApiKey，再点击右下角“添加”按钮

![](/assets/image/CC-Switch/014.webp)

6. 添加成功后，在主界面会看到我们配置的分组，在右侧点击“启用”按钮，显示“使用中”，则配置完成

![](/assets/image/CC-Switch/015.webp)

7. 在终端运行 `gemini`，看到对话界面并能正常回复即表示配置完成

![](/assets/image/Cli/022.webp)

## CC Switch CLI 使用

CC-Switch CLI 同时提供完整 CLI 命令和完整 TUI 界面，适合服务器、SSH、macOS 终端和自动化场景使用。你也可以让 Claude Code / Codex 直接调用 `cc-switch` 命令来检查、切换和修复配置。

查看详细教程：[CC Switch CLI 使用](/docs/ccswitch/5-ccs_cli.html)
