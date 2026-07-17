# Telegram Channel

## 部署前置

1. **关闭 Group Privacy Mode**（BotFather → Bot Settings → Group Privacy → Turn off）
   - 开启时 bot 只能收到 @bot 命令与回复 bot 的消息，**收不到普通群聊消息**。
   - 主链路 @ 问答仍可用，但反思 / 主动补位会缺少原料，运行时会对该 chat 降级关闭旁路。
2. Bot 已加入目标超级群；`telegramEnabledChats` 填 **字符串** chat id（可负号，禁止 `Number` 比较）。
3. **单进程 long poll**：与 pm2 fork 单实例一致；多实例同 token 会 409。

## 模块

| 文件                     | 职责                                                      |
| ------------------------ | --------------------------------------------------------- |
| `parse.ts`               | Update → `IncomingMessage`（仅 group/supergroup message） |
| `trigger.ts`             | @bot 判定与 UTF-16 剥离 mention                           |
| `client.ts`              | long poll / sendMessage（Task 10）                        |
| `admins-cache.ts`        | 管理员角色缓存（Phase 2）                                 |
| `media.ts` / `enrich.ts` | 图片下载（Phase 2）                                       |
