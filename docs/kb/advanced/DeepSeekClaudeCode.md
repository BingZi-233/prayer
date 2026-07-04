---
title: DS接入CC
icon: simple-icons:deepseek
---

## 前置准备

本教程用于将 **DeepSeek** 分组接入 **Claude Code** 使用。开始前请先确认本地已经完成 Claude Code 安装；如果还没有安装，可以先参考 [Claude Code配置](/docs/cli/2-claude.html) 中的安装与基础配置步骤。

## 创建 DeepSeek 令牌

1. 回顾 [创建 API 令牌](/docs/register/4-token.html)，在 PackyApi 中创建新的 API 令牌。

2. 名称可以填写 `deepseek-officially`，令牌分组请选择 `deepseek-officially`。创建完成后，复制生成的 API Key，后续配置会用到。

![](/assets/image/Advanced/DeepSeekClaudeCode/01.webp)

## 使用 CC Switch 配置

::: tip 推荐方式
如果你不熟悉 Claude Code 的 `settings.json`，建议优先使用 CC Switch 配置。
:::

1. 打开 CC Switch，在 Claude Code 配置中点击 `添加供应商`。

2. 按照下方内容填写供应商信息：

    - **供应商名称**：`PackyCode`
    - **官网链接**：`https://www.packyapi.com`
    - **API Key**：填写刚才创建的 `deepseek-officially` 分组 API Key
    - **请求地址**：`https://www.packyapi.com`
    - **API 格式**：`Anthropic Messages（原生）`
    - **主模型**：默认填写 `deepseek-v4-pro`；需要开启 1m 上下文时才填写 `deepseek-v4-pro[1m]`
    - **推理模型（Thinking）**：默认填写 `deepseek-v4-pro`；需要开启 1m 上下文时才填写 `deepseek-v4-pro[1m]`
    - **Haiku 默认模型**：默认填写 `deepseek-v4-flash`；需要开启 1m 上下文时才填写 `deepseek-v4-flash[1m]`
    - **Sonnet 默认模型**：默认填写 `deepseek-v4-pro`；需要开启 1m 上下文时才填写 `deepseek-v4-pro[1m]`
    - **Opus 默认模型**：默认填写 `deepseek-v4-pro`；需要开启 1m 上下文时才填写 `deepseek-v4-pro[1m]`

![](/assets/image/Advanced/DeepSeekClaudeCode/02.webp)

::: important 模型填写说明
默认不需要设置 `[1m]` 后缀，直接填写 `deepseek-v4-pro` 或 `deepseek-v4-flash` 即可。只有需要开启 1m 上下文时，才把模型名设置为 `deepseek-v4-pro[1m]` 或 `deepseek-v4-flash[1m]`。

请以你创建令牌时实际可用的模型名称为准。
:::

## 手动配置 settings.json

如果你希望手动配置 Claude Code，也可以直接编辑 Claude Code 的 `settings.json` 文件。

::: tabs

@tab Windows

配置文件通常位于：

```bash
%userprofile%\.claude\settings.json
```

@tab MacOS

配置文件通常位于：

```bash
~/.claude/settings.json
```

:::

将下面内容写入 `settings.json`，并把 `{{新建的令牌}}` 替换为刚才复制的 `deepseek-officially` 分组 API Key：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://www.packyapi.com",
    "ANTHROPIC_AUTH_TOKEN": "{{新建的令牌}}",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
    "ANTHROPIC_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_REASONING_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro"
  }
}
```

::: warning
手动配置时请保持模型名称与令牌分组实际支持的模型一致。默认不设置 `[1m]`；只有需要开启 1m 上下文时，才将上方的 `deepseek-v4-pro` 改为 `deepseek-v4-pro[1m]`，将 `deepseek-v4-flash` 改为 `deepseek-v4-flash[1m]`。
:::

## 验证配置

1. 重新打开终端，运行 `claude` 启动 Claude Code。

2. 在 Claude Code 界面确认左侧显示的模型名称是否为刚才配置的 DeepSeek 模型。默认应显示 `deepseek-v4-pro`；只有开启 1m 时才会显示 `deepseek-v4-pro[1m]`。

3. 直接在 Claude Code 中发送一条测试消息，能够正常回复即表示配置完成。

![](/assets/image/Advanced/DeepSeekClaudeCode/03.webp)

::: warning 使用提醒
DeepSeek 接入 Claude Code 的配置是否生效，请直接以 Claude Code 内的实际对话结果为准。不要在 CC Switch 中使用该供应商的测试功能作为最终判断。
:::
