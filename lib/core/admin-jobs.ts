import { randomUUID } from "node:crypto"
import { after, NextResponse } from "next/server"
import type { Repo } from "./db/repo"
import { fail, ok, safeApiError } from "./api"
import { logger } from "./logger"

type JobResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; outcomeUnknown?: true }
export type AdminJob = {
  id: string
  status: "running" | "completed"
  startedAt: number
  completedAt?: number
  httpStatus?: number
  result?: JobResult
}
type JobStore = { jobs: Map<string, AdminJob>; active: Map<string, string> }
const root = globalThis as typeof globalThis & {
  __prayerAdminJobs?: WeakMap<object, JobStore>
}
const stores = (root.__prayerAdminJobs ??= new WeakMap())
const MAX_JOBS = 32
const COMPLETED_TTL_MS = 3_600_000

// ponytail: 单进程、内存状态；进程重启后通过原审计记录核对，跨进程需持久任务表。
function storeFor(repo: Repo): JobStore {
  const key = repo.coordinationKey ?? repo
  let store = stores.get(key)
  if (!store) {
    store = { jobs: new Map(), active: new Map() }
    stores.set(key, store)
  }
  for (const [id, job] of store.jobs) {
    if (
      job.completedAt != null &&
      Date.now() - job.completedAt >= COMPLETED_TTL_MS
    )
      store.jobs.delete(id)
  }
  return store
}

/** 复用在途任务；只淘汰已结束记录，绝不因过期而重新执行仍在运行的任务。 */
export function startAdminJob(
  repo: Repo,
  key: string,
  run: () => Promise<NextResponse>,
  schedule: (work: () => Promise<void>) => void
): AdminJob | null {
  const store = storeFor(repo)
  const existing = store.active.get(key)
  if (existing) return store.jobs.get(existing)!
  if (store.jobs.size >= MAX_JOBS) {
    const oldestCompleted = [...store.jobs.values()].find(
      (job) => job.status === "completed"
    )
    if (!oldestCompleted) return null
    store.jobs.delete(oldestCompleted.id)
  }
  const job: AdminJob = {
    id: randomUUID(),
    status: "running",
    startedAt: Date.now(),
  }
  store.jobs.set(job.id, job)
  store.active.set(key, job.id)
  try {
    schedule(async () => {
      try {
        const response = await run()
        const result = await response.json()
        if (
          !result ||
          typeof result.ok !== "boolean" ||
          (result.ok ? !("data" in result) : typeof result.error !== "string")
        )
          throw new Error("invalid job response")
        job.result = result.ok
          ? ok(result.data)
          : {
              ...fail(result.error),
              ...(result.outcomeUnknown === true
                ? { outcomeUnknown: true as const }
                : {}),
            }
        job.httpStatus = response.status
      } catch (err) {
        try {
          logger.error(`[admin-job] ${key} ${job.id}: ${safeApiError(err)}`, {
            scope: "admin-jobs",
          })
        } catch {
          // 日志不可用时仍须发布终态，不能让客户端永久等待。
        }
        job.result = {
          ...fail("后台任务结果无法确认，请查看运维日志和审计记录，勿重复提交"),
          outcomeUnknown: true,
        }
        job.httpStatus = 500
      } finally {
        job.status = "completed"
        job.completedAt = Date.now()
        store.active.delete(key)
      }
    })
  } catch (err) {
    store.jobs.delete(job.id)
    store.active.delete(key)
    throw err
  }
  return job
}

export function getAdminJob(repo: Repo, id: string): AdminJob | null {
  const job = storeFor(repo).jobs.get(id)
  return job ? { ...job } : null
}

/** 旧客户端保留同步契约；浏览器选择异步后 HTTP 不再等待模型和维护锁。 */
export function withAdminJob(
  req: Request,
  repo: Repo,
  key: string,
  run: () => Promise<NextResponse>
): Promise<NextResponse> {
  const asyncPreferred = req.headers
    .get("prefer")
    ?.split(",")
    .some((preference) => preference.trim().toLowerCase() === "respond-async")
  if (!asyncPreferred) return run()
  const job = startAdminJob(repo, key, run, after)
  if (!job)
    return Promise.resolve(
      NextResponse.json(fail("后台任务较多，请稍后查询现有任务状态"), {
        status: 429,
      })
    )
  return Promise.resolve(
    NextResponse.json(ok({ jobId: job.id, status: "running" }), {
      status: 202,
      headers: {
        "Preference-Applied": "respond-async",
        Location: `/api/reflection/jobs/${job.id}`,
      },
    })
  )
}
