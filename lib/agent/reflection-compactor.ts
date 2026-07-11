import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { bus } from "../bus";
import { logger } from "../logger";
import type { Repo } from "../db/repo";
import { embed as defaultEmbed } from "../tools/embed";
import { noToolQueryOptions, drainQuery } from "./agent";

export interface ReflectionCompactorDeps {
  repo: Repo;
  adminGroupId: number;
  compactMs?: number;
  // 到期检查周期:每隔 scanMs 看一次 now-compactAt 是否 ≥ compactMs。缺省 min(compactMs, 1h)
  scanMs?: number;
  // 装配后首次到期检查的延迟,给 boot 让路。缺省 30s
  firstDelayMs?: number;
  minEntries?: number;
  baseContextK?: number;
  // 整理成功后是否向管理群发通知。缺省 true
  notifyAdmin?: boolean;
  embed?: (text: string) => Promise<Float32Array>;
  queryFn?: typeof sdkQuery;
  now?: () => number;
}

interface Resolved {
  repo: Repo;
  adminGroupId: number;
  minEntries: number;
  baseContextK: number;
  notifyAdmin: boolean;
  embed: (text: string) => Promise<Float32Array>;
  queryFn: typeof sdkQuery;
  now: () => number;
}

// SDK outputFormat.json_schema 强制根对象(非裸数组);items 为整理后 FAQ 列表。
// additionalProperties:false 防模型塞 source/id 等额外字段膨胀输出。
export const COMPACT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          faq: {
            type: "string",
            description:
              "整理后的完整 FAQ:问题要点+结论/步骤/例外/数字等关键细节须保留,禁止摘要式缩短",
          },
        },
        required: ["faq"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

// 自学习定位:整理=去重提质,不是删知识。基础文档仅作矛盾校验,不因「已覆盖」删反思。
const COMPACT_SYSTEM = `你是客服知识库整理助手。反思条目是从人工有效答复中沉淀的自学习知识,整理目的是去重提质,不是遗忘。
用户消息会给出两部分:
一、【权威基础文档片段】——正式产品文档节选,仅用于判断反思是否与之明确矛盾。
二、【现有反思条目】——历史沉淀的客服 FAQ,每条带序号;这些条目已在检索知识库中生效。
任务:输出整理后的反思条目集,规则:
- 近义合并:表达同一问题要点的多条合并为一条更完整的 FAQ;合并时必须保留各方的关键细节(步骤、条件、例外、数字、口吻要点),禁止只留摘要。
- 独立保留:主题不同的条目原样保留,不得丢弃。
- 禁止因「基础文档已覆盖/已写过」而删除——反思可作口语化补充、边界 case 或实操细节,覆盖不等于冗余。
- 仅当与基础文档明确矛盾、或与更完整反思直接冲突且明显过时/错误时,才删除该条。
- 禁止无故缩短:未合并的条目应基本保留原信息量,不得把长 FAQ 压成一句话。
硬约束:只能基于【现有反思条目】做合并与删除,不得新增基础片段之外的新事实,不得把基础文档片段本身写成反思条目。
输出由 JSON Schema 强制为 {"items":[{"faq":"..."}]};faq 须完整可用。
若无可合并/删除,原样输出全部条目。若全部应删除,仍至少保留信息量最高的若干条,不要输出空 items。`;

// 截断 salvage 时的最低保留比例:防止只解析出前 1~2 条就把整库替换掉。
const TRUNCATED_MIN_RATIO = 0.2;
// 完整解析时的最低保留比例:自学习不允许一轮整理把大半知识抹掉(近义合并通常仍 ≥ 此比例)。
export const COMPLETE_MIN_RATIO = 0.7;

function resolve(deps: ReflectionCompactorDeps): Resolved {
  return {
    repo: deps.repo,
    adminGroupId: deps.adminGroupId,
    minEntries: deps.minEntries ?? 10,
    baseContextK: deps.baseContextK ?? 3,
    notifyAdmin: deps.notifyAdmin ?? true,
    embed: deps.embed ?? defaultEmbed,
    queryFn: deps.queryFn ?? sdkQuery,
    now: deps.now ?? (() => Date.now()),
  };
}

// 从 start 起扫描,返回与 s[start] 配对的闭合括号下标;字符串内括号忽略。
// 未闭合返回 -1(截断)。
function findBalancedEnd(s: string, start: number): number {
  const open = s[start];
  const close = open === "[" ? "]" : open === "{" ? "}" : null;
  if (!close) return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// 从数组开括号后 salvage 完整顶层对象(跳过截断中的半条)。
function salvageArrayObjects(s: string, arrayStart: number): unknown[] {
  const items: unknown[] = [];
  let i = arrayStart + 1;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i]!)) i++;
    if (i >= s.length || s[i] === "]") break;
    if (s[i] !== "{") break;
    const end = findBalancedEnd(s, i);
    if (end < 0) break; // 半截对象,停
    try {
      items.push(JSON.parse(s.slice(i, end + 1)));
    } catch {
      break;
    }
    i = end + 1;
  }
  return items;
}

