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

  /** 丢弃续接指针(下条开新会话);保留 session_id 供网页查历史。 */
  forgetResume(sessionKey: string): void {
    this.repo.clearResumeId(sessionKey);
  }
}
