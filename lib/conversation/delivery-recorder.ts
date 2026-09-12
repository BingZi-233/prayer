import type { Repo } from "../core/db/repo"
import type { ActionSend } from "../core/chat/events"
import { bus } from "../core/bus"

export function registerDeliveryRecorder(repo: Repo): () => void {
  const expected = new Map<string, number>()
  const plan = (e: { resolutionKey?: string; chunkCount: number }) => {
    if (!e.resolutionKey) return
    expected.set(e.resolutionKey, e.chunkCount)
    // The plan can arrive before resolution.recorded creates its row.
    repo.planDelivery(e.resolutionKey, e.chunkCount)
  }
  const onResolution = (e: { resolutionKey?: string; deliveryExpected?: number }) => {
    if (!e.resolutionKey) return
    const chunkCount = e.deliveryExpected ?? expected.get(e.resolutionKey)
    if (chunkCount != null) repo.planDelivery(e.resolutionKey, chunkCount)
  }
  const on = (e: { deliveryKey: string; resolutionKey?: string; status: "sent" | "failed"; error?: string; at: number }) => {
    if (!e.resolutionKey) return
    const count = repo.outbox.sentChunkCount(e.resolutionKey)
    const want = expected.get(e.resolutionKey) ?? repo.deliveryExpected(e.resolutionKey) ?? 1
    if (e.status === "sent") repo.markDelivery(e.resolutionKey, count >= want ? "sent" : "pending", undefined, e.at, count)
    else repo.markDelivery(e.resolutionKey, "failed", e.error, e.at, count)
  }
  bus.on("delivery.planned", plan)
  bus.on("resolution.recorded", onResolution)
  bus.on("delivery.recorded", on)
  return () => {
    bus.off("delivery.planned", plan)
    bus.off("resolution.recorded", onResolution)
    bus.off("delivery.recorded", on)
  }
}

export function recordDelivery(repo: Repo, event: { deliveryKey: string; resolutionKey?: string; status: "sent" | "failed"; error?: string; at: number }): void {
  if (!event.resolutionKey) return
  const n = repo.outbox.sentChunkCount(event.resolutionKey)
  repo.transaction(() => {
    repo.statistics.markDelivery(event.resolutionKey!, event.status, event.error, event.at, n)
  })
}

export function deliveryMetadata(a: ActionSend): ActionSend { return a }
