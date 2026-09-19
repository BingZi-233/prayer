import { describe, it, expect } from "vitest"
import {
  buildDefaultSystem,
  SYSTEM_PROMPT_MAX_CHARS,
} from "@/lib/model/system-prompt"
import {
  KB_CANDIDATES_BEGIN,
  KB_CANDIDATES_END,
  USER_MESSAGE_BEGIN,
  USER_MESSAGE_END,
} from "@/lib/model/prompt"

// 弱模型（MiniMax-M3 档位）下，规则必须是可机械执行的形式:触发词、固定句式、明确动作。
// 断言按语义写，不绑死逐字碎串，便于后续微调正文而不碎测试。
describe("buildDefaultSystem 弱模型契约", () => {
  const s = buildDefaultSystem({
    brand: { name: "Acme", description: "测试品牌" },
    supportUrl: "https://support.example",
  })

  it("品牌与支持入口插值", () => {
    expect(s).toContain("你是 Acme 的官方在线客服")
    expect(s).toContain("Acme 是测试品牌")
    expect(s).toContain("https://support.example")
  })

  it("无 supportUrl 时给出无法办理的替代话术", () => {
    const noUrl = buildDefaultSystem({ brand: { name: "Acme" } })
    expect(noUrl).toContain("无法由自动客服办理")
    expect(noUrl).not.toContain("https://support.example")
  })

  it("输入边界使用四个 marker 常量", () => {
    for (const marker of [
      KB_CANDIDATES_BEGIN,
      KB_CANDIDATES_END,
      USER_MESSAGE_BEGIN,
      USER_MESSAGE_END,
    ]) {
      expect(s).toContain(marker)
    }
  })

  it("无依据兜底句可直接照抄", () => {
    expect(s).toContain("这个我没有查到确切依据,不猜。")
    expect(s).toContain("不要用「可能」「一般」「通常」")
  })

  it("触发词决断表覆盖实时数据与文档两类", () => {
    expect(s).toContain("必须调用 packy 工具取当前值")
    expect(s).toContain("调 kb_search 换具体说法再查一次")
    expect(s).toContain("不调工具")
  })

  it("账户、转人工、歧义追问与多问题规则在位", () => {
    expect(s).toContain("不能查、不能办账户")
    expect(s).toContain("不说已经转接")
    expect(s).toContain("不提工单")
    expect(s).toContain("只问一个")
    expect(s).toContain("多问分条答全")
  })

  it("关键铁律首尾各现一次（位置效应）", () => {
    expect(s.slice(0, 400)).toContain("三条铁律")
    expect(s.slice(-400)).toContain("# 再强调一次")
  })

  it("长度不超过上限，防止无节制膨胀", () => {
    expect(s.length).toBeLessThanOrEqual(SYSTEM_PROMPT_MAX_CHARS)
  })

  it("不与 Caveman 争夺回复风格，也不硬编码会过期的端点", () => {
    for (const banned of [
      "# 回复风格",
      "口语化",
      "严禁一切 Markdown",
      "400 字",
      "cf.api.fan",
      "slb-v1.api.fan",
    ]) {
      expect(s).not.toContain(banned)
    }
  })
})
