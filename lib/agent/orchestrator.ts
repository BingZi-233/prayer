import { bus } from "../bus"
import { logger } from "../logger"
import type { Agent } from "./agent"
import { isNoAnswerText } from "./agent"
import type { SessionStore } from "./session"
import type { QualifiedMessage } from "../events"
import {
  BLOCKED_INTENTS,
  BLOCKED_REPLY,
  INTENT_LABELS,
  type Intent,
  type IntentClassifier,
} from "./intent"

export interface OrchestratorDeps {
  agent: Agent
  store: SessionStore
  // 前置意图门:命中「套取类」滥用则静默丢弃,不进 agent。缺省 → 不设门(向后兼容)
  classify?: IntentClassifier
  /** @ 后先发 ACK。默认 true */
  ackEnabled?: boolean
  ackText?: string
  /**
   * classify 单次超时(ms):意图分类也是无自带超时的 LLM 调用,排在 ACK 后、handle 内。
   * relay 挂起则永久卡死该会话串行链(用户收到 ACK 却永远等不到答案)。超时 fail-open 归 normal。
   * 默认 15s;<=0 关闭。
   */
  classifyTimeoutMs?: number
}

const DEFAULT_ACK = "收到,正在查~"
// 意图分类超时默认值:分类是 maxTurns<=2 的短任务,15s 足够;超过基本是 relay 挂死
const DEFAULT_CLASSIFY_TIMEOUT_MS = 15_000

// classify 竞速超时:超时 fail-open 归 normal(与 intent.ts 自身的 fail-open 一致,滥用漏网可接受)。
// <=0 关闭超时。
async function classifyWithTimeout(
  classify: IntentClassifier,
  probe: string,
  timeoutMs: number
): Promise<Intent> {
  if (timeoutMs <= 0) return classify(probe)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<Intent>((resolve) => {
    timer = setTimeout(() => resolve("normal"), timeoutMs)
  })
  try {
    return await Promise.race([classify(probe), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function registerOrchestrator(deps: OrchestratorDeps): () => void {
  const {
    agent,
    store,
    classify,
    ackEnabled = true,
    ackText = DEFAULT_ACK,
    classifyTimeoutMs = DEFAULT_CLASSIFY_TIMEOUT_MS,
  } = deps
  // 每个 sessionKey 一条 Promise 链,保证串行
  const chains = new Map<string, Promise<void>>()

  async function handle(q: QualifiedMessage): Promise<void> {
    // 入口即触活:处理途中(ACK/classify/agent.run 窗口期)主动补位压制②
    // 即可见 updated_at > questionTs,不把本条 @ 消息当「无人应答」抢答双发。
    store.touch(q.sessionKey)
    if (ackEnabled) {
      bus.emit("reply.ready", {
        channel: q.channel,
        chatId: q.chatId,
        text: ackText,
        replyToId: q.messageId,
      })
      bus.emit("resolution.recorded", {
        kind: "ack",
        sessionKey: q.sessionKey,
        channel: q.channel,
        chatId: q.chatId,
        userId: q.userId,
      })
    }

    if (classify) {
      // 引用/转发正文一并送分类:注入常藏在被引/转发内容里
      const probe = [q.text, q.quoted, q.forwarded].filter(Boolean).join("\n")
      // 超时兜底:classify 挂死则 fail-open 归 normal,不阻塞串行链
      const intent = await classifyWithTimeout(
        classify,
        probe,
        classifyTimeoutMs
      )
      if (BLOCKED_INTENTS.has(intent)) {
        // 拦截:不跑 agent,回模板婉拒。业务审计走 info,不占 error 通道
        logger.info(
          `blocked intent=${intent}(${INTENT_LABELS[intent]}) session=${q.sessionKey}`,
          {
            scope: "intent",
            channel: q.channel,
            chatId: q.chatId,
            sessionKey: q.sessionKey,
          }
        )
        bus.emit("reply.ready", {
          channel: q.channel,
          chatId: q.chatId,
          text: BLOCKED_REPLY,
          replyToId: q.messageId,
        })
        bus.emit("resolution.recorded", {
          kind: "blocked",
          sessionKey: q.sessionKey,
          channel: q.channel,
          chatId: q.chatId,
          userId: q.userId,
          detail: intent,
        })
        return
      }
    }
    const resumeId = store.resumeId(q.sessionKey)
    const result = await agent.run(
      q.text,
      resumeId,
      {
        sessionKey: q.sessionKey,
        channel: q.channel,
        chatId: q.chatId,
        userId: q.userId,
      },
      { images: q.images, quoted: q.quoted, forwarded: q.forwarded }
    )
    // 哨兵泄漏防护:主动模式指令/历史可能诱使主链路也吐出 __NO_ANSWER__。
    // 绝不外发;并丢弃续接,避免连环复读同一污染 transcript。
    if (isNoAnswerText(result.text)) {
      store.forgetResume(q.sessionKey)
      logger.info(`suppressed no-answer sentinel session=${q.sessionKey}`, {
        scope: "orchestrator",
        channel: q.channel,
        chatId: q.chatId,
        sessionKey: q.sessionKey,
      })
      bus.emit("resolution.recorded", {
        kind: "auto",
        sessionKey: q.sessionKey,
        channel: q.channel,
        chatId: q.chatId,
        userId: q.userId,
        detail: "no_answer_suppressed",
      })
      return
    }
    if (result.sessionId) store.remember(q.sessionKey, result.sessionId)
    if (result.text) {
      bus.emit("reply.ready", {
        channel: q.channel,
        chatId: q.chatId,
        text: result.text,
        replyToId: q.messageId,
      })
      bus.emit("resolution.recorded", {
        kind: "auto",
        sessionKey: q.sessionKey,
        channel: q.channel,
        chatId: q.chatId,
        userId: q.userId,
      })
    }
  }

  const onQualified = (q: QualifiedMessage) => {
    const prev = chains.get(q.sessionKey) ?? Promise.resolve()
    const next = prev
      .then(() => handle(q))
      .catch((err) => {
        bus.emit("error.occurred", {
          scope: "orchestrator",
          err,
          sessionKey: q.sessionKey,
          channel: q.channel,
          chatId: q.chatId,
        })
        bus.emit("resolution.recorded", {
          kind: "error",
          sessionKey: q.sessionKey,
          channel: q.channel,
          chatId: q.chatId,
          userId: q.userId,
          detail: err instanceof Error ? err.message : String(err),
        })
      })
    chains.set(q.sessionKey, next)
    // 链尾自清理:跑完且没有后继接上时移除,防止 chains 随历史 sessionKey 无界增长
    next.finally(() => {
      if (chains.get(q.sessionKey) === next) chains.delete(q.sessionKey)
    })
  }

  bus.on("message.qualified", onQualified)
  return () => bus.off("message.qualified", onQualified)
}
