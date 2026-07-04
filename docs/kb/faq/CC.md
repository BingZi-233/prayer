---
title: Claude Code相关问题
icon: material-icon-theme:claude
order: 1
---

### 如何在Vscode CC插件中使用PackyApi

::: tabs

@tab Windows
1. 确保你已进行 [环境检查](/docs/cli/1-env.html) 并保证你的claude code cli是没问题的，如果有问题，请按照教程进行配置

2. 键盘按下“Win+R”键，输入以下内容后回车，打开Claude Code配置目录

```bash
%userprofile%\.claude
```

![](/assets/image/Cli/013.webp)

3. 目录内容如图所示，如果目录中没有 `config.json`，你需要手动创建后打开

- **config.json**：配置Vscode的Claude Code插件的一些行为

![](/assets/image/Cli/014.webp)

4. 在`config.json`中写入以下内容后保存

```json
{
  "primaryApiKey": "PackyApi"
}
```

5. 重启你的Vscode，开始愉快使用吧！

@tab MacOS

1. 确保你已进行 [环境检查](/docs/cli/1-env.html) 并保证你的claude code cli是没问题的，如果有问题，请按照教程进行配置

2. 在访达界面按下 “Command+Shift+G”，输入以下路径后回车，打开配置目录

```bash
~/.claude
```

![](/assets/image/Cli/017.webp)

3. 目录内容如图所示，如果目录中没有 `config.json`，你需要手动创建后打开

- **config.json**：配置Vscode的Claude Code插件的一些行为

![](/assets/image/Cli/018.webp)

4. 在`config.json`中写入以下内容后保存

```json
{
  "primaryApiKey": "PackyApi"
}
```

5. 重启你的Vscode，开始愉快使用吧！

:::

### Claude Code 中常用命令

| 命令 | 功能说明 |
| --- | --- |
| /claude | 在当前目录启动交互式 REPL，对话式使用 Claude Code。 |
| /claude "解释这个项目" | 启动 REPL 并带上初始问题，一进来就让 Claude 分析项目。 |
| /claude -p "解释这个函数" | 使用 print 模式一次性问答，输出结果后直接退出，便于脚本/CI 调用。 |
| /cat logs.txt \| claude -p "帮我总结错误" | 将文件或命令输出通过管道喂给 Claude，再配合 `-p` 做总结、分析。 |
| /claude -c | 继续当前目录最近的一次会话，在原有上下文里接着聊。 |
| /claude -c -p "检查类型错误" | 在最近会话上下文中执行一次性请求，常用于自动化检查。 |
| /claude -r "abc123" "把这个 PR 完成" | 通过会话 ID 恢复指定会话，并继续执行新的任务。 |
| /claude update | 将 Claude Code CLI 更新到最新版本。 |
| /claude mcp | 管理和配置 MCP 服务器，让 Claude 能访问外部数据源和工具。 |
| /claude --add-dir ../apps ../lib | 为 Claude 额外添加可访问的代码目录，支持跨多个路径读代码。 |
| /claude --agents '{"reviewer":{...}}' | 通过 JSON 临时定义子 Agent，例如 code-reviewer、debugger 等。 |
| /claude -p "生成接口文档" --output-format json | 使用 JSON 格式输出回答，方便后续脚本解析处理。 |
| /claude --model sonnet | 指定会话使用的模型（如 sonnet / opus 或具体模型名）。 |
| /claude --verbose | 打开详细日志，显示工具调用和内部步骤，便于调试。 |
| /claude --resume abc123 "继续修这个 Bug" | 通过会话 ID 恢复会话，在任意目录继续之前的工作。 |
| /claude --continue | 载入当前目录最近的一次会话，相当于“继续上次对话”。 |
| /claude --append-system-prompt "始终使用 TypeScript" | 在默认系统提示后追加自定义规则，不影响默认行为。 |
| /claude --dangerously-skip-permissions | 跳过权限确认，让 Claude 自动执行读写文件/运行命令（高风险，仅在完全信任环境使用）。 |

### claude code 无法连接到 Anthropic 服务

::: info 注意事项
**如果你是首次配置根据链接跳转到这一步，直接按照下面的教程运行命令即可**
:::

使用npm安装完claude之后。
在命令行输入claude报了如下错误：
```text
Unable to connect to Anthropic services
Failed to connect to api.anthropic.com: ERR BAD REQUEST
lease check your internet connection and network settings.
Note: Claude Code might not be available in your country, Check supported countries atnttps://anthropic.com/supported-countriesS E:ltoollclaude code>
```

![](/assets/image/FAQ/CC/001.webp)

或是在你初次配置时出现以下问题：

![](/assets/image/FAQ/CC/003.webp)

::: tabs

@tab Windows

1. 按下键盘 `Win + R` 键，输入 `cmd` 后回车，打开命令行程序

2. 在命令行中运行以下命令后回车

```bash
powershell -Command "$f='%USERPROFILE%\.claude.json';$j=Get-Content $f|ConvertFrom-Json;$j|Add-Member -NotePropertyName 'hasCompletedOnboarding' -NotePropertyValue $true -Force;$j|ConvertTo-Json|Set-Content $f"
```

3. 重启你的Claude Cli

@tab MacOS

1. 在APP列表中找到终端程序，点击运行
![](/assets/image/FAQ/CC/002.webp)

2. 在终端中运行以下命令后回车

```bash
jq '. + {"hasCompletedOnboarding": true}' ~/.claude.json > /tmp/tmp.json && mv /tmp/tmp.json ~/.claude.json
```

> [!tip]
> 注意，如果提示未找到jq，可以输入 `brew install jq` 进行安装

3. 重启你的Claude Cli
:::

### Claude Code 如何切换回 200K 上下文并禁用非必要流量

如果你希望将 Claude Code 从 1M 上下文切换回 200K 上下文，并关闭一些
非必要请求与终端标题变更，可以在 `settings.json` 的 `env` 中加入以下配置。

::: tabs

@tab Windows

1. 按下键盘 `Win + R`，输入以下内容后回车

```bash
%userprofile%\.claude
```

2. 打开或创建 `settings.json`

3. 确认 `env` 中包含以下内容

```json
{
  "env": {
    "CLAUDE_CODE_DISABLE_1M_CONTEXT": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1"
  }
}
```

@tab MacOS

1. 在访达中按下 `Command + Shift + G`，输入以下路径后回车

```bash
~/.claude
```

2. 打开或创建 `settings.json`

3. 确认 `env` 中包含以下内容

```json
{
  "env": {
    "CLAUDE_CODE_DISABLE_1M_CONTEXT": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1"
  }
}
```

:::
