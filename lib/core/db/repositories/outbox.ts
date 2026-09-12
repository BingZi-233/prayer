import type { ActionSend } from "../../chat/events.ts"
import type { OutboundStore, OutboxRecord } from "../../chat/outbox.ts"
import type { SqliteContext } from "../context.ts"

export class OutboxRepository implements OutboundStore {
  constructor(private readonly sql: SqliteContext) {}
  private row(r: any): OutboxRecord { return { id:r.id, deliveryKey:r.delivery_key, action:JSON.parse(r.action_json), status:r.status, attempts:r.attempts, nextAttemptAt:r.next_attempt_at, leaseUntil:r.lease_until, lastError:r.last_error } }
  enqueueAndClaim(action: ActionSend, now: number): OutboxRecord | null {
    const key = action.deliveryKey
    if (!key) return null
    return this.sql.transaction(() => {
      this.sql.prepare(`INSERT OR IGNORE INTO outbox_messages(delivery_key,resolution_key,action_json,status,attempts,next_attempt_at) VALUES(?,?,?,?,0,?)`).run(key, action.resolutionKey ?? null, JSON.stringify(action), "pending", now)
      const info = this.sql.prepare(`UPDATE outbox_messages SET status='sending', attempts=attempts+1, lease_until=? WHERE delivery_key=? AND (status='pending' OR (status='failed' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`).run(now + 30000, key, now, now)
      if (!info.changes) return null
      return this.row(this.sql.prepare(`SELECT * FROM outbox_messages WHERE delivery_key=?`).get(key))
    })
  }
  claimDue(limit: number, now: number): OutboxRecord[] {
    return this.sql.transaction(() => {
      const rows = this.sql.prepare(`SELECT id FROM outbox_messages WHERE (status='pending' OR (status='failed' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?)) ORDER BY id LIMIT ?`).all(now, now, limit) as {id:number}[]
      const out: OutboxRecord[] = []
      for (const r of rows) {
        const u = this.sql.prepare(`UPDATE outbox_messages SET status='sending', attempts=attempts+1, lease_until=? WHERE id=? AND (status='pending' OR (status='failed' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`).run(now+30000,r.id,now,now)
        if (u.changes) out.push(this.row(this.sql.prepare(`SELECT * FROM outbox_messages WHERE id=?`).get(r.id)))
      }
      return out
    })
  }
  markSent(id:number, now:number):boolean { return this.sql.prepare(`UPDATE outbox_messages SET status='sent', sent_at=?, lease_until=NULL WHERE id=? AND status='sending'`).run(now,id).changes>0 }
  markFailed(id:number,error:string,nextAttemptAt:number):boolean { return this.sql.prepare(`UPDATE outbox_messages SET status='failed', last_error=?, next_attempt_at=?, lease_until=NULL WHERE id=? AND status='sending'`).run(error,nextAttemptAt,id).changes>0 }
  sentChunkCount(resolutionKey:string):number { return (this.sql.prepare(`SELECT COUNT(*) n FROM outbox_messages WHERE resolution_key=? AND status='sent'`).get(resolutionKey) as any).n }
}
