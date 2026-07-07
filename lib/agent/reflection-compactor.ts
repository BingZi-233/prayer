import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { bus } from "../bus";
import type { Repo } from "../db/repo";
import { embed as defaultEmbed } from "../tools/embed";
import { sdkEnv } from "./agent";

export interface ReflectionCompactorDeps {
  repo: Repo;
  adminGroupId: number;
  compactMs?: number;
  minEntries?: number;
  baseContextK?: number;
  embed?: (text: string) => Promise<Float32Array>;
  queryFn?: typeof sdkQuery;
  now?: () => number;
}

interface Resolved {
  repo: Repo;
  adminGroupId: number;
  minEntries: number;
  baseContextK: number;
  embed: (text: string) => Promise<Float32Array>;
  queryFn: typeof sdkQuery;
  now: () => number;
}

const COMPACT_SYSTEM = `你是客服知识库整理助手。用户消息会给出两部分:
一、【权威基础文档片段】——正式产品文档节选,视为最新、最权威。
二、【现有反思条目】——历史沉淀的客服问答 FAQ,每条带序号。
任务:输出整理后的反思条目集,规则:
- 近义合并:表达同一问题要点的多条合并为一条更完整的 FAQ。
- 删除被基础文档覆盖:某条反思讲的内容基础文档已清楚覆盖,则删除(基础文档会被单独检索,无需在反思里重复)。
- 删除矛盾/失效:与基础文档或更完整反思冲突的旧条目删除。
硬约束:只能基于【现有反思条目】做合并与删除,不得新增基础片段之外的新事实,不得把基础文档片段本身写成反思条目。
只输出一个 JSON 数组,不要额外文字,不要 Markdown 代码块:
[{"faq":"整理后的问答要点,纯文本一段"}]
若全部应删除,仍至少保留信息量最高的若干条,不要输出空数组。`;

function resolve(deps: ReflectionCompactorDeps): Resolved {
  return {
    repo: deps.repo,
    adminGroupId: deps.adminGroupId,
    minEntries: deps.minEntries ?? 10,
    baseContextK: deps.baseContextK ?? 3,
    embed: deps.embed ?? defaultEmbed,
    queryFn: deps.queryFn ?? sdkQuery,
    now: deps.now ?? (() => Date.now()),
  };
}

function extractJsonArray(s: string): unknown {
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
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

// 安全底线:解析 + 校验 LLM 产出。返回整理后 faq 列表;任一异常返回 null(调用方保留旧库)。
export function validateCompacted(raw: string, inputCount: number): string[] | null {
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) return null;
  const faqs = parsed
    .map((x) => (x && typeof x.faq === "string" ? x.faq.trim() : ""))
    .filter((s) => s.length > 0);
  if (faqs.length === 0 && inputCount > 0) return null; // 空集视为异常,防清空
  if (faqs.length > Math.ceil(inputCount * 1.5)) return null; // 暴涨视为无视约束
  return faqs;
}

// 执行一轮压缩整理,供测试直驱。旁路:异常保留旧库并 emit error,不抛。
export async function runCompact(deps: ReflectionCompactorDeps): Promise<void> {
  const d = resolve(deps);
  const entries = d.repo.reflectionEntries();
  if (entries.length < d.minEntries) return;

  try {
    // 权威上下文:逐条反思检索基础文档 top-k,按 chunk id 去重
    const ctx = new Map<number, string>();
    for (const e of entries) {
      for (const h of d.repo.searchBaseKb(await d.embed(e.content), d.baseContextK)) {
        ctx.set(h.id, h.content);
      }
    }
    const baseBlock = [...ctx.values()].map((c, i) => `(${i + 1}) ${c}`).join("\n");
    const refBlock = entries.map((e, i) => `[${i + 1}] ${e.content}`).join("\n");
    const prompt = `【权威基础文档片段】\n${baseBlock || "(无)"}\n\n【现有反思条目】\n${refBlock}`;

    const out = await collectText(
      d.queryFn({
        prompt,
        options: {
          systemPrompt: COMPACT_SYSTEM,
          canUseTool: async () => ({ behavior: "deny" as const, message: "压缩阶段不使用工具" }),
          maxTurns: 1,
          permissionMode: "default",
          settingSources: ["user"],
          env: sdkEnv(),
        } as never,
      })
    );

    const faqs = validateCompacted(out, entries.length);
    if (!faqs) {
      bus.emit("error.occurred", {
        scope: "reflection-compact",
        err: new Error("LLM 产出未过安全校验,保留旧库"),
      });
      return;
    }

    const withVec: { content: string; embedding: Float32Array }[] = [];
    for (const faq of faqs) withVec.push({ content: faq, embedding: await d.embed(faq) });
    d.repo.replaceReflectionEntries(withVec, d.now());

    bus.emit("action.send", {
      action: "send_group_msg",
      groupId: d.adminGroupId,
      text: `反思整理:${entries.length} → ${faqs.length} 条`,
    });
  } catch (err) {
    bus.emit("error.occurred", { scope: "reflection-compact", err });
  }
}

// Task 5 补 registerReflectionCompactor(定时器 + 防重入)
