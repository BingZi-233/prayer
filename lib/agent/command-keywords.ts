export const RESET_KEYWORDS =
  /^\s*(重新开始|重置对话|重置会话|重置|\/new|\/reset|\/clear)\s*$/i

export const HANDOFF_KEYWORDS = /^\s*(人工|转人工|人工客服|转接人工|客服)\s*$/i

export const HELP_KEYWORDS = /^\s*(帮助|怎么用|使用说明|\/help|help)\s*$/i

export function isCommandMessage(text: string): boolean {
  return (
    RESET_KEYWORDS.test(text) ||
    HANDOFF_KEYWORDS.test(text) ||
    HELP_KEYWORDS.test(text)
  )
}
