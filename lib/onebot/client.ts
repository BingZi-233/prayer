import WebSocket from "ws";
import { bus } from "../bus";
import { parseGroupMessage } from "./parse";
import type { ActionSend } from "../events";

export class OneBotClient {
  private ws?: WebSocket;
  private stopped = false;
  private backoff = 1000;
  private readonly onAction = (a: ActionSend) => this.sendAction(a);

  constructor(private url: string, private accessToken?: string) {}

  start(): void {
    this.stopped = false;
    bus.on("action.send", this.onAction);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    bus.off("action.send", this.onAction);
    this.ws?.close();
    this.ws = undefined;
  }

  private connect(): void {
    const headers = this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : undefined;
    const ws = new WebSocket(this.url, { headers });
    this.ws = ws;

    ws.on("open", () => { this.backoff = 1000; });

    ws.on("message", (raw: WebSocket.RawData) => {
      let evt: unknown;
      try { evt = JSON.parse(raw.toString()); } catch { return; }
      const msg = parseGroupMessage(evt);
      if (msg) bus.emit("message.received", msg);
    });

    ws.on("close", () => this.scheduleReconnect());
    ws.on("error", () => ws.close());
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  }

  private sendAction(a: ActionSend): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      action: a.action,
      params: { group_id: a.groupId, message: a.text },
    }));
  }
}
