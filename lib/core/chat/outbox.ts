import type { ActionSend } from "./events"

export interface OutboxRecord {
  id: number
  deliveryKey: string
  action: ActionSend
  status: "pending" | "sending" | "sent" | "failed"
  attempts: number
  nextAttemptAt: number
  leaseUntil: number | null
  /** A claimed row always carries a lease token; completion must present it. */
  claimToken: string
  lastError?: string | null
}

export interface OutboundStore {
  enqueueAndClaim(action: ActionSend, now: number): OutboxRecord | null
  claimDue(limit: number, now: number): OutboxRecord[]
  markSent(id: number, now: number, claimToken: string): boolean
  markFailed(id: number, error: string, nextAttemptAt: number, claimToken: string): boolean
  sentChunkCount(resolutionKey: string): number
}
