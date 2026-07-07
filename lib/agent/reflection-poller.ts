import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { bus } from "../bus";
import type { Repo } from "../db/repo";
import { embed as defaultEmbed } from "../tools/embed";
import { sdkEnv } from "./agent";

export interface ReflectionPollerDeps {
  repo: Repo;
  adminGroupId: number;
  scanMs?: number;
  lookbackMs?: number;
  settleMs?: number;
  windowMax?: number;
  enabledGroups?: number[];
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
  embed: (text: string) => Promise<Float32Array>;
  queryFn: typeof sdkQuery;
  now: () => number;
}

const REFLECT_SYSTEM = `你是客服知识运营助手。用户消息会给出一段 QQ 群对话记录,每行格式 [ts=毫秒][角色 QQ] 文本,角色为"客服"(群主/群管)或"用户",并给出一个已沉降时间区间。
任务:只针对 ts 落在该区间内、且角色为"客服"的发言,判断它是否在有效解答某个用户问题。区间外与用户发言仅作上下文。
有效性(两信号):优先看后续 —— 该客服回答之后,提问用户是否表示感谢/确认解决/不再追问,是则有效;若窗口内该问题没有用户后续,则退回判断回答本身是否完整、正确、可复用。
排除(判为无效/跳过):闲聊寒暄、纯指令、与提问无关、信息不足、一次性、含隐私(订单号/手机号)。
对每条有效解答输出一个对象,faq 需脱离本次上下文、含问题要点与结论,纯文本一段。
只输出一个 JSON 数组,不要额外文字,不要 Markdown 代码块:
[{"question":"...","answer":"...","effective":true,"faq":"..."}]
无可沉淀输出 []。`;

const PRE_CONTEXT = 10; // band 前作为问题上下文的消息条数

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

async function collectText(iter: unknown): Promise<string> {
  let out = "";
  for await (const msg of iter as AsyncIterable<any>) {
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) if (b.type === "text") out += b.text;
    }
  }
  return out;
}

function resolve(deps: ReflectionPollerDeps): Resolved {
  return {
    repo: deps.repo,
    adminGroupId: deps.adminGroupId,
    lookbackMs: deps.lookbackMs ?? 7_200_000,
    settleMs: deps.settleMs ?? 600_000,
    windowMax: deps.windowMax ?? 60,
    enabledGroups: deps.enabledGroups ?? [],
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
      const prompt = `已沉降时间区间(只判定此区间内客服发言):(${cursor}, ${until}]\n\n对话记录:\n${transcript}`;
      const out = await collectText(
        d.queryFn({
          prompt,
          options: {
            systemPrompt: REFLECT_SYSTEM,
            canUseTool: async () => ({ behavior: "deny" as const, message: "反思阶段不使用工具" }),
            maxTurns: 1,
            // 同 agent.ts:防 settings 里的 bypassPermissions 把 canUseTool 短路掉
            permissionMode: "default",
            settingSources: ["user"],
            // 与 agent 一致:剥继承 ANTHROPIC_*,用 CLAUDE_CONFIG_DIR/settings.json 的 env
            env: sdkEnv(),
          } as never,
        })
      );
      for (const it of extractJsonArray(out)) {
        if (!it || it.effective !== true || typeof it.faq !== "string" || !it.faq.trim()) continue;
        const faq = it.faq.trim();
        d.repo.insertKbEntry("human-reflection", faq, `human-reflection:${groupId}:${d.now()}`, await d.embed(faq));
        bus.emit("action.send", {
          action: "send_group_msg",
          groupId: d.adminGroupId,
          text: `已从群 ${groupId} 的人工回复沉淀 1 条知识:${faq.slice(0, 40)}${faq.length > 40 ? "…" : ""}`,
        });
      }
      d.repo.setGroupReflectCursor(groupId, until); // 成功才推进该群游标
    } catch (err) {
      // 该群不推进游标 → 下轮重试;剪枝上限保证最终自愈(超 lookback+settle 放弃)
      bus.emit("error.occurred", { scope: "reflection", err, groupId });
    }
  }

  d.repo.pruneGroupMessages(now - d.lookbackMs - d.settleMs);
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
