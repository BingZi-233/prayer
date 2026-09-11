/**
 * 毫秒时长的人读格式。全仓唯一出处。
 * 粒度取合并前三处里最细的一档:不足 1 分钟出「N 秒」(原 proactive 的行为),
 * 满 1 小时出「N 时」(原 reflection 的行为)。
 */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`
  if (ms >= 3_600_000) {
    return `${(ms / 3_600_000).toFixed(ms % 3_600_000 ? 1 : 0)} 时`
  }
  return `${Math.round(ms / 60_000)} 分`
}
