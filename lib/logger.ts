export interface LogLine {
  ts: number;
  level: "info" | "warn" | "error";
  msg: string;
}

const MAX = 500;

class RingLogger {
  private buf: LogLine[] = [];

  log(level: LogLine["level"], msg: string): void {
    this.buf.push({ ts: Date.now(), level, msg });
    if (this.buf.length > MAX) this.buf.splice(0, this.buf.length - MAX);
  }

  tail(): LogLine[] {
    return [...this.buf];
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
  const wrap = (level: LogLine["level"], orig: (...a: unknown[]) => void) => {
    return (...args: unknown[]) => {
      logger.log(level, args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      orig(...args);
    };
  };
  console.log = wrap("info", console.log.bind(console));
  console.warn = wrap("warn", console.warn.bind(console));
  console.error = wrap("error", console.error.bind(console));
}
