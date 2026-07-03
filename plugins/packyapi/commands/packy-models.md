---
description: 列 PackyAPI 某组/某端点可用模型 ID
argument-hint: "[--endpoint anthropic|openai|gemini] [--group cc]"
allowed-tools: Bash(node:*)
---

列出实时可用模型 ID:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/packy.ts" models $ARGUMENTS`

配 Claude Agent SDK / Claude Code 时,选 `--endpoint anthropic` 的模型 ID 填 `ANTHROPIC_MODEL`。
