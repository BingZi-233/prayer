import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { DIM, openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { LEGACY_SPLIT_CUTOFF as CUTOFF } from "@/lib/knowledge/reflection/legacy-split"

const run = promisify(execFile)
const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true }))
  )
})

const sha256 = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex")

type Fixture = { dir: string; dbPath: string; configDir: string }

/** 临时目录:数据库 + claude-config/settings.json;app 配置可覆盖。 */
async function fixture(
  app: Record<string, unknown> = {},
  opts: { settings?: boolean } = {}
): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "prayer-split-legacy-"))
  directories.push(dir)
  const configDir = join(dir, "claude-config")
  await mkdir(configDir)
  if (opts.settings !== false)
    await writeFile(join(configDir, "settings.json"), '{"env":{}}')
  const dbPath = join(dir, "agent.db")
  const db = openDb(dbPath)
  new Repo(db).setConfigRow(
    "app",
    JSON.stringify({ reflectPromoteMs: 0, claudeConfigDir: configDir, ...app })
  )
  db.close()
  return { dir, dbPath, configDir }
}

function runScript(dbPath: string, args: string[] = []) {
  return run(
    process.execPath,
    [
      "--experimental-transform-types",
      "scripts/split-legacy-reflections.ts",
      ...args,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DB_PATH: dbPath,
        NODE_ENV: "test",
        PRAYER_SPLIT_FAKE_EMBED: "1",
      },
    }
  )
}

type Failure = { code: number; stdout: string; stderr: string }

async function runFailing(dbPath: string, args: string[] = []) {
  try {
    await runScript(dbPath, args)
  } catch (err) {
    return err as Failure
  }
  throw new Error("脚本本应失败退出")
}

describe("split-legacy-reflections CLI 前置检查", () => {
  it("reflectPromoteMs≠0 → 非 0 退出,stderr 提示 reflectPromoteMs", async () => {
    const f = await fixture({ reflectPromoteMs: 3_600_000 })
    const err = await runFailing(f.dbPath)
    expect(err.code).not.toBe(0)
    expect(err.stderr).toContain("reflectPromoteMs")
    // 未生成计划或报告
    expect(
      (await readdir(f.dir)).filter((n) => n.startsWith("split-legacy-"))
    ).toEqual([])
  })

  it("数据库不存在 → 非 0 退出且不创建文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prayer-split-legacy-missing-"))
    directories.push(dir)
    const dbPath = join(dir, "nope.db")
    const err = await runFailing(dbPath)
    expect(err.code).not.toBe(0)
    expect(err.stderr).toContain("数据库不存在")
    expect(existsSync(dbPath)).toBe(false)
    expect(await readdir(dir)).toEqual([])
  })

  it("claudeConfigDir 缺 settings.json → 非 0 退出", async () => {
    const f = await fixture({}, { settings: false })
    const err = await runFailing(f.dbPath)
    expect(err.code).not.toBe(0)
    expect(err.stderr).toContain("settings.json")
  })

  it("--apply 缺参数 → 非 0 退出并打印用法", async () => {
    const f = await fixture()
    const err = await runFailing(f.dbPath, ["--apply"])
    expect(err.code).not.toBe(0)
    expect(err.stderr).toContain("用法")
  })

  it("--apply 计划 legacyBefore 不符 → 非 0 退出,不备份", async () => {
    const f = await fixture()
    const planPath = join(f.dir, "plan.json")
    await writeFile(
      planPath,
      JSON.stringify({
        version: 1,
        legacyBefore: CUTOFF + 1,
        createdAt: 1,
        groups: [],
      })
    )
    const err = await runFailing(f.dbPath, ["--apply", planPath])
    expect(err.code).not.toBe(0)
    expect(err.stderr).toContain("legacyBefore")
    expect((await readdir(f.dir)).some((n) => n.endsWith(".bak"))).toBe(false)
  })
})

describe("split-legacy-reflections CLI --apply", () => {
  it("dry-run 无整理块 → 写出计划与报告(不调模型),计划可被 --apply 读回", async () => {
    const f = await fixture()
    const { stdout } = await runScript(f.dbPath)
    const files = (await readdir(f.dir)).filter((n) =>
      n.startsWith("split-legacy-")
    )
    expect(files.filter((n) => n.endsWith(".json"))).toHaveLength(1)
    expect(files.filter((n) => n.endsWith(".md"))).toHaveLength(1)
    expect(stdout).toContain("嵌入预热完成")
    expect(stdout).toContain("组数:0")
    expect(stdout).toContain("不替换、仍留在检索的旧块:0 个")
    const planPath = join(
      f.dir,
      files.find((n) => n.endsWith(".json"))!
    )
    const applied = await runScript(f.dbPath, ["--apply", planPath])
    expect(applied.stdout).toContain("替换 0 组,拒绝 0 组,出错 0 组")
  })

  it("合法小计划 → 替换成功、生成备份、退出 0", async () => {
    const f = await fixture()
    const faq = "cc-sale 分组支持第三方客户端接入。cc 分组只允许官方客户端。"
    const pieces = [faq.slice(0, 18), faq.slice(18)]
    const db = openDb(f.dbPath)
    const repo = new Repo(db)
    const vec = new Float32Array(DIM)
    vec[0] = 1
    const ids = pieces.map((p) => {
      const id = repo.insertKbEntry(
        "human-reflection",
        p,
        "human-reflection:qq:0:1000",
        vec
      )
      db.prepare(
        "INSERT INTO reflection_meta (chunk_id, channel, group_id, question, answer, status, review_state) VALUES (?, 'qq', '0', NULL, ?, 'approved', 'legacy')"
      ).run(id, faq)
      return id
    })
    db.close()

    const units = [
      {
        text: "PackyAPI 的 cc-sale 分组支持第三方客户端接入。",
        answer: "cc-sale 分组支持第三方客户端接入。",
      },
      {
        text: "PackyAPI 的 cc 分组只允许官方客户端。",
        answer: "cc 分组只允许官方客户端。",
      },
    ]
    const planPath = join(f.dir, "plan.json")
    await writeFile(
      planPath,
      JSON.stringify({
        version: 1,
        legacyBefore: CUTOFF,
        createdAt: 1,
        groups: [
          {
            chunkIds: ids,
            contentSha256: pieces.map(sha256),
            faqSha256: sha256(faq),
            faqChars: faq.length,
            faqPreview: faq,
            status: "split",
            units,
            dropped: [],
            segments: [
              { chars: faq.length, units: 2, fallback: false, empty: false },
            ],
          },
        ],
      })
    )

    const { stdout } = await runScript(f.dbPath, ["--apply", planPath])
    expect(stdout).toContain("已备份")
    expect(stdout).toContain("替换 1 组,拒绝 0 组,出错 0 组")
    expect(
      (await readdir(f.dir)).some((n) => /^agent\.db\..+\.bak$/.test(n))
    ).toBe(true)

    const check = openDb(f.dbPath)
    try {
      const entries = new Repo(check).reflectionEntries()
      for (const id of ids)
        expect(entries.find((e) => e.id === id)).toBeUndefined()
      for (const u of units)
        expect(entries.find((e) => e.content === u.text)).toMatchObject({
          chatId: "0",
          answer: u.answer,
          status: "approved",
          reviewState: "legacy",
        })
    } finally {
      check.close()
    }
  })
})