// 解析 LLM 产出的 JSON 数组(文本兜底路径)。
// 不用贪婪 /\[...\]/:嵌套 "source":[1] 的 ] 会让截断文本匹配成非法片段。
// 策略:括号配对完整 → 整段 parse;否则 salvage 已写完的顶层对象。
// 返回 { items, truncated }:truncated=true 表示外层数组未闭合(输出被截断)。
function extractJsonArray(s: string): { items: unknown[]; truncated: boolean } | null {
  // 优先尝试 schema 根对象 {"items":[...]}
  const objStart = s.indexOf("{");
  const arrStart = s.indexOf("[");
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    const end = findBalancedEnd(s, objStart);
    if (end >= 0) {
      try {
        const v = JSON.parse(s.slice(objStart, end + 1));
        if (v && typeof v === "object" && Array.isArray(v.items)) {
          return { items: v.items, truncated: false };
        }
      } catch {
        /* fall through to array path */
      }
    }
  }
  const start = arrStart;
  if (start < 0) return null;
  const end = findBalancedEnd(s, start);
  if (end >= 0) {
    try {
      const v = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(v)) return { items: v, truncated: false };
    } catch {
      // 配对成功但内容非法:再尝试 salvage
    }
  }
  const salvaged = salvageArrayObjects(s, start);
  if (salvaged.length === 0) return null;
  return { items: salvaged, truncated: true };
}

// structured_output / 文本解析统一抽出 items 列表。
function itemsFromPayload(structured: unknown | undefined, rawText: string): { items: unknown[]; truncated: boolean } | null {
  if (structured !== undefined && structured !== null) {
    if (Array.isArray(structured)) return { items: structured, truncated: false };
    if (typeof structured === "object" && Array.isArray((structured as { items?: unknown }).items)) {
      return { items: (structured as { items: unknown[] }).items, truncated: false };
    }
    return null;
  }
  return extractJsonArray(rawText);
}

// 安全底线:解析 + 校验 LLM 产出。ok=false 时带 reason,供调用方 log 定位(哪个 guard 触发)。
// structured 优先(outputFormat.json_schema 已校验过形状);无则回退文本解析/截断 salvage。
type CompactCheck = { ok: true; faqs: string[] } | { ok: false; reason: string };
export function validateCompactedDetailed(
  raw: string,
  inputCount: number,
  structured?: unknown
): CompactCheck {
  const extracted = itemsFromPayload(structured, raw);
  if (!extracted) {
    return {
      ok: false,
      reason:
        structured !== undefined && structured !== null
          ? "structured_output 非 {items:[...]} / 数组"
          : "非 JSON 数组(未匹配到 [...] 或解析失败)",
    };
  }
  const faqs = extracted.items
    .map((x) => (x && typeof (x as { faq?: unknown }).faq === "string" ? (x as { faq: string }).faq.trim() : ""))
    .filter((s) => s.length > 0);
  if (faqs.length === 0 && inputCount > 0) return { ok: false, reason: "空集(输入非空,防清空)" };
  if (faqs.length > Math.ceil(inputCount * 1.5))
    return { ok: false, reason: `条目暴涨 ${faqs.length} > 输入 ${inputCount} ×1.5(疑无视约束)` };
  // 截断 salvage:只拿到数组前半段完整对象,若条数过少疑似大半还没写出 → 拒,防误清空
  if (extracted.truncated && inputCount > 0) {
    const floor = Math.max(1, Math.ceil(inputCount * TRUNCATED_MIN_RATIO));
    if (faqs.length < floor) {
      return {
        ok: false,
        reason: `截断产出仅 ${faqs.length} 条 < 输入 ${inputCount} ×${TRUNCATED_MIN_RATIO} 下限 ${floor}(疑输出被截断)`,
      };
    }
  }
  // 完整解析:自学习不允许一轮大幅抹掉知识(近义合并通常仍 ≥ COMPLETE_MIN_RATIO)
  if (!extracted.truncated && inputCount > 0) {
    const floor = Math.max(1, Math.ceil(inputCount * COMPLETE_MIN_RATIO));
    if (faqs.length < floor) {
      return {
        ok: false,
        reason: `完整产出仅 ${faqs.length} 条 < 输入 ${inputCount} ×${COMPLETE_MIN_RATIO} 下限 ${floor}(疑过度删除,保留旧库)`,
      };
    }
  }
  return { ok: true, faqs };
}

// 保留原签名(测试与外部依赖):返回整理后 faq 列表;任一异常返回 null(调用方保留旧库)。
export function validateCompacted(raw: string, inputCount: number, structured?: unknown): string[] | null {
  const r = validateCompactedDetailed(raw, inputCount, structured);
  return r.ok ? r.faqs : null;
}

