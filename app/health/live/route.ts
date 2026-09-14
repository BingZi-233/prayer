const NO_STORE = { "Cache-Control": "no-store" }

/** 进程存活探针：不读取数据库、配置或 Runtime，供进程管理器直接探测。 */
export function GET(): Response {
  return Response.json(
    { ok: true, data: { live: true } },
    { headers: NO_STORE }
  )
}
