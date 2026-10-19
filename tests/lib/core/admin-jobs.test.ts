import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"
import { openDb } from "@/lib/core/db"
import { Repo } from "@/lib/core/db/repo"
import { getAdminJob, startAdminJob } from "@/lib/core/admin-jobs"
import { logger } from "@/lib/core/logger"

let db: ReturnType<typeof openDb>
let repo: Repo
beforeEach(() => {
  db = openDb(":memory:", 3)
  repo = new Repo(db)
})
afterEach(() => {
  db.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it("结果异常留下可关联的脱敏日志,日志故障也不阻止任务结束", async () => {
  const log = vi.spyOn(logger, "error")
  let work!: () => Promise<void>
  const run = async () => {
    throw new Error("token=private")
  }
  const job = startAdminJob(repo, "reflection.promote", run, (callback) => {
    work = callback
  })!
  await work()
  expect(log).toHaveBeenCalledWith(expect.stringContaining(job.id), {
    scope: "admin-jobs",
  })
  expect(JSON.stringify(log.mock.calls)).not.toContain("private")
  expect(getAdminJob(repo, job.id)).toMatchObject({
    status: "completed",
    result: { ok: false, outcomeUnknown: true },
  })
  log.mockImplementation(() => {
    throw new Error("logging unavailable")
  })
  const second = startAdminJob(repo, "reflection.promote", run, (callback) => {
    work = callback
  })!
  await work()
  expect(getAdminJob(repo, second.id)?.status).toBe("completed")
})

it("立即登记任务,共享连接的重复提交只执行一次,完成后可读取原始结果", async () => {
  const scheduled: (() => Promise<void>)[] = []
  const schedule = (work: () => Promise<void>) => {
    scheduled.push(work)
  }
  let finish!: () => void
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  const run = vi.fn(async () => {
    await gate
    return NextResponse.json({ ok: true, data: { promoted: 1 } })
  })
  const job = startAdminJob(repo, "reflection.promote", run, schedule)!
  const repeated = startAdminJob(
    new Repo(db),
    "reflection.promote",
    run,
    schedule
  )!
  expect(job.id).toBe(repeated.id)
  expect(run).not.toHaveBeenCalled()
  expect(scheduled).toHaveLength(1)
  const pending = scheduled[0]()
  expect(getAdminJob(repo, job.id)?.status).toBe("running")
  finish()
  await pending
  expect(getAdminJob(repo, job.id)).toMatchObject({
    status: "completed",
    httpStatus: 200,
    result: { ok: true, data: { promoted: 1 } },
  })
  expect(run).toHaveBeenCalledTimes(1)
})

it("部分失败保留原始 HTTP 结果,非 JSON 及异常结果不泄露原始内容", async () => {
  for (const run of [
    async () =>
      NextResponse.json(
        { ok: false, error: "部分失败：已升格 2 条" },
        { status: 503 }
      ),
    async () =>
      new NextResponse("<!DOCTYPE html><p>token=private</p>", { status: 524 }),
    async () => {
      throw new Error("token=private")
    },
  ]) {
    let work!: () => Promise<void>
    const job = startAdminJob(repo, "reflection.promote", run, (callback) => {
      work = callback
    })!
    await work()
    const result = getAdminJob(repo, job.id)!
    expect(result.status).toBe("completed")
    expect(result.result?.ok).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/DOCTYPE|private/)
  }
})

it("按连接隔离结果,完成记录一小时后过期,运行任务不会被过期重启", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  let work!: () => Promise<void>
  const run = async () => NextResponse.json({ ok: true, data: {} })
  const job = startAdminJob(repo, "reflection.promote", run, (callback) => {
    work = callback
  })!
  const otherDb = openDb(":memory:", 3)
  expect(getAdminJob(new Repo(otherDb), job.id)).toBeNull()
  otherDb.close()
  vi.setSystemTime(4_000_000)
  expect(getAdminJob(repo, job.id)?.status).toBe("running")
  expect(
    startAdminJob(repo, "reflection.promote", run, () => {
      throw new Error("must dedupe")
    })?.id
  ).toBe(job.id)
  await work()
  vi.setSystemTime(8_000_000)
  expect(getAdminJob(repo, job.id)).toBeNull()
})

it("运行任务有容量上限,不为新请求淘汰正在执行的任务", async () => {
  const run = async () => NextResponse.json({ ok: true, data: {} })
  for (let i = 0; i < 32; i++)
    expect(startAdminJob(repo, String(i), run, () => {})).not.toBeNull()
  expect(startAdminJob(repo, "overflow", run, () => {})).toBeNull()
  expect(startAdminJob(repo, "0", run, () => {})).not.toBeNull()
})

it("调度失败不残留运行标记,允许后续重新提交", () => {
  const run = async () => NextResponse.json({ ok: true, data: {} })
  expect(() =>
    startAdminJob(repo, "reflection.promote", run, () => {
      throw new Error("scheduler unavailable")
    })
  ).toThrow("scheduler unavailable")
  expect(
    startAdminJob(repo, "reflection.promote", run, () => {})
  ).not.toBeNull()
})
