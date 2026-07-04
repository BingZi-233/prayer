---
title: Claude Code配置
icon: material-icon-theme:claude
order: 2
---

::: tabs

@tab Windows

1. 键盘按下“Win+R”键，输入以下内容后回车，打开Claude Code配置目录

```bash
%userprofile%\.claude
```

![](/assets/image/Cli/013.webp)

2. 目录内容如图所示，如果目录中没有 `settings.json`，你需要手动创建后打开

- **settings.json**：Claude主要的配置文件，主要用来配置中转站地址以及ApiKey，以及一些hooks，plugins等

![](/assets/image/Cli/014.webp)

3. 将以下内容写入 `settings.json`

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://www.packyapi.com",
    "ANTHROPIC_AUTH_TOKEN": "xxx",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1"
  }
}
```

![](/assets/image/Cli/015.webp)

4. 回顾 [创建API令牌](/docs/register/4-token.html)，在 PackyApi 中创建 **CC** 分组的令牌，替换上方 `xxx`部分

![](/assets/image/Cli/025.webp)

5. 在windows终端运行 `claude`，出现对话界面后进行对话测试，能收到回复即表示配置成功

![](/assets/image/Cli/016.webp)

@tab MacOS

1. 在访达界面按下 “Command+Shift+G”，输入以下路径后回车，打开配置目录

```bash
~/.claude
```

![](/assets/image/Cli/017.webp)

2. 若目录不存在 `settings.json`，需要你手动进行创建

- **settings.json**：Claude主要的配置文件，主要用来配置中转站地址以及ApiKey，以及一些hooks，plugins等

![](/assets/image/Cli/018.webp)

3. 将以下内容写入 `settings.json`

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://www.packyapi.com",
    "ANTHROPIC_AUTH_TOKEN": "xxx",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1"
  }
}
```

![](/assets/image/Cli/015.webp)

4. 回顾 [创建API令牌](/docs/register/4-token.html)，在 PackyApi 中创建 **CC** 分组的令牌，替换上方 `xxx`

![](/assets/image/Cli/025.webp)

5. 在终端运行 `claude`，看到对话界面并能正常回复即表示配置完成

![](/assets/image/Cli/016.webp)

:::

::: important
**注意，如果配置完仍然有报错问题，提示你需要登录，请看如下链接解决**
[claude-code-无法连接到-anthropic-服务](/docs/faq/CC.html#claude-code-无法连接到-anthropic-服务)
:::
