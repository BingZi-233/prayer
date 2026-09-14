import { getRuntime } from "@/lib/runtime"

const NO_STORE = { "Cache-Control": "no-store" }

/**
 * 流量接入探针：必要通道均已连接且运行管线未降级时才返回 200。
 * 路径刻意置于 /api 之外，避免被管理面鉴权代理拦截。
 */
export function GET(): Response {
  try {
    const readiness = getRuntime().getReadiness()
    // This endpoint is intentionally public: expose topology and booleans for
    // a load balancer, but never leak channel/API errors (which may contain
    // tokens, URLs, or provider response bodies). Detailed diagnostics remain
    // behind the authenticated admin status API.
    const data = {
      ready: readiness.ready,
      state: readiness.state,
      requiredChannels: readiness.requiredChannels,
      unavailableChannels: readiness.unavailableChannels.map((channel) => ({
        id: channel.id,
        connected: channel.connected,
        hasError: Boolean(channel.lastError),
      })),
      channels: readiness.channels.map((channel) => ({
        id: channel.id,
        connected: channel.connected,
        hasError: Boolean(channel.lastError),
      })),
      hasError: Boolean(readiness.lastError),
    }
    const body = readiness.ready
      ? { ok: true, data }
      : { ok: false, error: "runtime not ready", data }
    return Response.json(body, {
      status: readiness.ready ? 200 : 503,
      headers: NO_STORE,
    })
  } catch {
    return Response.json(
      {
        ok: false,
        error: "runtime unavailable",
        data: {
          ready: false,
          state: "error",
          requiredChannels: [],
          unavailableChannels: [],
          channels: [],
          hasError: true,
        },
      },
      { status: 503, headers: NO_STORE }
    )
  }
}
