import { describe, expect, it } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { registerDeliveryRecorder } from "@/lib/conversation/delivery-recorder"
import { registerResolutionRecorder } from "@/lib/conversation/resolution-recorder"
import { bus } from "@/lib/core/bus"

describe("delivery recorder", () => {
  it("waits for all chunks", () => {
    const repo = new Repo(openDb(":memory:", 3)); repo.insertResolution("auto", { deliveryKey: "r", resolutionKey: "r", deliveryStatus: "pending" })
    const off = registerDeliveryRecorder(repo)
    bus.emit("delivery.planned", { deliveryKey: "r", resolutionKey: "r", chunkCount: 2 })
    bus.emit("delivery.recorded", { deliveryKey: "r/0", resolutionKey: "r", status: "sent", at: 1 })
    off()
    expect(repo.resolutionCounts(0).auto ?? 0).toBe(0)
  })
  it("marks after two sent chunks", () => {
    const repo = new Repo(openDb(":memory:", 3)); repo.insertResolution("auto", { deliveryKey: "r2", resolutionKey: "r2" })
    const a = repo.outbox.enqueueAndClaim({ channel: "qq", chatId: "1", text: "a", deliveryKey: "r2/0", resolutionKey: "r2" }, 0)!
    const b = repo.outbox.enqueueAndClaim({ channel: "qq", chatId: "1", text: "b", deliveryKey: "r2/1", resolutionKey: "r2" }, 0)!
    repo.outbox.markSent(a.id, 1, a.claimToken); repo.outbox.markSent(b.id, 1, b.claimToken)
    const off = registerDeliveryRecorder(repo); bus.emit("delivery.planned", { deliveryKey: "r2", resolutionKey: "r2", chunkCount: 2 }); bus.emit("delivery.recorded", { deliveryKey: "r2/1", resolutionKey: "r2", status: "sent", at: 2 }); off()
    expect(repo.resolutionCounts(0).auto).toBe(1)
  })
  it("reconciles a delivery plan emitted before the resolution row", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const offResolution = registerResolutionRecorder(repo)
    const offDelivery = registerDeliveryRecorder(repo)

    bus.emit("delivery.planned", {
      deliveryKey: "ordered",
      resolutionKey: "ordered",
      chunkCount: 2,
    })
    bus.emit("resolution.recorded", {
      kind: "auto",
      deliveryKey: "ordered",
      resolutionKey: "ordered",
      deliveryExpected: 2,
    })

    expect(repo.deliveryExpected("ordered")).toBe(2)

    const a = repo.outbox.enqueueAndClaim({
      channel: "qq",
      chatId: "1",
      text: "a",
      deliveryKey: "ordered/0",
      resolutionKey: "ordered",
    }, 0)!
    const b = repo.outbox.enqueueAndClaim({
      channel: "qq",
      chatId: "1",
      text: "b",
      deliveryKey: "ordered/1",
      resolutionKey: "ordered",
    }, 0)!
    repo.outbox.markSent(a.id, 1, a.claimToken)

    bus.emit("delivery.recorded", {
      deliveryKey: "ordered/0",
      resolutionKey: "ordered",
      status: "sent",
      at: 2,
    })
    expect(repo.resolutionCounts(0).auto ?? 0).toBe(0)
    repo.outbox.markSent(b.id, 1, b.claimToken)
    bus.emit("delivery.recorded", {
      deliveryKey: "ordered/1",
      resolutionKey: "ordered",
      status: "sent",
      at: 3,
    })
    expect(repo.resolutionCounts(0).auto).toBe(1)

    offDelivery()
    offResolution()
  })
})
