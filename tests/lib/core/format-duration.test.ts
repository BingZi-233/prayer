import { describe, expect, it } from "vitest"
import { formatDuration } from "@/lib/core/format-duration"

describe("formatDuration", () => {
  it("不足 1 分钟出秒", () => {
    expect(formatDuration(0)).toBe("0 秒")
    expect(formatDuration(30_000)).toBe("30 秒")
    expect(formatDuration(59_000)).toBe("59 秒")
  })

  it("满 1 分钟不足 1 小时出分", () => {
    expect(formatDuration(60_000)).toBe("1 分")
    expect(formatDuration(180_000)).toBe("3 分")
    expect(formatDuration(3_540_000)).toBe("59 分")
  })

  it("满 1 小时出时,整点不带小数", () => {
    expect(formatDuration(3_600_000)).toBe("1 时")
    expect(formatDuration(5_400_000)).toBe("1.5 时")
    expect(formatDuration(7_200_000)).toBe("2 时")
  })
})
