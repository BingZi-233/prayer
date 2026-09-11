export interface Sess {
  key: string
  sessionId: string | null
  active: boolean
  humanMode?: boolean
  humanSince?: number | null
  lastQuestion: string | null
  updatedAt: number
}
export interface Msg {
  role: string
  text?: string
  tool?: string
  input?: string
  result?: string
  ts?: number
  model?: string
}

export type Filter = "all" | "active" | "human"
