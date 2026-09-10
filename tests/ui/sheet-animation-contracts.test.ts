import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("Base UI sheet exit animation contract", () => {
  // 移动端侧栏遮罩的退场动画必须保持终帧。
  // 遮罩是 duration-100、面板是 duration-200;tw-animate-css 的 animate-out
  // 默认 animation-fill-mode: none,动画一结束就回到基础样式(bg-black/80 即全黑),
  // 于是面板还没退完的两百毫秒里整屏会闪成纯黑。
  it("holds the backdrop's final frame through the popup exit animation", async () => {
    const source = await readFile("components/ui/sheet.tsx", "utf8")
    const overlayClass = source.match(/"[^"]*bg-black\/80[^"]*"/)?.[0]

    expect(overlayClass).toBeDefined()
    expect(overlayClass).toMatch(/data-ending-style:fill-mode-forwards/)
  })
})
