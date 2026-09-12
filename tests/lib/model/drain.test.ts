import { describe, expect, it } from "vitest"
import { drainQuery } from "@/lib/model/drain"

describe("drainQuery final assistant text", () => {
  it("drops draft text before tool_use and returns only the final assistant text", async () => {
    async function* stream() {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "draft" }] },
      }
      yield {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "kb_search" }],
        },
      }
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "final" }] },
      }
    }

    await expect(drainQuery(stream(), "agent")).resolves.toMatchObject({
      text: "final",
    })
  })
})
