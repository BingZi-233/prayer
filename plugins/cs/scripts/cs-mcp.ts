#!/usr/bin/env node
/**
 * cs 知识库检索 MCP server —— 单工具 `kb_search`。stdio transport。
 * TypeScript 由 Node(v22.6+/24)原生 strip 运行(含下方 dynamic import 的 .ts)。
 *
 * 依赖解析:SDK / better-sqlite3 / sqlite-vec / zod 从 repo 根 node_modules 解析
 *   —— 本 plugin 装入 cache 后仍在 prayer repo 目录内,Node 向上走查命中根 node_modules。
 * 业务复用:embed(模型/向量)、runKbSearch(检索+格式)与 KB_SEARCH_SQL(向量近邻 SQL)
 *   复用 repo 的 lib,经 repo 根绝对路径 dynamic import。
 *   注意:Node strip-only 不支持 TS「参数属性」,故不导入 lib/core/db/repo.ts(其 constructor(private db) 会报错);
 *   向量近邻 SQL 从 lib/core/db/kb-sql.ts 导入(唯一事实源),以 repo-like { searchKb } 传给 runKbSearch
 *   (kb.ts 仅 import type Repo,运行时不加载 repo.ts)。
 * DB 路径:父进程 env DB_PATH 传入(runtime.start / introspect 已绝对化),只读打开,不建表/迁移。
 */
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

// 从脚本目录向上找 repo 根(同时含 node_modules 与 package.json)。
// plugin 在 cache(data/claude-config/plugins/cache/…)运行时逐级上溯至 prayer 根。
function findRepoRoot(start: string): string {
  let dir = start
  for (;;) {
    if (
      existsSync(join(dir, "node_modules")) &&
      existsSync(join(dir, "package.json"))
    )
      return dir
    const up = dirname(dir)
    if (up === dir) throw new Error("cs-mcp: 未找到 repo 根(缺 node_modules)")
    dir = up
  }
}

// server 版本随 plugin 走:读同插件 .claude-plugin/plugin.json,避免手改漂移。
function pluginVersion(scriptDir: string): string {
  try {
    const p = join(scriptDir, "..", ".claude-plugin", "plugin.json")
    return JSON.parse(readFileSync(p, "utf8")).version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

const server = new McpServer({
  name: "cs",
  version: pluginVersion(dirname(fileURLToPath(import.meta.url))),
})

async function main(): Promise<void> {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)))
  const { embed } = await import(
    pathToFileURL(join(root, "lib/model/embed.ts")).href
  )
  const { runKbSearch, KB_TOOL_DESC } = await import(
    pathToFileURL(join(root, "lib/knowledge/kb.ts")).href
  )
  const { KB_SEARCH_SQL } = await import(
    pathToFileURL(join(root, "lib/core/db/kb-sql.ts")).href
  )

  // 只读打开:多进程共享同一 WAL 库,检索为纯读;不建表/迁移(由主进程负责)
  const dbPath = resolve(process.env.DB_PATH ?? join(root, "data/agent.db"))
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  sqliteVec.load(db)

  // 与 repo.searchKb 共用 KB_SEARCH_SQL(lib/core/db/kb-sql.ts 唯一事实源):此前内联副本
  // 漏了 reflection_meta 过滤,管理员驳回的知识仍会经 kb_search 漏给用户
  const stmt = db.prepare(KB_SEARCH_SQL)
  const repo = {
    searchKb: (query: Float32Array, k: number) =>
      stmt.all(Buffer.from(query.buffer), k),
  }

  server.registerTool(
    "kb_search",
    {
      title: "客服知识库语义检索",
      description: KB_TOOL_DESC,
      inputSchema: {
        query: z
          .string()
          .describe(
            "用户问题或检索关键词;用完整自然语言句子(而非零散关键词)命中更准"
          ),
      },
    },
    async ({ query }: { query: string }) => ({
      content: [
        {
          type: "text" as const,
          text: await runKbSearch(repo as never, embed, query),
        },
      ],
    })
  )

  await server.connect(new StdioServerTransport())
}

// 直接运行时启动 stdio server;被 import(测试)时不启动。
// pathToFileURL + realpath 而非裸 `file://${argv[1]}` 拼接:路径含空格/需百分号
// 编码字符时裸拼接不成立;入口经 symlink 时 argv[1] 非 realpath(import.meta.url
// 是),realpathSync 对齐后再比较。
if (
  import.meta.url ===
  pathToFileURL(realpathSync(resolve(process.argv[1]!))).href
) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
