import type Database from "better-sqlite3";

export interface KbHit {
  id: number;
  content: string;
  source: string | null;
  distance: number;
}

export class Repo {
  constructor(private db: Database.Database) {}

  setSessionId(key: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (key, session_id) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET session_id = excluded.session_id, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, sessionId);
  }

  // 清空 resumeId → 下条消息开全新 SDK session(保留 human_mode 等其它列)
  clearSessionId(key: string): void {
    this.db
      .prepare("UPDATE sessions SET session_id = NULL, updated_at = unixepoch('subsec')*1000 WHERE key = ?")
      .run(key);
  }

  getSessionId(key: string): string | undefined {
    const row = this.db.prepare("SELECT session_id FROM sessions WHERE key = ?").get(key) as
      | { session_id: string | null }
      | undefined;
    return row?.session_id ?? undefined;
  }

  isHumanMode(key: string): boolean {
    const row = this.db.prepare("SELECT human_mode FROM sessions WHERE key = ?").get(key) as
      | { human_mode: number }
      | undefined;
    return !!row?.human_mode;
  }

  setHumanMode(key: string, on: boolean): void {
    this.db
      .prepare(
        `INSERT INTO sessions (key, human_mode, human_since) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET human_mode = excluded.human_mode, human_since = excluded.human_since`
      )
      .run(key, on ? 1 : 0, on ? Date.now() : null);
  }

  staleHumanSessions(timeoutMin: number): string[] {
    const cutoff = Date.now() - timeoutMin * 60 * 1000;
    const rows = this.db
      .prepare("SELECT key FROM sessions WHERE human_mode = 1 AND human_since IS NOT NULL AND human_since < ?")
      .all(cutoff) as { key: string }[];
    return rows.map((r) => r.key);
  }

  seenMessage(messageId: number): boolean {
    const info = this.db
      .prepare("INSERT OR IGNORE INTO seen_messages (message_id) VALUES (?)")
      .run(messageId);
    return info.changes === 0;
  }

  createTicket(sessionKey: string, summary: string): number {
    const info = this.db
      .prepare("INSERT INTO tickets (session_key, summary) VALUES (?, ?)")
      .run(sessionKey, summary);
    return Number(info.lastInsertRowid);
  }

  insertKbChunk(doc: string, content: string, source: string): number {
    const info = this.db
      .prepare("INSERT INTO kb_chunks (doc, content, source) VALUES (?, ?, ?)")
      .run(doc, content, source);
    return Number(info.lastInsertRowid);
  }

  insertKbVec(chunkId: number, embedding: Float32Array): void {
    this.db
      .prepare("INSERT INTO kb_vec (chunk_id, embedding) VALUES (?, ?)")
      .run(BigInt(chunkId), Buffer.from(embedding.buffer));
  }

  searchKb(query: Float32Array, k: number): KbHit[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.content, c.source, v.distance
         FROM kb_vec v JOIN kb_chunks c ON c.id = v.chunk_id
         WHERE v.embedding MATCH ? AND k = ?
         ORDER BY v.distance`
      )
      .all(Buffer.from(query.buffer), k) as KbHit[];
    return rows;
  }

  getConfigRow(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setConfigRow(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, value);
  }

  countSessions(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    return row.n;
  }

  listSessions(): { key: string; sessionId: string | null; humanMode: boolean; updatedAt: number }[] {
    const rows = this.db
      .prepare("SELECT key, session_id, human_mode, updated_at FROM sessions ORDER BY updated_at DESC")
      .all() as { key: string; session_id: string | null; human_mode: number; updated_at: number }[];
    return rows.map((r) => ({
      key: r.key,
      sessionId: r.session_id,
      humanMode: !!r.human_mode,
      updatedAt: r.updated_at,
    }));
  }

  openTickets(): { id: number; sessionKey: string; summary: string; createdAt: number }[] {
    const rows = this.db
      .prepare("SELECT id, session_key, summary, created_at FROM tickets WHERE status = 'open' ORDER BY created_at DESC")
      .all() as { id: number; session_key: string; summary: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, sessionKey: r.session_key, summary: r.summary, createdAt: r.created_at }));
  }
}
