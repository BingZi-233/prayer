import type { ActionSend } from "../../chat/events.ts"
import type { OutboundStore, OutboxRecord } from "../../chat/outbox.ts"
import type { SqliteContext } from "../context.ts"

type OutboxDbRow = {
  id: number
  delivery_key: string
  action_json: string
  status: OutboxRecord["status"]
  attempts: number
  next_attempt_at: number
  lease_until: number | null
  claim_token: string | null
  last_error: string | null
}

export class OutboxRepository implements OutboundStore {
  constructor(private readonly sql: SqliteContext) {}
  private row(r: OutboxDbRow): OutboxRecord {
    if (!r.claim_token) throw new Error(`outbox row ${r.id} is not leased`)
    return {
      id: r.id,
      deliveryKey: r.delivery_key,
      action: JSON.parse(r.action_json) as ActionSend,
      status: r.status,
      attempts: r.attempts,
      nextAttemptAt: r.next_attempt_at,
      leaseUntil: r.lease_until,
      claimToken: r.claim_token,
      lastError: r.last_error,
    }
  }
  enqueueAndClaim(action: ActionSend, now: number): OutboxRecord | null {
    const key = action.deliveryKey
    if (!key) return null
    return this.sql.transaction(() => {
      this.sql.prepare(`INSERT OR IGNORE INTO outbox_messages(delivery_key,resolution_key,action_json,status,attempts,next_attempt_at) VALUES(?,?,?,?,0,?)`).run(key, action.resolutionKey ?? null, JSON.stringify(action), "pending", now)
      const token = `${now}:${Math.random()}`
      const info = this.sql.prepare(`UPDATE outbox_messages SET status='sending', attempts=attempts+1, lease_until=?, claim_token=? WHERE delivery_key=? AND (status='pending' OR (status='failed' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`).run(now + 30000, token, key, now, now)
      if (!info.changes) return null
      const row = this.sql
        .prepare<OutboxDbRow>(`SELECT * FROM outbox_messages WHERE delivery_key=?`)
        .get(key)
      if (!row) return null
      return this.row(row)
    })
  }
  claimDue(limit: number, now: number): OutboxRecord[] {
    return this.sql.transaction(() => {
      const rows = this.sql.prepare(`SELECT id FROM outbox_messages WHERE (status='pending' OR (status='failed' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?)) ORDER BY id LIMIT ?`).all(now, now, limit) as {id:number}[]
      const out: OutboxRecord[] = []
      for (const r of rows) {
        const token = `${now}:${Math.random()}`
        const u = this.sql.prepare(`UPDATE outbox_messages SET status='sending', attempts=attempts+1, lease_until=?, claim_token=? WHERE id=? AND (status='pending' OR (status='failed' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`).run(now+30000,token,r.id,now,now)
        if (u.changes) {
          const row = this.sql
            .prepare<OutboxDbRow>(`SELECT * FROM outbox_messages WHERE id=?`)
            .get(r.id)
          if (row) out.push(this.row(row))
        }
      }
      return out
    })
  }
  markSent(id:number, now:number, claimToken:string):boolean {
    return this.sql
      .prepare(`UPDATE outbox_messages SET status='sent', sent_at=?, lease_until=NULL, claim_token=NULL WHERE id=? AND status='sending' AND claim_token=?`)
      .run(now, id, claimToken).changes > 0
  }
  markFailed(id:number,error:string,nextAttemptAt:number,claimToken:string):boolean {
    return this.sql
      .prepare(`UPDATE outbox_messages SET status='failed', last_error=?, next_attempt_at=?, lease_until=NULL, claim_token=NULL WHERE id=? AND status='sending' AND claim_token=?`)
      .run(error, nextAttemptAt, id, claimToken).changes > 0
  }
  sentChunkCount(resolutionKey:string):number { return (this.sql.prepare<{n:number}>(`SELECT COUNT(*) n FROM outbox_messages WHERE resolution_key=? AND status='sent'`).get(resolutionKey)!).n }
}
