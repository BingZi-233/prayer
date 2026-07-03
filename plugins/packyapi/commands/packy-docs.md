---
description: 定位并读取 PackyAPI 官方文档页(精准单页,不盲爬)
argument-hint: "<主题,如 claude / token分组 / 环境变量 / 常见问题>"
allowed-tools: WebFetch
---

用户要查 PackyAPI 文档主题:**$ARGUMENTS**

步骤:
1. 从 skill `packyapi` 的 `references/docs-map.md`(sitemap 页面映射)里,按主题匹配**一个**最相关 URL。
2. 仅对该 URL 调 WebFetch,prompt 里带上用户的具体问题,只取所需片段。
3. 不确定选哪页时,先列 2-3 个候选 URL 让用户确认,别一次抓多页。

配置类问题(base_url / auth token / 环境变量)优先看 `docs/cli/*` 与 `docs/register/5-env.html`。
