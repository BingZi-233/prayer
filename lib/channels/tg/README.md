# Telegram Channel

## 部署前置

1. **关闭 Group Privacy Mode**（BotFather → Bot Settings → Group Privacy → Turn off）
   - 开启时 bot 只能收到 @bot 命令与回复 bot 的消息，**收不到普通群聊消息**。
   - 主链路 @ 问答仍可用，但反思 / 主动补位会缺少原料，运行时会对该 chat 降级关闭旁路。
2. Bot 已加入目标超级群；`telegramEnabledChats` 填 **字符串** chat id（可负号，禁止 `Number` 比较）。
3. **单进程 long poll**：与 pm2 fork 单实例一致；多实例同 token 会 409。

## 模块

| 文件               | 职责                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| `parse.ts`         | Update → `IncomingMessage`（group/supergroup；含 forum topic）       |
| `trigger.ts`       | @bot 判定与 UTF-16 剥离 mention                                      |
| `client.ts`        | long poll / sendMessage / enrich 后 emit；offset 在 emit 后推进      |
| `admins-cache.ts`  | `getChatAdministrators` + TTL；creator→owner；失败关旁路             |
| `bypass-state.ts`  | per-chat 旁路开关（poller 读取）；Privacy 启发式                     |
| `media.ts`         | `getFile` + 限额下载（5MB / 15s / image/*）→ base64                  |
| `enrich.ts`        | 填 `senderRole` + 下载图；失败降级不抛                               |

## 旁路降级

- `getChatAdministrators` 失败 → 该 chat `senderRole=member`，`isTgChatBypassEnabled=false`，反思/补位跳过
- Privacy Mode 启发式：连续 ≥20 条仅 bot 可见（@bot / 回复 bot / bot_command）→ 同关闭；见到非 bot 可见消息后解封并重置计数（避免 thrash）
- 主链路 @ 问答始终可用；消息仍缓冲（修复 Privacy 后有原料）
- `ChannelStatus.detail` 形如：`@bot offset=N bypass-off:-1001:admins-failed`
