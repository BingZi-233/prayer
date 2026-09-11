export interface KbStats {
  chunks: number
  vecs: number
  dim: number
  docs: { doc: string; chunks: number }[]
}

export interface KbChunk {
  id: number
  content: string
}

export interface IngestResult {
  file: string
  chunks: number
}

export type PendingNav = { type: "open"; path: string } | { type: "clear" }
