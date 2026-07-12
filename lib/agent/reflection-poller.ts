import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { bus } from "../bus";
import type { Repo, KbHit } from "../db/repo";
import { embed as defaultEmbed } from "../tools/embed";
import { noToolQueryOptions, drainQuery } from "./agent";

export interface ReflectionPollerDeps {
  repo: Repo;
  adminGroupId: number;
  scanMs?: number;
  lookbackMs?: number;
  settleMs?: number;
  windowMax?: number;
  enabledGroups?: number[];
  // 沉淀成功后是否向管理群发通知。缺省 true
  notifyAdmin?: boolean;
  /** 入库前向量近邻条数。缺省 5 */
  dupTopK?: number;
  /** 向量距离上限(sqlite-vec L2,越小越近);在阈值内且文本相关则判重复。缺省 0.45 */
  dupMaxDistance?: number;
  /** 喂给 LLM 的已有知识片段条数。缺省 6 */
  kbContextK?: number;
  embed?: (text: string) => Promise<Float32Array>;
  queryFn?: typeof sdkQuery;
  now?: () => number;
}

interface Resolved {
  repo: Repo;
  adminGroupId: number;
  lookbackMs: number;
  settleMs: number;
  windowMax: number;
  enabledGroups: number[];
  notifyAdmin: boolean;
  dupTopK: number;
  dupMaxDistance: number;
  kbContextK: number;
  embed: (text: string) => Promise<Float32Array>;
  queryFn: typeof sdkQuery;
  now: () => number;
}

const REFLECT_SYSTEM = `你是客服知识运营助手。用户消息会给出:
一、一段 QQ 群对话记录,每行格式 [ts=毫秒][角色 QQ] 文本,角色为"客服"(群主/群管)或"用户",并给出一个已沉降时间区间。
二、【已有知识库相关片段】——与本段对话语义相近的正式文档/历史沉淀摘录(可能为空)。
任务:只针对 ts 落在该区间内、且角色为"客服"的发言,判断它是否在有效解答某个用户问题。区间外与用户发言仅作上下文。
有效性(两信号):优先看后续 —— 该客服回答之后,提问用户是否表示感谢/确认解决/不再追问,是则有效;若窗口内该问题没有用户后续,则退回判断回答本身是否完整、正确、可复用。
排除(判为无效/跳过):闲聊寒暄、纯指令、与提问无关、信息不足、一次性、含隐私(订单号/手机号)。
去重(重要):若有效解答的知识要点已被【已有知识库相关片段】清楚覆盖、无实质增量(新步骤/新条件/新例外/纠正),则不要输出该条(或 effective=false)。仅当有可复用的新信息时才沉淀。
对每条应沉淀的有效解答输出一个对象,faq 需脱离本次上下文、含问题要点与结论,纯文本一段。
只输出一个 JSON 数组,不要额外文字,不要 Markdown 代码块:
[{"question":"...","answer":"...","effective":true,"faq":"..."}]
无可沉淀输出 []。`;

const PRE_CONTEXT = 10; // band 前作为问题上下文的消息条数
export const DEFAULT_DUP_TOP_K = 5;
export const DEFAULT_DUP_MAX_DISTANCE = 0.45;
export const DEFAULT_KB_CONTEXT_K = 6;

