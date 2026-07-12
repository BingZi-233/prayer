import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk"
import { bus } from "../bus"
import type { Repo } from "../db/repo"
import { embed as defaultEmbed } from "../tools/embed"
import { noToolQueryOptions, drainQuery } from "./agent"
import { textNearlySame } from "./reflection-poller"

// LLM 每条问题的归类结果:归入已有 topicId / 新建 newTitle / 噪声 noise。
export interface ClassifyItem {
  i: number
  topicId?: number
  newTitle?: string
}

// 从 structured_output(优先)或原始文本中抽出 items 数组。
function rawItems(structured: unknown, rawText: string): unknown[] | null {
  if (structured && typeof structured === "object" && Array.isArray((structured as any).items)) {
    return (structured as any).items
  }
  if (Array.isArray(structured)) return structured
  // 文本兜底:匹配 {"items":[...]} 或裸数组
  const objMatch = rawText.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const v = JSON.parse(objMatch[0])
      if (v && Array.isArray(v.items)) return v.items
    } catch {
      /* fall through */
    }
  }
  const arrMatch = rawText.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      const v = JSON.parse(arrMatch[0])
      if (Array.isArray(v)) return v
    } catch {
      /* noop */
    }
  }
  return null
}

// 解析 + 对齐 + 校验。batchLen=本轮问题条数,existingIds=本轮传入 LLM 的现有主题 id 集。
// 返回对齐后的合法归类项(noise/非法项已剔除);解析失败返回 null(调用方本轮跳过、不推进游标)。
export function classifyItems(
  structured: unknown,
  rawText: string,
  batchLen: number,
  existingIds: Set<number>
): ClassifyItem[] | null {
  const items = rawItems(structured, rawText)
  if (!items) return null
  const seen = new Set<number>()
  const out: ClassifyItem[] = []
  for (const it of items) {
    if (!it || typeof it !== "object") continue
    const rec = it as Record<string, unknown>
    const i = rec.i
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= batchLen) continue
    if (seen.has(i)) continue
    if (rec.noise === true) {
      seen.add(i)
      continue
    }
    if (typeof rec.topicId === "number" && existingIds.has(rec.topicId)) {
      seen.add(i)
      out.push({ i, topicId: rec.topicId })
      continue
    }
    if (typeof rec.newTitle === "string" && rec.newTitle.trim()) {
      seen.add(i)
      out.push({ i, newTitle: rec.newTitle.trim() })
      continue
    }
    // 既非合法 topicId 也无 newTitle(含幻觉 id)→ 丢弃
    seen.add(i)
  }
  return out
}

export interface TopicPollerDeps {
  repo: Repo
  adminGroupId: number
  enabledGroups?: number[]
  scanMs?: number
  settleMs?: number
  windowMax?: number
  topicPromptMax?: number
  embed?: (text: string) => Promise<Float32Array>
  queryFn?: typeof sdkQuery
  now?: () => number
}

interface Resolved {
  repo: Repo
  adminGroupId: number
  enabledGroups: number[]
  settleMs: number
  windowMax: number
  topicPromptMax: number
  embed: (text: string) => Promise<Float32Array>
  queryFn: typeof sdkQuery
  now: () => number
}

const TOPIC_SYSTEM = `你是 API 中转站的客服问题归类助手。用户消息给出:
一、【现有主题】清单,每行 [id] 标题(可能为空)。
二、【待归类问题】清单,每行 [序号] 用户提问原文。
任务:仅对「与本中转站产品相关」的咨询归类,其余一律丢弃。
只记录(归类/建主题)的范围 —— 围绕本中转站使用的咨询:
- 接入配置(base_url / token / 环境变量 / 各类客户端对接)、可用模型与端点。
- 价格、计费规则、分组倍率、充值、额度、退款、封禁、账户事务。
- 经由本站调用时的报错排查、限流、可用性等使用问题。
规则:
- 能归入某个现有主题 → 输出该主题的 id(topicId,必须来自【现有主题】清单)。
- 属上述范围的新问题但无匹配主题 → 输出简洁中文主题标题(newTitle,概括要点,如"退款到账时间")。
- 与本中转站无关的一切 → 标记 noise:true 丢弃,即使本身是有意义的问题
  (如通用编程/技术求助、其他产品或客户端自身的行为讨论、模型厂商动态、时事闲聊、
  寒暄/表情/纯指令/无信息量)。
- 拿不准是否与本产品相关 → 判 noise:true(宁可少记,避免统计被无关话题淹没)。
- 语义相同的多条新问题应共用同一个 newTitle。
只输出 JSON 对象 {"items":[...]},每项含输入序号 i。不要额外文字、不要 Markdown。
形如 {"items":[{"i":0,"topicId":3},{"i":1,"newTitle":"退款到账时间"},{"i":2,"noise":true}]}`

const TOPIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          i: { type: "integer" },
          topicId: { type: "integer" },
          newTitle: { type: "string" },
          noise: { type: "boolean" },
        },
        required: ["i"],
      },
    },
  },
  required: ["items"],
}

