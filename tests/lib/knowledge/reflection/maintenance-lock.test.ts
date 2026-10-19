import { expect, it } from "vitest"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"
import { runCompactWithOutcome } from "@/lib/knowledge/reflection/compactor"
import { runPromote } from "@/lib/knowledge/reflection/promoter"

it("定时整理与 API 升格使用不同 Repo 时仍串行,升格读取提交后的新快照", async () => {
  const db = openDb(":memory:", 3)
  const timerRepo = new Repo(db)
  const apiRepo = new Repo(db)
  const embed = async () => new Float32Array([1, 0, 0])
  for (const content of [
    "重复问题：完整操作步骤甲",
    "重复问题：完整操作步骤乙",
  ])
    timerRepo.insertKbEntry(
      "human-reflection",
      content,
      "human-reflection:qq:100:1",
      await embed()
    )
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const compact = runCompactWithOutcome({
    repo: timerRepo,
    adminSurface: null,
    minEntries: 2,
    embed,
    queryFn: (() =>
      (async function* () {
        entered()
        await gate
        yield {
          type: "result",
          subtype: "success",
          structured_output: {
            items: [
              { faq: "合并问题：完整操作步骤甲乙。", sourceIndices: [1, 2] },
            ],
          },
        }
      })()) as never,
  })
  await started
  let promotionCalls = 0
  const promotion = runPromote({
    repo: apiRepo,
    adminSurface: null,
    embed,
    queryFn: (() =>
      (async function* () {
        promotionCalls++
        yield {
          type: "result",
          subtype: "success",
          structured_output: { decisions: [] },
        }
      })()) as never,
  })
  await Promise.resolve()
  expect(promotionCalls).toBe(0)
  release()
  expect(await compact).toBe("completed")
  expect(await promotion).toEqual({ considered: 1, promoted: 0 })
  expect(promotionCalls).toBe(1)
  db.close()
})
