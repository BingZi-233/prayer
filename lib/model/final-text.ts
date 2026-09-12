export interface AssistantTextState {
  text: string
}

export function consumeAssistantContent(
  state: AssistantTextState,
  blocks: readonly { type?: string; text?: unknown }[]
): void {
  for (const block of blocks) {
    if (block.type === "tool_use") {
      state.text = ""
    } else if (block.type === "text" && typeof block.text === "string") {
      state.text += block.text
    }
  }
}

export function finalAssistantText(state: AssistantTextState): string {
  return state.text
}