function resolve(deps: TopicPollerDeps): Resolved {
  return {
    repo: deps.repo,
    adminGroupId: deps.adminGroupId,
    enabledGroups: deps.enabledGroups ?? [],
    settleMs: deps.settleMs ?? 60_000,
    windowMax: deps.windowMax ?? 50,
    topicPromptMax: deps.topicPromptMax ?? 40,
    embed: deps.embed ?? defaultEmbed,
    queryFn: deps.queryFn ?? sdkQuery,
    now: deps.now ?? (() => Date.now()),
  }
}

async function scanOnce(d: Resolved): Promise<void> {
  const now = d.now()
  const until = now - d.settleMs
  if (until <= 0) return

  for (const groupId of d.enabledGroups) {
    const cursor = d.repo.topicCursor(groupId)
    if (until <= cursor) continue
    try {
      const msgs = d.repo
        .groupMemberMessagesBetween(groupId, cursor, until)
        .filter((m) => m.text.trim())
        .slice(0, d.windowMax)
      if (!msgs.length) {
        // 空窗口也推进游标 → 防止沉默群把 minTopicCursor/prune 卡在 0
        d.repo.setTopicCursor(groupId, until)
        continue
      }
      // 近义归并候选池:取更大集合(本地 textNearlySame 比对无 LLM 成本),
      // 防近义老主题掉出 LLM 提示窗口(top-N)后被重复新建。LLM 提示仍只喂前 N 控 prompt 体积。
      const mergePool = d.repo.questionTopics(500)
      const topics = mergePool.slice(0, d.topicPromptMax)
      const existingIds = new Set(topics.map((t) => t.id))
      const topicBlock =
        topics.length > 0 ? topics.map((t) => `[${t.id}] ${t.title}`).join("\n") : "(无)"
      const qBlock = msgs.map((m, i) => `[${i}] ${m.text}`).join("\n")
      const prompt = `【现有主题】\n${topicBlock}\n\n【待归类问题】\n${qBlock}`

      const { text: out, structuredOutput } = await drainQuery(
        d.queryFn({
          prompt,
          options: noToolQueryOptions({
            systemPrompt: TOPIC_SYSTEM,
            outputFormat: { type: "json_schema", schema: TOPIC_SCHEMA },
            thinking: { type: "disabled" },
            canUseTool: async () => ({ behavior: "deny" as const, message: "归类阶段不使用工具" }),
            maxTurns: 2,
          }) as never,
        }) as AsyncIterable<any>,
        "topic"
      )

      const classified = classifyItems(structuredOutput, out, msgs.length, existingIds)
      if (classified === null) {
        // 解析失败 → 本群不推进,下轮重试(不落库)
        bus.emit("error.occurred", {
          scope: "topic",
          err: new Error("LLM 归类输出解析失败"),
          groupId,
        })
        continue
      }

      // 推进到本批实际取到的最大 created_at。
      // 极端边界:单窗口 >windowMax 且第 windowMax 条与下一条 created_at 同毫秒时,
      // 理论上可能漏一条(下轮 cursor > 其 ts),概率可忽略,不特殊处理。
      const maxTs = msgs[msgs.length - 1].createdAt
      // 原子性:新建主题 + 插 occurrences + 推进游标同事务,全成功才提交。
      // 批内中途抛错 → 整体回滚,游标不动,下轮重跑整批,避免 occurrence 重复计数(无去重)。
      d.repo.transaction(() => {
        for (const c of classified) {
          const m = msgs[c.i]
          if (!m) continue
          let topicId: number
          if (c.topicId != null) {
            topicId = c.topicId
          } else {
            // newTitle:与候选池近义则归并,否则新建(insertQuestionTopic 同名复用)
            const near = mergePool.find((t) => textNearlySame(t.title, c.newTitle!))
            if (near) {
              topicId = near.id
            } else {
              topicId = d.repo.insertQuestionTopic(c.newTitle!, now)
              // 回填候选池:同批后续近义项归并到此,防批内重复新建
              mergePool.push({ id: topicId, title: c.newTitle! })
            }
          }
          d.repo.insertQuestionOccurrence(topicId, groupId, m.userId, m.text, m.createdAt)
          d.repo.touchQuestionTopic(topicId, now)
        }
        d.repo.setTopicCursor(groupId, maxTs)
      })
    } catch (err) {
      bus.emit("error.occurred", { scope: "topic", err, groupId })
    }
  }
}

export async function runScan(deps: TopicPollerDeps): Promise<void> {
  await scanOnce(resolve(deps))
}

export function registerTopicPoller(deps: TopicPollerDeps): () => void {
  const d = resolve(deps)
  const scanMs = deps.scanMs ?? 300_000
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void scanOnce(d)
      .catch((err) => bus.emit("error.occurred", { scope: "topic", err }))
      .finally(() => {
        running = false
      })
  }, scanMs)
  return () => clearInterval(timer)
}
