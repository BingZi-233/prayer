import {
  fetchApi,
  parseApiResponse,
  type ApiResponse,
} from "@/lib/core/http-client"

type AcceptedJob = { jobId: string; status: "running" }
type JobState<T> = {
  id: string
  status: "running" | "completed"
  result?: ApiResponse<T>
}

const uncertain = (reason: string): ApiResponse<never> => ({
  ok: false,
  error: `${reason}；任务结果尚未确认，请刷新状态后再决定是否重试。`,
  outcomeUnknown: true,
})

function waitForPoll(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", stop)
      resolve(ready)
    }
    const stop = () => finish(false)
    const timer = setTimeout(() => finish(true), 3000)
    signal?.addEventListener("abort", stop, { once: true })
  })
}

/** 只提交一次写请求,之后轮询已有任务;断线不重新发起整理或升格。 */
export async function runReflectionAction<T>(
  url: string,
  init: RequestInit,
  onRunning?: () => void,
  lifecycleSignal?: AbortSignal
): Promise<ApiResponse<T>> {
  const signal = lifecycleSignal ?? init.signal ?? undefined
  if (signal?.aborted) return uncertain("已停止等待任务结果")
  const headers = new Headers(init.headers)
  headers.set("Prefer", "respond-async")
  const started = await fetchApi<T | AcceptedJob>(url, {
    ...init,
    headers,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  })
  if (signal?.aborted) return uncertain("已停止等待任务结果")
  if (!started.ok) return started
  const accepted = started.data as Partial<AcceptedJob> | null
  if (accepted?.status === "running" && typeof accepted.jobId !== "string")
    return uncertain("无法读取任务编号")
  if (
    !accepted ||
    typeof accepted.jobId !== "string" ||
    accepted.status !== "running"
  )
    return started as ApiResponse<T>
  onRunning?.()
  const deadline = Date.now() + 3_600_000
  while (Date.now() < deadline) {
    if (!(await waitForPoll(signal))) return uncertain("已停止等待任务结果")
    const state: ApiResponse<JobState<T>> = await fetchApi<JobState<T>>(
      `/api/reflection/jobs/${encodeURIComponent(accepted.jobId)}`,
      {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      }
    )
    if (!state.ok) return uncertain(state.error)
    if (!state.data || state.data.id !== accepted.jobId)
      return uncertain("无法读取任务状态")
    if (state.data.status === "running") continue
    const result = parseApiResponse<T>(state.data.result)
    if (state.data.status !== "completed" || !result)
      return uncertain("无法读取任务结果")
    return result
  }
  return uncertain("等待任务完成超时")
}
