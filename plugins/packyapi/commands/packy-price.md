---
description: 查 PackyAPI 模型价格($/1M tokens,给模型关键词自动列全部可用分组)
argument-hint: "[模型关键词] [--group cc|cc-sale|...] [--base 2]"
allowed-tools: Bash(node:*)
---

运行脚本查询 PackyAPI 计价,只输出命中行(结构化、省 token):

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/packy.ts" price $ARGUMENTS`

分组规则:给了模型关键词 → 自动列该模型**所有可用分组**的价(group 列区分);无关键词列全表默认 cc 组;`--group X` 锁定单组。
上表为实时 API 数据。若用户问某模型成本,直接引用对应 group 行的 in/out/cache 价($/1M tokens),不同分组倍率不同,按用户所在分组回答。