function extractJsonArray(s: string): any[] {
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function label(role: string | null): string {
  return role === "owner" || role === "admin" ? "客服" : "用户";
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** 字符 bigram Jaccard,适合中文短 FAQ 近义/包含判断 */
export function bigramJaccard(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x.length || !y.length) return 0;
  if (x === y) return 1;
  const grams = (s: string): Set<string> => {
    const g = new Set<string>();
    if (s.length === 1) {
      g.add(s);
      return g;
    }
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  };
  const A = grams(x);
  const B = grams(y);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function textNearlySame(a: string, b: string): boolean {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 8 && y.length >= 8 && (x.includes(y) || y.includes(x))) return true;
  return bigramJaccard(a, b) >= 0.72;
}

/** 向量近邻内是否与 FAQ 文本相关(防 embedding 误伤) */
export function lexicalRelated(a: string, b: string): boolean {
  if (textNearlySame(a, b)) return true;
  return bigramJaccard(a, b) >= 0.35;
}

/**
 * 判断 FAQ 是否已被知识库覆盖。
 * - 向量距离 ≤ maxDistance 且文本相关 → 重复
 * - 或 top 命中中文本高度重合 → 重复(embedding 漂移兜底)
 */
export function isDuplicateOfHits(
  faq: string,
  hits: Pick<KbHit, "content" | "distance">[],
  maxDistance: number
): { duplicate: boolean; hit?: Pick<KbHit, "content" | "distance">; reason?: string } {
  if (!hits.length) return { duplicate: false };
  for (const h of hits) {
    if (textNearlySame(faq, h.content)) {
      return { duplicate: true, hit: h, reason: "text" };
    }
    if (h.distance <= maxDistance && lexicalRelated(faq, h.content)) {
      return { duplicate: true, hit: h, reason: `vector d=${h.distance.toFixed(3)}` };
    }
  }
  return { duplicate: false };
}

/** 从对话文本检索相关已有知识,按 chunk id 去重后截断 */
export async function collectKbContext(
  repo: Repo,
  embed: (text: string) => Promise<Float32Array>,
  texts: string[],
  k: number
): Promise<KbHit[]> {
  const byId = new Map<number, KbHit>();
  const queries = texts.map((t) => t.trim()).filter((t) => t.length >= 4);
  // 无有效查询 → 空
  if (!queries.length) return [];
  // 合并过长:整段转录一次 + 各客服句(上限 5 句)以覆盖多主题
  const batch: string[] = [];
  const joined = queries.join("\n");
  if (joined.length > 0) batch.push(joined.slice(0, 2000));
  for (const q of queries.slice(0, 5)) {
    if (!batch.includes(q)) batch.push(q);
  }
  for (const q of batch) {
    for (const h of repo.searchKb(await embed(q), Math.max(k, 3))) {
      const prev = byId.get(h.id);
      if (!prev || h.distance < prev.distance) byId.set(h.id, h);
    }
  }
  return [...byId.values()].sort((a, b) => a.distance - b.distance).slice(0, k);
}

function resolve(deps: ReflectionPollerDeps): Resolved {
  return {
    repo: deps.repo,
    adminGroupId: deps.adminGroupId,
    lookbackMs: deps.lookbackMs ?? 7_200_000,
    settleMs: deps.settleMs ?? 600_000,
    windowMax: deps.windowMax ?? 60,
    enabledGroups: deps.enabledGroups ?? [],
    notifyAdmin: deps.notifyAdmin ?? true,
    dupTopK: deps.dupTopK ?? DEFAULT_DUP_TOP_K,
    dupMaxDistance: deps.dupMaxDistance ?? DEFAULT_DUP_MAX_DISTANCE,
    kbContextK: deps.kbContextK ?? DEFAULT_KB_CONTEXT_K,
    embed: deps.embed ?? defaultEmbed,
    queryFn: deps.queryFn ?? sdkQuery,
    now: deps.now ?? (() => Date.now()),
  };
}

async function scanOnce(d: Resolved): Promise<void> {
  const now = d.now();
  const until = now - d.settleMs; // 已沉降上界
  if (until <= 0) return;

  const enabled = new Set(d.enabledGroups);
  for (const groupId of d.repo.groupsWithAdminMessagesUpTo(until)) {
    if (!enabled.has(groupId)) continue; // 生效群门:非生效群不沉淀
    const cursor = d.repo.groupReflectCursor(groupId);
    if (until <= cursor) continue; // 该群已处理到此
    // 该群 band 内无新管理发言(旧发言早已处理) → 直接推进跳过,不喂 LLM
    if (!d.repo.hasAdminMessageBetween(groupId, cursor, until)) {
      d.repo.setGroupReflectCursor(groupId, until);
      continue;
    }
    try {
      const window = d.repo.groupReflectionWindow(groupId, cursor, now, PRE_CONTEXT, d.windowMax);
      if (!window.length) continue;
      const transcript = window
        .map((m) => `[ts=${m.createdAt}][${label(m.senderRole)} ${m.userId}] ${m.text}`)
        .join("\n");
      // 用客服发言 + 用户问题检索已有知识,供 LLM 去重判断
      const probeTexts = window
        .filter((m) => m.senderRole === "owner" || m.senderRole === "admin" || m.senderRole === "member" || !m.senderRole)
        .map((m) => m.text);
      const kbHits = await collectKbContext(d.repo, d.embed, probeTexts, d.kbContextK);
      const kbBlock =
        kbHits.length > 0
          ? kbHits.map((h, i) => `(${i + 1}) ${h.content}`).join("\n")
          : "(无相近片段)";
      const prompt = `已沉降时间区间(只判定此区间内客服发言):(${cursor}, ${until}]\n\n【已有知识库相关片段】\n${kbBlock}\n\n对话记录:\n${transcript}`;
      const { text: out } = await drainQuery(
        d.queryFn({
          prompt,
          options: noToolQueryOptions({
            systemPrompt: REFLECT_SYSTEM,
            // JSON 抽取任务,关思考省成本/延迟;单次覆盖全局 alwaysThinkingEnabled
            thinking: { type: "disabled" },
            canUseTool: async () => ({ behavior: "deny" as const, message: "反思阶段不使用工具" }),
            // maxTurns:2 而非 1:模型偶发首轮吐 tool_use(MiniMax-M3 尤甚),deny 回消息须第 2 轮
            // 消费才能出文本;maxTurns:1 下 SDK 直接 reject「Reached maximum number of turns」误判为错误。
            maxTurns: 2,
          }) as never,
        }) as AsyncIterable<any>,
        "reflect"
      );
      for (const it of extractJsonArray(out)) {
        if (!it || it.effective !== true || typeof it.faq !== "string" || !it.faq.trim()) continue;
        const faq = it.faq.trim();
        // 入库前硬去重:对照全库(含正式文档与历史反思)
        const faqVec = await d.embed(faq);
        const near = d.repo.searchKb(faqVec, d.dupTopK);
        const dup = isDuplicateOfHits(faq, near, d.dupMaxDistance);
        if (dup.duplicate) continue;
        const chunkId = d.repo.insertKbEntry(
          "human-reflection",
          faq,
          `human-reflection:${groupId}:${d.now()}`,
          faqVec
        );
        // 落来源问答(供 web 追溯这条沉淀从哪次人工问答来);question/answer 缺失回退空串
        d.repo.insertReflectionMeta(
          chunkId,
          groupId,
          typeof it.question === "string" ? it.question : "",
          typeof it.answer === "string" ? it.answer : ""
        );
        if (d.notifyAdmin) {
          bus.emit("action.send", {
            action: "send_group_msg",
            groupId: d.adminGroupId,
            text: `已从群 ${groupId} 的人工回复沉淀 1 条知识:${faq.slice(0, 40)}${faq.length > 40 ? "…" : ""}`,
          });
        }
      }
      d.repo.setGroupReflectCursor(groupId, until); // 成功才推进该群游标
    } catch (err) {
      // 该群不推进游标 → 下轮重试;剪枝上限保证最终自愈(超 lookback+settle 放弃)
      bus.emit("error.occurred", { scope: "reflection", err, groupId });
    }
  }

  // 删除下界纳入问题排行游标:只删反思与 topic 两侧都已越过的消息,防止未归类提问被提前 prune。
  d.repo.pruneGroupMessages(
    Math.min(now - d.lookbackMs - d.settleMs, d.repo.minTopicCursor(d.enabledGroups))
  );
}

// 供测试直接驱动一次扫描
export async function runScan(deps: ReflectionPollerDeps): Promise<void> {
  await scanOnce(resolve(deps));
}

// 监听式装配:定时扫描,返回 teardown。旁路观察者,失败不阻断主链路。
export function registerReflectionPoller(deps: ReflectionPollerDeps): () => void {
  const d = resolve(deps);
  const scanMs = deps.scanMs ?? 300_000;
  let running = false; // 防重入:上一轮未结束则跳过本次触发,避免同群游标推进前被重复判定/沉淀
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void scanOnce(d)
      .catch((err) => bus.emit("error.occurred", { scope: "reflection", err }))
      .finally(() => {
        running = false;
      });
  }, scanMs);
  return () => clearInterval(timer);
}
