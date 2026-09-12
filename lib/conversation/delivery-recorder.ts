import type { Repo } from "../core/db/repo"
import type { ActionSend } from "../core/chat/events"

export function recordDelivery(repo: Repo, event: { deliveryKey: string; resolutionKey?: string; status: "sent" | "failed"; error?: string; at: number }): void {
  if (!event.resolutionKey) return
  const n = repo.outbox.sentChunkCount(event.resolutionKey)
  repo.transaction(() => {
    repo.statistics.markDelivery(event.resolutionKey!, event.status, event.error, event.at, n)
  })
}

export function deliveryMetadata(a: ActionSend): ActionSend { return a }
