/**
 * agent 侧共用的硬超时原语。
 *
 * 背景:主链路(classify/agent.run/kb-prefetch)早有超时防护,但后台循环
 * (反思/主题/整理/升格)与判官的 drainQuery/embed 一度是裸 await —— relay
 * 挂起时 promise 永不 settle,`running` 防重入标志在 finally 里永不复位,
 * 该循环从此每次 tick 直接 return,静默停摆到进程重启。所有后台外部调用
 * 都应套本函数(或 keepalive 的 withDeadline)。
 */

/**
 * 默认 LLM(drainQuery)超时:对齐 agent.run 的 DEFAULT_RUN_TIMEOUT_MS。
 * 两者语义不同(墙钟超时 vs 单次 LLM 查询超时),数值相同但各自硬编码;
 * 改动本值需同步检查 lib/agent/agent.ts 的 DEFAULT_RUN_TIMEOUT_MS。
 */
export const DEFAULT_QUERY_TIMEOUT_MS = 180_000
/** 默认本地 embed 超时:冷启动加载模型实测可达 20s+,60s 只挡真挂死 */
export const DEFAULT_EMBED_TIMEOUT_MS = 60_000

/**
 * 给 Promise 套硬超时:超时拒绝并放弃等待(原任务可能仍在后台跑,结果被丢弃)。
 * Promise.race 对两个 promise 都挂了 handler,晚到的拒绝不会变成 unhandledRejection。
 * ms <= 0 视为关闭超时。
 */
export function withTimeout<T>(ms: number, task: Promise<T>): Promise<T> {
  if (ms <= 0) return task
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`超时(${ms}ms)`)), ms)
  })
  return Promise.race([task, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** 给「文本→向量」类异步函数整体套硬超时;ms<=0 原样返回。poller 的 resolve() 里统一包 embed 用 */
export function withTimeoutFn<T>(
  ms: number,
  fn: (text: string) => Promise<T>
): (text: string) => Promise<T> {
  if (ms <= 0) return fn
  return (text) => withTimeout(ms, fn(text))
}
