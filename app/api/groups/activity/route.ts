import { NextResponse } from "next/server"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig, type GroupPolicy } from "@/lib/config-store"
import {
  getGroupPolicy,
  listEnabledChats,
  policyKey,
} from "@/lib/channels/enabled-chats"
import type { ChannelId } from "@/lib/channels/types"
import { ok, fail } from "@/lib/api"
import { buildGroupStatMaps } from "@/lib/reflect-stats"

function chatKey(channel: string, chatId: string): string {
  return `${channel}:${chatId}`
}

// 生效群活动页:生效群 ∪ 有活动群,各群消息量/最近活动/反思游标/沉淀数 + 策略覆盖
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")))
    const repo = new Repo(sharedDb(cfg.dbPath))

    const enabled = listEnabledChats(cfg)
    const enabledSet = new Set(enabled.map((c) => chatKey(c.channel, c.chatId)))
    const { cursors, msg, sed } = buildGroupStatMaps(repo)

    // 含有策略覆盖但尚未产生消息的群也要列出
    // 策略 key 可能是 "qq:100" / "tg:-1" 新格式,或旧库裸群号字符串
    const policyKeys = Object.keys(cfg.groupPolicies ?? {})
    const ids = new Set<string>([
      ...enabledSet,
      ...msg.keys(),
      ...cursors.keys(),
    ])
    for (const k of policyKeys) {
      if (k.includes(":")) {
        ids.add(k)
      } else if (/^\d+$/.test(k)) {
        // 旧裸群号 → qq
        ids.add(chatKey("qq", k))
      }
    }

    const groups = [...ids]
      .map((key) => {
        const i = key.indexOf(":")
        const channel = (i > 0 ? key.slice(0, i) : "qq") as ChannelId
        const chatId = i > 0 ? key.slice(i + 1) : key
        const policy: GroupPolicy =
          getGroupPolicy(cfg, channel, chatId) ?? {}
        const hasOverride = Object.keys(policy).length > 0
        const gid = Number(chatId)
        return {
          channel,
          chatId,
          // 兼容旧前端
          groupId: Number.isFinite(gid) ? gid : 0,
          enabled: enabledSet.has(chatKey(channel, chatId)),
          messageCount: msg.get(key)?.count ?? 0,
          lastTs: msg.get(key)?.lastTs ?? 0,
          cursor: cursors.get(key) ?? 0,
          sedimentedCount: sed.get(key) ?? 0,
          policy,
          hasOverride,
          policyKey: policyKey(channel, chatId),
          // 生效后的解析值(便于列表一眼看)
          effective: {
            proactiveEnabled:
              policy.proactiveEnabled !== undefined
                ? policy.proactiveEnabled
                : cfg.proactiveEnabled,
            proactiveSilenceMs:
              policy.proactiveSilenceMs !== undefined
                ? policy.proactiveSilenceMs
                : cfg.proactiveSilenceMs,
            notifyAdminOnHandoff:
              policy.notifyAdminOnHandoff !== undefined
                ? policy.notifyAdminOnHandoff
                : true,
          },
        }
      })
      .sort(
        (a, b) =>
          b.messageCount - a.messageCount ||
          a.channel.localeCompare(b.channel) ||
          a.chatId.localeCompare(b.chatId)
      )

    return NextResponse.json(
      ok({
        groups,
        globals: {
          proactiveEnabled: cfg.proactiveEnabled,
          proactiveSilenceMs: cfg.proactiveSilenceMs,
          // 全局无此字段,默认 true;按群可关
          notifyAdminOnHandoff: true as const,
        },
      })
    )
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
