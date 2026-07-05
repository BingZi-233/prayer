import type { Repo } from "../db/repo";

export class SessionStore {
  // resumeTtlMs > 0:会话空闲超时则不 resume,下条消息开全新对话。<= 0 关闭。
  constructor(private repo: Repo, private resumeTtlMs = 0) {}

  resumeId(sessionKey: string): string | undefined {
    return this.repo.getResumeId(sessionKey, this.resumeTtlMs);
  }

  remember(sessionKey: string, sessionId: string): void {
    this.repo.setSessionId(sessionKey, sessionId);
  }
}
