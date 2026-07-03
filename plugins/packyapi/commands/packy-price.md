---
description: 查 PackyAPI 模型价格($/1M tokens,默认 cc 组)
argument-hint: "[模型关键词] [--group cc|cc-sale|...] [--base 2]"
allowed-tools: Bash(node:*)
---

运行脚本查询 PackyAPI 计价,只输出命中行(结构化、省 token):

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/packy.ts" price $ARGUMENTS`

上表为实时 API 数据。若用户问某模型成本,直接引用对应行的 in/out/cache 价($/1M tokens)。
需换组比价时追加 `--group cc-sale`(便宜组倍率 0.8)。
