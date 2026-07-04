---
title: Gemini配置
icon: vscode-icons:file-type-gemini
order: 4
---

::: tabs

@tab Windows

1. 键盘按下“Win+R”，输入以下内容后回车，打开 Gemini CLI 配置目录

```bash
%userprofile%\.gemini
```

![](/assets/image/Cli/019.webp)

2. 如果目录下没有 `.env` 文件，请新建一个 `.env`，写入以下内容

- **.env**：Gemini CLI的配置文件，主要设置自定义端点、ApiKey跟所用模型

![](/assets/image/Cli/020.webp)

```bash
GOOGLE_GEMINI_BASE_URL=https://www.packyapi.com
GEMINI_API_KEY=xxx
GEMINI_MODEL=gemini-2.5-pro
```

![](/assets/image/Cli/021.webp)

3. 回顾 [创建API令牌](/docs/register/4-token.html)，在 PackyApi 中创建 **Gemini** 分组令牌，并复制ApiKey后填入 `xxx`

![](/assets/image/Cli/026.webp)

4. 打开终端执行 `gemini`，看到交互界面并能正常回复即表示配置成功

![](/assets/image/Cli/022.webp)

@tab MacOS

1. 按下 “Command+Shift+G”，输入以下路径后回车，打开配置目录

```bash
~/.gemini
```

![](/assets/image/Cli/023.webp)

2. 若目录中没有 `.env` 文件，创建并写入以下内容

- **.env**：Gemini CLI的配置文件，主要设置自定义端点、ApiKey跟所用模型

![](/assets/image/Cli/024.webp)

```bash
GOOGLE_GEMINI_BASE_URL=https://www.packyapi.com
GEMINI_API_KEY=xxx
GEMINI_MODEL=gemini-2.5-pro
```

3. 回顾 [创建API令牌](/docs/register/4-token.html)，在 PackyApi 中创建 **Gemini** 分组令牌，填入 `xxx`

![](/assets/image/Cli/026.webp)

4. 在终端运行 `gemini`，可正常进入对话并收到回复即表示配置完成

![](/assets/image/Cli/022.webp)

:::
