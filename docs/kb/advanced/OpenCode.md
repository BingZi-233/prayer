---
title: OpenCode
icon: mynaui:code-hexagon-solid
---

## 项目介绍

![](/assets/image/Advanced/OpenCode/01.webp)

- **项目定位**: 一个开源的 AI 编程助手，可在终端、IDE 或桌面环境中辅助编写、调试和改进代码。
- **核心特色**:  
  - 原生终端或 TUI 支持，适合命令行开发者。
  - 自动加载正确的语言服务器（LSP）以提升上下文理解。
  - 支持多会话并行与会话链接共享。
  - 支持 75+ 模型提供商，包括本地模型。
  - 可与 GitHub Copilot、ChatGPT Plus/Pro 等集成。
- **平台支持**: 终端 CLI、桌面应用（Beta）、IDE 扩展等。

## 环境配置

1. 打开你的终端，运行以下命令全局安装OpenCode

```bash
npm install -g opencode-ai
```

2. 安装完成后，在终端输入 `opencode` 命令若出现界面，则安装成功

![](/assets/image/Advanced/OpenCode/02.webp)

3. 查看 [CC Switch下载](/docs/ccswitch/1-common.html) 一节的内容，下载并安装 CC-Switch 到本地，安装并打开软件

4. 上方配置项选择到 `OpenCode` ，然后点击 `添加供应商` 按钮

![](/assets/image/Advanced/OpenCode/03.webp)

5. 进行多项配置：

    - 在 `预设供应商` 中选择 `PackyCode`
    - 在 `供应商标识` 中填写分组名称，比如 PackyApi-Codex
    - 在 `接口格式` 中选择合适的分组
        - Claude系列模型：`Anthropic`
        - Codex系列模型：`OpenAI`
        - Gemini系列模型：`Google (Gemini)`
    - 在 `API Key` 中填入 [创建API令牌](/docs/register/4-token.html) 一节中你创建的Key
    ::: important
    **目前支持OpenCode的分组：**

    - **GPT：[codex分组](/docs/token/2-group.html#codex分组)、[gpt-officially分组](/docs/token/2-group.html#gpt-officially分组)**
    - **Claude：[aws-q分组](/docs/token/2-group.html#aws-q分组)、[aws分组](/docs/token/2-group.html#aws分组)、[claude-officially分组](/docs/token/2-group.html#claude-officially分组)**

    - **Gemini**：[gemini-slb分组](/docs/token/2-group.html#gemini-slb分组)

    **请您创建正确分组的APIKEY后填入**
    :::

    - 在 `额外选项` 中配置键值对 `{"setCacheKey":true}`
    - 在 `模型配置` 中配置ApiKey对应分组下正确的模型名，每个分组下的模型可在 [令牌分组介绍](/docs/token/2-group.html) 一节中查询。
    **比如现在我的ApiKey对应的是Codex分组，那么我可以直接配置：**
        - 模型ID：gpt-5.2 显示名称：gpt-5.2
        - 模型ID：gpt-5.2-codex 显示名称：gpt-5.2-codex
    - 全部配置好后，点击右下角 `添加` 按钮

![](/assets/image/Advanced/OpenCode/04.webp)

6. 在界面中选择刚配置好的 PackyApi 渠道，点击添加按钮

![](/assets/image/Advanced/OpenCode/05.webp)

## 验证配置
1. 重新打开终端，输入 `opencode` 运行

2. 输入 `/models` 命令，观察刚才配置的 PackyApi的渠道是否存在，如果存在则配置成功

![](/assets/image/Advanced/OpenCode/06.webp)

3. 开始愉快的对话吧~

![](/assets/image/Advanced/OpenCode/07.webp)
