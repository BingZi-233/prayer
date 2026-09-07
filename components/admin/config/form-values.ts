export const msToMin = (ms: number) => String(Math.round(ms / 60_000))
export const minToMs = (min: string) => Math.round(Number(min) * 60_000) || 0
export const msToSec = (ms: number) => String(Math.round(ms / 1_000))
export const secToMs = (sec: string) => Math.round(Number(sec) * 1_000) || 0
export const msToHr = (ms: number) => String(Math.round(ms / 3_600_000))
export const hrToMs = (hr: string) => Math.round(Number(hr) * 3_600_000) || 0
