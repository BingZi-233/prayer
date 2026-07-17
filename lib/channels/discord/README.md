# Discord Channel（二期占位）

本期（Phase 0–1）**不实现** Discord 接入。`ChannelId` 预留 `"discord"`，便于 sessionKey / 事件类型扩展，无 runtime 注册、无 client。

## 规划（Phase 2+）

- 实现 `DiscordChannel implements Channel`
- 在 `ChannelRegistry` 按配置注册（token / guild / channel 白名单）
- 映射 Discord message → `IncomingMessage`（`channel: "discord"`，string id）
- `action.send` 仅处理 `channel === "discord"`
- 与 QQ / TG 一样走 gateway → orchestrator；handoff 策略待定

## 不做

- 不要在本目录放可运行 client / poll 代码（避免半成品进生产路径）
- 不要在 `runtime.ts` 无配置时强行 `register`

参考：`docs/superpowers/specs/2026-07-17-channel-plugin-telegram-design.md`、`lib/channels/types.ts`。
