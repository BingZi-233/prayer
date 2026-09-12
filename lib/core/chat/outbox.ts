import type { ActionSend } from "./events"

export interface OutboxRecord {
  id: number
  deliveryKey: string
  action: ActionSend
  status: "pending" | "sending" | "sent" | "failed"
  attempts: number
  nextAttemptAt: number
  leaseUntil: number | null
  claimToken: string | null
  lastError?: string | null
}

export interface OutboundStore {
  enqueueAndClaim(action: ActionSend, now: number): OutboxRecord | null
  claimDue(limit: number, now: number): OutboxRecord[]
  markSent(id: number, now: number, claimToken?: string | null): boolean
  markFailed(id: number, error: string, nextAttemptAt: number, claimToken?: string | null): boolean
  sentChunkCount(resolutionKey: string): number
}
