import { redactDiagnostic } from "./log-context"

export type ApiResponse<T> =
  { ok: true; data: T } | { ok: false; error: string; outcomeUnknown?: true }

const timedOut = (error: unknown) =>
  error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)

function responseFailure(
  status: number,
  mutation: boolean,
  timeout = false
): ApiResponse<never> {
  const code = status ? `（HTTP ${status}）` : ""
  const reason =
    status === 401
      ? "登录已失效，请重新登录"
      : status === 403
        ? "当前操作被拒绝，请检查登录权限"
        : timeout || [408, 504, 524].includes(status)
          ? "等待服务响应超时"
          : [502, 503].includes(status)
            ? "服务暂时不可用"
            : "未收到有效的服务响应"
  const uncertain =
    mutation &&
    (status === 0 ||
      status === 408 ||
      status >= 500 ||
      (status >= 200 && status < 400))
  return {
    ok: false,
    error: `${reason}${code}${uncertain ? "；操作结果尚未确认，请刷新状态后再决定是否重试。" : "。"}`,
    ...(uncertain ? { outcomeUnknown: true as const } : {}),
  }
}

/** 同时用于 HTTP 响应和后台任务中保存的原始结果。 */
export function parseApiResponse<T>(body: unknown): ApiResponse<T> | null {
  if (!body || typeof body !== "object") return null
  const result = body as {
    ok?: unknown
    data?: T
    error?: unknown
    outcomeUnknown?: unknown
  }
  if (
    result.ok === false &&
    typeof result.error === "string" &&
    result.error.trim() &&
    !/<(?:!|\/?[a-z][\w:-]*(?:[\s/>]|$))/i.test(result.error) &&
    !/doctype|unexpected token|unexpected end of json|json\.parse:/i.test(
      result.error
    )
  )
    return {
      ok: false,
      error: redactDiagnostic(result.error.trim()),
      ...(result.outcomeUnknown === true
        ? { outcomeUnknown: true as const }
        : {}),
    }
  if (result.ok === true && "data" in result)
    return { ok: true, data: result.data as T }
  return null
}

/** 不将网关网页、JSON 解析异常或响应地址中的凭据带入界面。 */
export async function readApiResponse<T>(
  response: Response,
  options: { mutation?: boolean } = {}
): Promise<ApiResponse<T>> {
  const mutation = options.mutation ?? false
  if (
    response.status === 401 ||
    (response.redirected && /\/login\/?$/.test(new URL(response.url).pathname))
  )
    return responseFailure(401, mutation)
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html"))
    return responseFailure(response.status, mutation)
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    return responseFailure(response.status, mutation, timedOut(error))
  }
  const result = parseApiResponse<T>(body)
  if (result && (!result.ok || response.ok)) return result
  return responseFailure(response.status, mutation)
}

/** 单次请求;写操作连接中断时结果未知,不得自动重发。 */
export async function fetchApi<T>(
  url: string,
  init?: RequestInit
): Promise<ApiResponse<T>> {
  const mutation = !["GET", "HEAD"].includes(
    (init?.method ?? "GET").toUpperCase()
  )
  try {
    return await readApiResponse<T>(
      await fetch(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(30_000),
      }),
      { mutation }
    )
  } catch (error) {
    return responseFailure(0, mutation, timedOut(error))
  }
}
