import { describe, expect, it } from "vitest"
import { openDb } from "@/lib/core/db/index"
import { Repo } from "@/lib/core/db/repo"
import { recordDelivery, registerDeliveryRecorder } from "@/lib/conversation/delivery-recorder"
import { registerResolutionRecorder } from "@/lib/conversation/resolution-recorder"
import { registerReplyMapper } from "@/lib/conversation/reply-mapper"
import { ChannelRegistry } from "@/lib/channels/registry"
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

  it("duplicate delivery.recorded is idempotent", () => {
    const repo = new Repo(openDb(":memory:", 3))
    repo.insertResolution("auto", { deliveryKey: "dup", resolutionKey: "dup" })
    const row = repo.outbox.enqueueAndClaim({
      channel: "qq",
      chatId: "1",
      text: "answer",
      deliveryKey: "dup/0",
      resolutionKey: "dup",
    }, 0)!
    repo.outbox.markSent(row.id, 1, row.claimToken)
    const off = registerDeliveryRecorder(repo)
    const event = { deliveryKey: "dup/0", resolutionKey: "dup", status: "sent" as const, at: 2 }
    bus.emit("delivery.planned", { deliveryKey: "dup", resolutionKey: "dup", chunkCount: 1 })
    bus.emit("delivery.recorded", event)
    bus.emit("delivery.recorded", event)
    off()

    expect(repo.resolutionCounts(0).auto).toBe(1)
  })

  it("recordDelivery waits for every planned chunk before marking sent", () => {
    const repo = new Repo(openDb(":memory:", 3))
    repo.insertResolution("auto", {
      deliveryKey: "recorded-two",
      resolutionKey: "recorded-two",
      deliveryStatus: "pending",
      deliveryExpected: 2,
    })
    const first = repo.outbox.enqueueAndClaim({
      channel: "qq",
      chatId: "1",
      text: "first",
      deliveryKey: "recorded-two/0",
      resolutionKey: "recorded-two",
    }, 0)!
    const second = repo.outbox.enqueueAndClaim({
      channel: "qq",
      chatId: "1",
      text: "second",
      deliveryKey: "recorded-two/1",
      resolutionKey: "recorded-two",
    }, 0)!
    repo.outbox.markSent(first.id, 1, first.claimToken)

    recordDelivery(repo, {
      deliveryKey: "recorded-two/0",
      resolutionKey: "recorded-two",
      status: "sent",
      at: 2,
    })
    expect(repo.resolutionCounts(0).auto ?? 0).toBe(0)

    repo.outbox.markSent(second.id, 3, second.claimToken)
    recordDelivery(repo, {
      deliveryKey: "recorded-two/1",
      resolutionKey: "recorded-two",
      status: "sent",
      at: 4,
    })
    expect(repo.resolutionCounts(0).auto).toBe(1)
  })

  it("resolutionKey is persisted as delivery key when deliveryKey is omitted", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const off = registerResolutionRecorder(repo)
    bus.emit("resolution.recorded", {
      kind: "auto",
      resolutionKey: "resolution-only",
    })
    off()

    const db = (repo as unknown as {
      db: { prepare: (sql: string) => { get: () => unknown } }
    }).db
    expect(
      db.prepare("SELECT delivery_key, delivery_status FROM resolution_events").get()
    ).toEqual({ delivery_key: "resolution-only", delivery_status: "pending" })
  })

  it("proactive reply moves pending to sent through mapper, registry, and outbox", async () => {
    const repo = new Repo(openDb(":memory:", 3))
    const deliveryKey = "proactive:qq:100:200:1:row:7"
    repo.insertProactiveReply("qq", "100", "200", "question", "answer", {
      deliveryKey,
      deliveryStatus: "pending",
    })
    const offResolution = registerResolutionRecorder(repo)
    const offDelivery = registerDeliveryRecorder(repo)
    const offMapper = registerReplyMapper()
    const registry = new ChannelRegistry({ outbox: repo.outbox, now: () => 100 })
    registry.register({
      id: "qq",
      capabilities: {
        canNotifyOwnAdminSurface: false,
        supportsAdminCommands: false,
        supportsMemberList: false,
        supportsGroupList: false,
        supportsMediaDownload: false,
        supportsBypassPipeline: false,
      },
      start: async () => {},
      stop: async () => {},
      isConnected: () => true,
      status: () => ({ id: "qq", connected: true }),
      send: async () => {},
    })
    await registry.startAll()

    const sent = new Promise<void>((resolve) =>
      bus.once("delivery.recorded", (event) => {
        if (event.status === "sent") resolve()
      })
    )
    bus.emit("reply.ready", {
      channel: "qq",
      chatId: "100",
      text: "answer",
      deliveryKey,
      resolutionKey: deliveryKey,
    })
    bus.emit("resolution.recorded", {
      kind: "proactive",
      channel: "qq",
      chatId: "100",
      userId: "200",
      deliveryKey,
      resolutionKey: deliveryKey,
    })
    await sent

    expect(repo.proactiveTotalCount()).toBe(1)
    offMapper()
    offDelivery()
    offResolution()
    await registry.stopAll()
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
