---
name: cs
description: 检索本仓库客服知识库(产品文档 / FAQ / 人工反思沉淀),回答产品、业务、接入、故障排查等事实性问题前先查。当被问到 PackyAPI 相关的注册、令牌、CLI 接入、ccswitch、绘图、条款、退款、常见问题,或任何"知识库里怎么说"的问题时使用;底层是本地 bge-small-zh 向量 + sqlite-vec 语义检索,只读,不联网、不改库。
---

# 客服知识库检索(cs)

本 plugin 内置 stdio MCP server(名 `cs`),暴露单工具 `kb_search`,对本仓库的**客服知识库**做语义检索。

知识库内容 = `docs/kb/` 下灌入的产品/业务文档,按主题分目录:`register`(注册)、`token`(令牌)、`cli`(命令行接入)、`ccswitch`、`paint`(绘图)、`tos`(条款)、`faq`、`advanced`,外加人工反思沉淀的条目(`doc=human-reflection`)。检索命中的片段来自这些文档。

## 铁律:事实性问题先检索,严格依据结果作答

- 任何产品 / 业务 / 接入配置 / 故障排查问题,**先调 `kb_search`**,再基于返回片段作答;不要凭记忆编造。
- 检索返回**语义最相近的 top-5 片段**(不是精确匹配),按相关度排序,格式 `[1] …\n[2] …`。
- 若返回「知识库无相关内容。」→ 知识库确实没有,别硬答。价格 / 可用模型 ID 这类实时数据,改直接调用 `packy` 工具取。

## 工具 `kb_search`

单参数,直接调用,无需手动跑脚本:

| 参数 | 类型 | 说明 |
|---|---|---|
| `query` | string(必填) | 用户问题或检索关键词 |

调用示例:
- `{ "query": "怎么注册账号" }`
- `{ "query": "cli 接入 base_url 怎么配" }`
- `{ "query": "退款政策" }`

## 检索质量小贴士

- 语义检索,**用自然语言整句比堆关键词更准**(embedding 对完整语义敏感)。
- 一次没命中好片段,换个说法重试(同义词 / 更具体的场景),而非反复同一句。
- 片段长度上限 ~500 字符(灌库切分粒度),一个主题可能分散在多个片段里,综合多条再答。

## 底层实现(排障用)

- 模型 `Xenova/bge-small-zh-v1.5`,本地跑,`pooling=mean` + `normalize`。
- 向量近邻:`sqlite-vec` 的 `kb_vec MATCH` + `k=5`,join `kb_chunks` 取正文。
- DB 只读打开(`DB_PATH` 由父进程传,缺省 `data/agent.db`),**不建表、不迁移、不写入**;灌库另走 `scripts/ingest.ts`(读 `docs/kb/`)。
- Server 为 TypeScript,Node(v22.6+/24)原生 strip 直跑;依赖(SDK / better-sqlite3 / sqlite-vec / zod)从 repo 根 node_modules 解析。
