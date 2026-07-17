import {
  classifyError,
  CATEGORY_LABELS,
  type LogCategory,
  type ClassifiedError,
} from "./log-classify";
import type { ChannelId } from "./channels/types";

export type { LogCategory };
export type LogLevel = "info" | "warn" | "error";

/** 结构化日志条目(ring buffer + 管理后台) */
export interface LogEntry {
  ts: number;
  lastTs: number;
  level: LogLevel;
  /** 列表默认展示的人话摘要 */
  msg: string;
  scope?: string;
  category?: LogCategory;
  code?: string;
  title?: string;
  hint?: string;
  retryable?: boolean;
  /** 通道 + 会话 id（chat-ref）；新写入优先 */
  channel?: ChannelId;
  chatId?: string;
  /**
   * @deprecated 用 channel+chatId；仅旧 ring / 回读兼容
   */
  groupId?: number;
  sessionKey?: string;
  raw?: string;
  count?: number;
  fingerprint?: string;
}

/** @deprecated 用 LogEntry;保留别名兼容旧 import */
export type LogLine = LogEntry;

export interface LogMeta {
  scope?: string;
  channel?: ChannelId;
  chatId?: string;
  /** @deprecated 用 channel+chatId */
  groupId?: number;
  sessionKey?: string;
  raw?: string;
  code?: string;
  category?: LogCategory;
  title?: string;
  hint?: string;
  retryable?: boolean;
  /** 跳过自动 classify(已有完整字段时) */
  skipClassify?: boolean;
}

const MAX = 500;
/** 去重时在 ring 内向后扫描的最大条数 */
const DEDUP_SCAN = 80;
/** 合并后再次写 stdout 的 count 步长(首次必写;之后每 N 次汇总一行) */
const STDOUT_DEDUP_EVERY = 10;

/** 会话标识：优先 channel:chatId，回退旧 groupId */
function chatIdentity(
  e: Pick<LogEntry, "channel" | "chatId" | "groupId">
): string {
  if (e.channel && e.chatId) return `${e.channel}:${e.chatId}`;
  if (e.groupId != null) return `qq:${e.groupId}`;
  return "";
}

function fingerprintOf(
  e: Pick<
    LogEntry,
    | "level"
    | "code"
    | "scope"
    | "channel"
    | "chatId"
    | "groupId"
    | "sessionKey"
    | "msg"
    | "raw"
  >
): string {
  const chat = chatIdentity(e);
  if (e.code && e.code !== "unknown") {
    return [e.level, e.code, e.scope ?? "", chat, e.sessionKey ?? ""].join("|");
  }
  // unknown / 无稳定 code:用 raw 或 msg 前缀,避免不同根因被合成一条「未分类错误」
  const body = (e.raw ?? e.msg).split("\n")[0].slice(0, 80);
  return [e.level, e.scope ?? "", chat, e.sessionKey ?? "", body].join("|");
}

/** 供单测/导出:格式化一行 stdout */
export function consoleLine(e: LogEntry): string {
  const bits: string[] = [];
  if (e.scope) bits.push(`[${e.scope}]`);
  const chat = chatIdentity(e);
  if (chat) bits.push(`会话=${chat}`);
  if (e.count && e.count > 1) bits.push(`×${e.count}`);
  if (e.category && e.category !== "unknown") {
    bits.push(`[${CATEGORY_LABELS[e.category] ?? e.category}]`);
  }
  const head = bits.length ? bits.join(" ") + " " : "";
  // 已分类:短标题 + 处置
  if (e.code && e.code !== "unknown" && e.title) {
    return `${head}${e.title}${e.hint ? ` | ${e.hint}` : ""}`;
  }
  // unknown / 未分类:优先 raw 首行,避免只剩「未分类错误」
  const bodySrc =
    e.raw && e.raw !== e.title && e.raw !== "未分类错误" ? e.raw : e.msg || e.raw || "";
  const first = bodySrc.split("\n")[0].slice(0, 300);
  return `${head}${first}`;
}

function shouldWriteStdout(count: number, isNew: boolean): boolean {
  if (isNew) return true;
  // 合并后:每 STDOUT_DEDUP_EVERY 次再打一行汇总(含 ×N)
  return count > 0 && count % STDOUT_DEDUP_EVERY === 0;
}

class RingLogger {
  private buf: LogEntry[] = [];
  /** captureConsole 前保存的原始 console,emit 时写 pm2 不回环 */
  private origConsole: {
    log: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  } | null = null;

  setOrigConsole(c: RingLogger["origConsole"] | null): void {
    this.origConsole = c;
  }

  /** 兼容旧 API:纯字符串日志 */
  log(level: LogLevel, msg: string): void {
    this.emit({ level, msg });
  }

  info(msg: string, meta?: LogMeta): void {
    this.emit({ level: "info", msg, ...meta });
  }

