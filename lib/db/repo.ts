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
}
