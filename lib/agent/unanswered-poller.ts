import { bus } from "../bus";
import { logger } from "../logger";
import type { Repo } from "../db/repo";
import type { Agent } from "./agent";
import type { SessionStore } from "./session";
import type { AnswerabilityClassifier } from "./answerability";

// 主动模式哨兵:无把握时 agent 只输出此串 → poller 判为非答案,沉默不发。
export const PROACTIVE_SUFFIX =
  "【主动模式】你是在无人应答时主动补位。仅当知识库检索到确切依据且你有把握时才作答;否则只输出 __NO_ANSWER__(不解释、不道歉、不引导工单、不寒暄)。";

export interface UnansweredPollerDeps {
  repo: Repo;
  agent: Agent;
  store: SessionStore;
  classify: AnswerabilityClassifier;
  adminGroupId: number;
  enabledGroups: number[];
  scanMs?: number;
  silenceMs?: number;
  maxPerScan?: number;
  now?: () => number;
}

interface Resolved {
  repo: Repo;
  agent: Agent;
  store: SessionStore;
  classify: AnswerabilityClassifier;
  adminGroupId: number;
  enabledGroups: number[];
  silenceMs: number;
  maxPerScan: number;
  now: () => number;
}

function resolve(d: UnansweredPollerDeps): Resolved {
  return {
    repo: d.repo,
    agent: d.agent,
    store: d.store,
    classify: d.classify,
    adminGroupId: d.adminGroupId,
    enabledGroups: d.enabledGroups ?? [],
    silenceMs: d.silenceMs ?? 180_000,
    maxPerScan: d.maxPerScan ?? 2,
    now: d.now ?? (() => Date.now()),
  };
}

// 真答案判定:非空且不含哨兵。撞哨兵/空 → 沉默。
function isAnswer(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && !t.includes("__NO_ANSWER__");
}

async function scanOnce(d: Resolved): Promise<void> {
  const now = d.now();
  const until = now - d.silenceMs; // 已沉默上界:早于此的消息才够沉默窗口
  if (until <= 0) return;

  const enabled = new Set(d.enabledGroups);
  for (const groupId of enabled) {
    if (groupId === d.adminGroupId) continue;
    try {
      const cursor = d.repo.groupProactiveCursor(groupId);
      if (until <= cursor) continue; // 无新沉降
      // 冷启动:首见该群 → 只推进游标,绝不回答上线前积压
      if (cursor === 0) {
        d.repo.setGroupProactiveCursor(groupId, until);
        continue;
      }

      const rows = d.repo.groupMemberMessagesBetween(groupId, cursor, until);
      // 按 userId 归组:每人取 band 内文本(升序拼接)作上下文,代表 ts = 最后一条
      const byUser = new Map<number, { text: string; questionTs: number }>();
      for (const r of rows) {
        const prev = byUser.get(r.userId);
        byUser.set(r.userId, {
          text: prev ? `${prev.text}\n${r.text}` : r.text,
          questionTs: r.createdAt,
        });
      }

      let hits = 0;
      for (const [userId, { text, questionTs }] of byUser) {
        if (hits >= d.maxPerScan) break;
        // 压制①:问题后(至 now)群里有 owner/admin 发言 → 人工接管
        if (d.repo.hasAdminMessageBetween(groupId, questionTs, now)) continue;
        // 压制②:该用户会话已被主链路 @处理 / 已兜底过
        const key = `${groupId}:${userId}`;
        const upd = d.repo.sessionUpdatedAt(key);
        if (upd !== undefined && upd > questionTs) continue;
        // 门1:可答性
        if (!(await d.classify(text))) continue;
        // 门2:复用主链路 agent,带哨兵
        const result = await d.agent.run(
          text,
          d.store.resumeId(key),
          { sessionKey: key, groupId, userId },
          undefined,
          { systemSuffix: PROACTIVE_SUFFIX }
        );
        if (!isAnswer(result.text)) continue; // 哨兵/空 → 沉默
        if (result.sessionId) d.store.remember(key, result.sessionId);
        bus.emit("reply.ready", { groupId, text: result.text });
        logger.log("info", `[proactive] 群 ${groupId} 主动回答用户 ${userId}`);
        hits++;
      }

      d.repo.setGroupProactiveCursor(groupId, until);
    } catch (err) {
      // 单群失败不牵连其他群;该群不推进游标 → 下轮重试
      bus.emit("error.occurred", { scope: "proactive", err, groupId });
    }
  }
}

// 供测试直接驱动一次扫描
export async function runScan(deps: UnansweredPollerDeps): Promise<void> {
  await scanOnce(resolve(deps));
}

// 监听式装配:定时扫描,返回 teardown。旁路观察者,失败不阻断主链路。
export function registerUnansweredPoller(deps: UnansweredPollerDeps): () => void {
  const d = resolve(deps);
  const scanMs = deps.scanMs ?? 60_000;
  const timer = setInterval(() => {
    void scanOnce(d).catch((err) => bus.emit("error.occurred", { scope: "proactive", err }));
  }, scanMs);
  return () => clearInterval(timer);
}
