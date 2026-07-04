import WebSocket from "ws";
import { bus } from "../bus";
import { parseGroupMessage } from "./parse";
import { enrich } from "./enrich";
import type { ActionSend } from "../events";

interface Pending {
  resolve: (v: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class OneBotClient {
  private ws?: WebSocket;
  private stopped = false;
  private backoff = 1000;
  private connected = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly onAction = (a: ActionSend) => this.sendAction(a);
  // echo 请求-响应:get_msg / get_forward_msg 回查内容用
  private pending = new Map<string, Pending>();
  private echoSeq = 0;

  constructor(
    private url: string,
    private accessToken?: string,
    private onStatus?: (connected: boolean) => void
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  start(): void {
    this.stopped = false;
    bus.on("action.send", this.onAction);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    bus.off("action.send", this.onAction);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.setConnected(false);
    this.clearPending();
    this.ws?.close();
    this.ws = undefined;
  }

  private setConnected(v: boolean): void {
    if (this.connected === v) return;
    this.connected = v;
    this.onStatus?.(v);
  }

  private connect(): void {
    if (this.stopped) return; // 拆卸后挂起的重连不再建连
    const headers = this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : undefined;
    const ws = new WebSocket(this.url, { headers });
    this.ws = ws;

    ws.on("open", () => {
      this.backoff = 1000;
      this.setConnected(true);
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      let evt: any;
      try { evt = JSON.parse(raw.toString()); } catch { return; }
      // API 回执:按 echo 匹配挂起请求
      if (evt?.echo && this.pending.has(evt.echo)) {
        const p = this.pending.get(evt.echo)!;
        this.pending.delete(evt.echo);
        clearTimeout(p.timer);
        p.resolve(evt.data);
        return;
      }
      const parsed = parseGroupMessage(evt);
      if (!parsed) return;
      // 富化(回查引用/转发 + 下载图)后再 emit;失败兜底不阻断
      enrich(parsed, { call: (action, params) => this.call(action, params) })
        .then((msg) => bus.emit("message.received", msg))
        .catch((err) => bus.emit("error.occurred", { scope: "onebot.enrich", err }));
    });

    ws.on("close", () => {
      this.setConnected(false);
      this.scheduleReconnect();
    });
    ws.on("error", () => ws.close());
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  }

  private sendAction(a: ActionSend): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      action: a.action,
      params: { group_id: a.groupId, message: a.text },
    }));
  }

  // 发 OneBot API 请求并等回执(echo 关联)。超时/未连接 → resolve undefined(降级不抛)。
  private call(action: string, params: Record<string, unknown>, timeoutMs = 8000): Promise<any> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.resolve(undefined);
    const echo = `req_${++this.echoSeq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        resolve(undefined);
      }, timeoutMs);
      this.pending.set(echo, { resolve, timer });
      this.ws!.send(JSON.stringify({ action, params, echo }));
    });
  }

  private clearPending(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve(undefined);
    }
    this.pending.clear();
  }
}