// 执行一轮压缩整理,供测试直驱。旁路:异常保留旧库并 emit error,不抛。
export async function runCompact(deps: ReflectionCompactorDeps): Promise<void> {
  const d = resolve(deps);
  // 只整理已入库未升格/未驳回的条目;已升格条目保留作审计,不参与整库替换
  const entries = d.repo.reflectionEntries().filter((e) => e.status === "approved");
  if (entries.length < d.minEntries) return;

  try {
    // 权威上下文:逐条反思检索基础文档 top-k,按 chunk id 去重(仅供矛盾判断,不因覆盖而删)
    const ctx = new Map<number, string>();
    for (const e of entries) {
      for (const h of d.repo.searchBaseKb(await d.embed(e.content), d.baseContextK)) {
        ctx.set(h.id, h.content);
      }
    }
    const baseBlock = [...ctx.values()].map((c, i) => `(${i + 1}) ${c}`).join("\n");
    const refBlock = entries.map((e, i) => `[${i + 1}] ${e.content}`).join("\n");
    const prompt = `【权威基础文档片段】\n${baseBlock || "(无)"}\n\n【现有反思条目】\n${refBlock}`;

    const { text: out, structuredOutput } = await drainQuery(
      d.queryFn({
        prompt,
        options: noToolQueryOptions({
          systemPrompt: COMPACT_SYSTEM,
          // API 侧强制 JSON Schema,杜绝自由文本/markdown/截断半 JSON
          outputFormat: { type: "json_schema", schema: COMPACT_OUTPUT_SCHEMA },
          // JSON 整理任务,关思考省成本/延迟;单次覆盖全局 alwaysThinkingEnabled
          thinking: { type: "disabled" },
          canUseTool: async () => ({ behavior: "deny" as const, message: "压缩阶段不使用工具" }),
          // maxTurns:2 而非 1:模型偶发首轮吐 tool_use,deny 回消息须第 2 轮消费才出文本;
          // maxTurns:1 下 SDK 直接 reject「Reached maximum number of turns」误判为错误。
          maxTurns: 2,
        }) as never,
      }) as AsyncIterable<any>,
      "compact"
    );

    const check = validateCompactedDetailed(out, entries.length, structuredOutput);
    if (!check.ok) {
      const preview = (out || JSON.stringify(structuredOutput ?? "")).slice(0, 300).replace(/\s+/g, " ").trim();
      logger.log(
        "warn",
        `[reflection-compact] 校验失败(${check.reason}),保留旧库。len=${out.length} structured=${structuredOutput != null} 预览: ${preview || "(空)"}`
      );
      bus.emit("error.occurred", {
        scope: "reflection-compact",
        err: new Error(`LLM 产出未过安全校验,保留旧库:${check.reason}`),
      });
      return;
    }
    const faqs = check.faqs;

    const withVec: { content: string; embedding: Float32Array }[] = [];
    for (const faq of faqs) withVec.push({ content: faq, embedding: await d.embed(faq) });
    // 传 before/after 文本快照 → 事务内记入 reflect_compactions,供 web「整理记录」追溯差异
    d.repo.replaceReflectionEntries(
      entries.map((e) => e.id),
      withVec,
      d.now(),
      entries.map((e) => e.content),
      faqs
    );

    if (d.notifyAdmin) {
      bus.emit("action.send", {
        action: "send_group_msg",
        groupId: d.adminGroupId,
        text: `反思整理:${entries.length} → ${faqs.length} 条`,
      });
    }
  } catch (err) {
    bus.emit("error.occurred", { scope: "reflection-compact", err });
  }
}

// 监听式装配:扫描式定时压缩 + 持久游标,返回 teardown。旁路观察者,失败不阻断主链路。
// 修复:旧版纯 setInterval(24h) 无首刷、无持久化,pm2 重启/热重载每次清零倒计时 → 整理永不触发。
// 新版按 config 持久游标 reflect_compact_at 判到期,重启后仍能补跑;并在装配后延迟首刷一次。
export function registerReflectionCompactor(deps: ReflectionCompactorDeps): () => void {
  const compactMs = deps.compactMs ?? 86_400_000;
  const scanMs = deps.scanMs ?? Math.min(compactMs, 3_600_000);
  const now = deps.now ?? (() => Date.now());
  const repo = deps.repo;
  let running = false; // 防重入:上一轮未结束则跳过本次触发
  const tick = () => {
    if (running) return;
    if (now() - repo.compactAt() < compactMs) return; // 未到期
    running = true;
    logger.log("info", "[reflection-compact] due, running");
    void runCompact(deps)
      .catch((err) => bus.emit("error.occurred", { scope: "reflection-compact", err }))
      .finally(() => {
        // 无论成败推进游标:到期即消费一个周期,失败下周期重试,避免每 scanMs 反复打 LLM
        repo.setCompactAt(now());
        running = false;
      });
  };
  const timer = setInterval(tick, scanMs);
  const kick = setTimeout(tick, deps.firstDelayMs ?? 30_000); // leading-edge:装配后先检一次
  return () => {
    clearInterval(timer);
    clearTimeout(kick);
  };
}
