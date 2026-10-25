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
  let promotionSettled = false
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
  void promotion.then(() => {
    promotionSettled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  // 整理持锁期间升格必须等待,不能拿旧快照先跑
  expect(promotionSettled).toBe(false)
  release()
  expect(await compact).toBe("completed")
  // 读到的是提交后的快照:两条 chatId=100 原条目已被整理成一条 chatId=0 的整理块,
  // 而整理块不参与自动升格。若读了旧快照,这里会是 considered 2 并调用评审。
  expect(await promotion).toEqual({ considered: 0, promoted: 0 })
  expect(promotionCalls).toBe(0)
  db.close()
})
