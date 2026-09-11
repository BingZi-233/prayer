/**
 * 送入模型前的入站文本清洗。
 *
 * MiniMax(Foundry 模式)对 input 做敏感词审核,命中则整请求 500:
 *   `API Error: 500 input new_sensitive (1026)`
 * 客服群聊常出现「翻墙 / fq / 科学上网」等词(讨论接入方式),
 * 以及用户粘贴的 sk- token —— 这些进 prompt 会整批卡死 topic 等后台任务。
 *
 * 策略:只改送给模型的副本,DB/日志保留原文;用中性占位保留语义。
 */

import { errorMessage } from "../core/log-context"

/** [匹配, 替换] —— 长词优先,避免子串互相干扰 */
const REPLACEMENTS: readonly [RegExp, string][] = [
  // 网络绕行(中文社区高频,实测触发 MiniMax new_sensitive)
  [/科学\s*上网/gi, "[网络]"],
  [/科學\s*上網/gi, "[网络]"],
  [/翻\s*墙/gi, "[网络]"],
  [/翻\s*牆/gi, "[网络]"],
  // fq = 翻墙缩写;仅独立 token,避免误伤 config 等
  [/(?<![a-zA-Z0-9])fq(?![a-zA-Z0-9])/gi, "[网络]"],
  // 密钥形态:用户常把 token 贴进群
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, "[TOKEN]"],
  [/\bsk-[A-Za-z0-9]{16,}/g, "[TOKEN]"],
]

/** 剔除/替换敏感片段,供一切进入 LLM 的用户侧文本使用 */
export function sanitizeForModel(text: string): string {
  if (!text) return text
  let out = text
  for (const [re, rep] of REPLACEMENTS) {
    out = out.replace(re, rep)
  }
  return out
}

/** 是否为 MiniMax/Foundry 的 input new_sensitive(1026) */
export function isNewSensitiveError(err: unknown): boolean {
  return /new_sensitive/i.test(errorMessage(err))
}
