---
title: 环境检查(通用步骤)
icon: mdi:tools
order: 1
---

### （1）确认Nodejs环境已安装
1. 在windows或MacOS终端输入以下命令

```bash
npm list -g --depth-0
```

正常情况应该是如下图所示（没有任何内容也没关系），如果提示“命令未找到”，则说明你没有安装Nodejs，你需要按 [此教程](https://www.runoob.com/nodejs/nodejs-install-setup.html) 来安装运行Claude Code、Codex、Gemini所需的环境

![](/assets/image/Cli/001.webp)

2. 如果你发现自己没有安装Nodejs，并且跟着教程目前已经安装完毕，请你重新执行上述提到的命令，如果不再提示“命令未找到”，则说明安装成功

### （2）安装CLI

1. 在windows或MacOS终端输入以下命令，一次性安装好我们目前所需的所有终端

```bash
npm i -g @anthropic-ai/claude-code@latest
npm i -g @openai/codex@latest
npm i -g @google/gemini-cli@latest

```

![](/assets/image/Cli/002.webp)

### （3）测试安装成功
> [!important]
> **这一步很重要，请你务必运行命令进行测试，因为这一步运行命令后，你的用户目录下才会生成各CLI的配置目录，方便后续操作！**


::: tabs

@tab Claude Code

1. 在windows或MacOS终端输入以下命令，若出现图示内容，或出现选项让你选择，则Claude code安装成功

```bash
claude
```


![](/assets/image/Cli/003.webp)

> [!important]
> **第二步十分重要，请你务必跳转链接后运行命令进行配置**

2. 点击 [claude code 无法连接到 Anthropic 服务](/docs/faq/CC.html#claude-code-无法连接到-anthropic-服务) 跳转，务必根据教程运行命令，然后再继续阅读之后单独CLI的配置教程



@tab Codex

在windows或MacOS终端输入以下命令，若出现图示内容，或出现选项让你选择，则Codex安装成功

```bash
codex
```

![](/assets/image/Cli/004.webp)

@tab Gemini

在windows或MacOS终端输入以下命令，若出现图示内容，或出现选项让你选择，则Gemini安装成功

```bash
gemini
```

![](/assets/image/Cli/005.webp)

:::