  warn(msg: string, meta?: LogMeta): void {
    this.emit({ level: "warn", msg, ...this.enrich(msg, meta) });
  }

  error(msg: string, meta?: LogMeta): void {
    this.emit({ level: "error", msg, ...this.enrich(msg, meta) });
  }

  /** 写入/去重;返回最终条目(新建或合并后) */
  emit(partial: { level: LogLevel; msg: string } & Partial<LogEntry> & LogMeta): LogEntry {
    const now = Date.now();
    const base: LogEntry = {
      ts: now,
      lastTs: now,
      level: partial.level,
      msg: partial.msg,
      scope: partial.scope,
      category: partial.category,
      code: partial.code,
      title: partial.title,
      hint: partial.hint,
      retryable: partial.retryable,
      channel: partial.channel,
      chatId: partial.chatId,
      groupId: partial.groupId,
      sessionKey: partial.sessionKey,
      raw: partial.raw,
      count: 1,
    };
    // error/warn 且缺 code 时自动分类
    if ((base.level === "error" || base.level === "warn") && !base.code && !partial.skipClassify) {
      const src = base.raw ?? base.msg;
      const c = classifyError(src);
      base.code = c.code;
      base.category = base.category ?? c.category;
      base.title = base.title ?? c.title;
      base.hint = base.hint ?? c.hint;
      base.retryable = base.retryable ?? c.retryable;
      // 始终保留上游原文,便于展开与未知错误展示
      if (!base.raw) base.raw = src;
      // 已分类:列表摘要用 title;unknown 保留原文 msg
      if (base.title && base.msg === src && base.code !== "unknown") base.msg = base.title;
    }
    base.fingerprint = fingerprintOf(base);

    const { entry: merged, isNew } = this.mergeOrPush(base);
    if (shouldWriteStdout(merged.count ?? 1, isNew)) {
      this.writeStdout(merged);
    }
    return merged;
  }

  private enrich(msg: string, meta?: LogMeta): Partial<LogEntry> {
    if (!meta) return {};
    if (meta.skipClassify || meta.code) {
      return { ...meta };
    }
    const src = meta.raw ?? msg;
    const c: ClassifiedError = classifyError(src);
    const title = meta.title ?? c.title;
    return {
      ...meta,
      code: c.code,
      category: meta.category ?? c.category,
      title,
      hint: meta.hint ?? c.hint,
      retryable: meta.retryable ?? c.retryable,
      raw: meta.raw ?? src,
      // unknown 保留原文作摘要
      msg: c.code === "unknown" ? msg : title,
    };
  }

  private mergeOrPush(entry: LogEntry): { entry: LogEntry; isNew: boolean } {
    const fp = entry.fingerprint!;
    const start = Math.max(0, this.buf.length - DEDUP_SCAN);
    for (let i = this.buf.length - 1; i >= start; i--) {
      if (this.buf[i].fingerprint === fp) {
        const cur = this.buf[i];
        cur.count = (cur.count ?? 1) + 1;
        cur.lastTs = entry.lastTs;
        // 保留最新 raw,便于对照上游最新文案
        if (entry.raw) cur.raw = entry.raw;
        if (entry.hint) cur.hint = entry.hint;
        return { entry: cur, isNew: false };
      }
    }
    this.buf.push(entry);
    if (this.buf.length > MAX) this.buf.splice(0, this.buf.length - MAX);
    return { entry, isNew: true };
  }

  private writeStdout(e: LogEntry): void {
    const line = consoleLine(e);
    const o = this.origConsole;
    if (!o) return; // 未 patch 前不写,避免与调用方 console 重复
    if (e.level === "error") o.error(line);
    else if (e.level === "warn") o.warn(line);
    else o.log(line);
  }

  tail(): LogEntry[] {
    return this.buf.map((e) => ({ ...e }));
  }

  clear(): void {
    this.buf = [];
  }
}

const g = globalThis as unknown as { __agentLogger?: RingLogger; __consolePatched?: boolean };
export const logger: RingLogger = g.__agentLogger ?? (g.__agentLogger = new RingLogger());

// 一次性捕获 console 输出到 ring buffer(SDK/agent 的日志也进来)
export function captureConsole(): void {
  if (g.__consolePatched) return;
  g.__consolePatched = true;

  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  logger.setOrigConsole(orig);

  const fmt = (a: unknown): string => {
    if (typeof a === "string") return a;
    if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };

  const wrap = (level: LogLevel) => {
    return (...args: unknown[]) => {
      const msg = args.map(fmt).join(" ");
      // 直接 emit 进 ring;stdout 由 emit→writeStdout 打一次,避免双份
      logger.emit({
        level,
        msg,
        raw: level === "error" || level === "warn" ? msg : undefined,
      });
    };
  };

  console.log = wrap("info");
  console.warn = wrap("warn");
  console.error = wrap("error");
}
