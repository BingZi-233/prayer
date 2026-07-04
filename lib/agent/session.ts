import type { Repo } from "../db/repo";

export class SessionStore {
  constructor(private repo: Repo) {}

  resumeId(sessionKey: string): string | undefined {
    return this.repo.getResumeId(sessionKey);
  }

  remember(sessionKey: string, sessionId: string): void {
    this.repo.setSessionId(sessionKey, sessionId);
  }
}
