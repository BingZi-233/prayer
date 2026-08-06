import type { Repo } from "../db/repo"

export class SessionStore {
  // resumeTtlMs > 0:会话空闲超时则不 resume,下条消息开全新对话。<= 0 关闭。
  constructor(
    private repo: Repo,
    private resumeTtlMs = 0
  ) {}

  resumeId(sessionKey: string): string | undefined {
    return this.repo.getResumeId(sessionKey, this.resumeTtlMs)
  }

  remember(sessionKey: string, sessionId: string): void {
    this.repo.setSessionId(sessionKey, sessionId)
  }

  /** 仅刷活跃时间(不动 resume 指针):主管线接管消息时在 handle 入口调用,
   *  让主动补位压制②在 agent.run 窗口期内也能看见「已接管」,防抢答双发。 */
  touch(sessionKey: string): void {
    this.repo.touchSession(sessionKey)
  }

  /** 丢弃续接指针(下条开新会话);保留 session_id 供网页查历史。 */
  forgetResume(sessionKey: string): void {
    this.repo.clearResumeId(sessionKey)
  }
}
