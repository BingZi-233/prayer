/**
 * 兼容 re-export：OneBot 传输层已迁至 lib/channels/qq/client。
 * 既有 import `@/lib/onebot/client` 与测试路径保持可用。
 */
export { OneBotClient } from "../channels/qq/client"
