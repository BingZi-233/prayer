import { describe, expect, it } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { registerDeliveryRecorder } from "@/lib/conversation/delivery-recorder"
import { bus } from "@/lib/core/bus"

describe("delivery recorder", () => {
  it("waits for all chunks", () => {
    const repo = new Repo(openDb(":memory:", 3)); repo.insertResolution("auto", { deliveryKey: "r", resolutionKey: "r" })
    const off = registerDeliveryRecorder(repo)
    bus.emit("delivery.planned", { deliveryKey: "r", resolutionKey: "r", chunkCount: 2 })
    bus.emit("delivery.recorded", { deliveryKey: "r/0", resolutionKey: "r", status: "sent", at: 1 })
    off()
    expect(repo.resolutionCounts(0).auto ?? 0).toBe(0)
  })
})
