import { expect, it, vi } from "vitest"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"
import { promoteEntry, runPromote } from "@/lib/knowledge/reflection/promoter"

it("批量升格与单条升格使用不同 Repo 时仍串行,后者等前者释放锁后才开始", async () => {
  const db = openDb(":memory:", 3)
  const batchRepo = new Repo(db)
  const entryRepo = new Repo(db)
  const embed = async () => new Float32Array([1, 0, 0])
  const id = batchRepo.insertKbEntry(
    "human-reflection",
    "重复问题：完整操作步骤甲",
    "human-reflection:qq:100:1",
    await embed()
  )
  batchRepo.insertReflectionMeta(id, "qq", "100", "问甲", "答甲")

  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const batch = runPromote({
    repo: batchRepo,
    adminSurface: null,
    embed,
    queryFn: (() =>
      (async function* () {
        entered()
        await gate
        yield {
          type: "result",
          subtype: "success",
          structured_output: { decisions: [] },
        }
      })()) as never,
  })
  await started

  // 单条升格走另一个 Repo 实例,但共享同一连接(coordinationKey 相同)。
  const composeFn = vi.fn(async () => ({
    ok: false as const,
    reason: "测试中止",
  }))
  const single = promoteEntry({
    repo: entryRepo,
    chunkId: id,
    embed,
    composeFn: composeFn as never,
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  // 批量评审持锁期间,单条升格不得开始成文
  expect(composeFn).not.toHaveBeenCalled()

  release()
  await batch
  expect(await single).toEqual({ ok: false, reason: "测试中止" })
  expect(composeFn).toHaveBeenCalledTimes(1)
  db.close()
})
