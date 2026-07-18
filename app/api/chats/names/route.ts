import { NextResponse } from "next/server"
import { Bot } from "grammy"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { getRuntime } from "@/lib/runtime"
import { getNameCache, type GroupNameRow } from "@/lib/name-cache"
import { ok } from "@/lib/api"

/**
 * 多通道群/会话显示名。
 * - QQ: 复用 name-cache 群列表(OneBot get_group_list)
 * - TG: 入站 chat.title 缓存 + 白名单 miss 时 getChat
 *
 * 返回形态与 /api/onebot/groups 兼容({ groupId, groupName }),
 * groupId 为 Number(chatId):QQ 正、TG 负。
 */
export async function GET(): Promise<NextResponse> {
  const cache = getNameCache()
  const cfg = getConfig(
    new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db"))
  )
  const byId = new Map<number, string>()

  // 1) 已缓存的单会话名(含 TG 消息侧写入)
  for (const r of cache.listCachedChatNames()) {
    const id = Number(r.chatId)
    if (!Number.isFinite(id)) continue
    byId.set(id, r.chatName)
  }

  // 2) QQ 整包列表(有则覆盖/补全)
  let qqList = cache.getGroupsList()
  if (!qqList) {
    const raw = await getRuntime().getGroups()
    if (Array.isArray(raw)) {
      qqList = raw
        .map((g) => {
          const o = g as { group_id?: unknown; group_name?: unknown }
          const groupId = Number(o.group_id)
          return {
            groupId,
            groupName: String(o.group_name ?? groupId),
          }
        })
        .filter((g) => Number.isFinite(g.groupId) && g.groupId > 0)
      cache.setGroupsList(qqList)
    }
  }
  if (qqList) {
    for (const g of qqList) byId.set(g.groupId, g.groupName)
  }

  // 3) TG 白名单:缓存 miss 则 getChat
  for (const c of cfg.enabledChats) {
    if (c.channel !== "tg") continue
    const chatId = c.chatId
    const id = Number(chatId)
    if (!Number.isFinite(id)) continue
    const existing = byId.get(id)
    // 已有真人名(非裸 id 回退)则跳过
    if (existing && existing !== chatId && existing !== String(id)) continue
    const title = await resolveTgTitle(chatId, cache, cfg.telegramBotToken)
    byId.set(id, title ?? chatId)
  }

  const rows: GroupNameRow[] = [...byId.entries()]
    .map(([groupId, groupName]) => ({ groupId, groupName }))
    .sort((a, b) => a.groupId - b.groupId)

  return NextResponse.json(ok(rows))
}

async function resolveTgTitle(
  chatId: string,
  cache: ReturnType<typeof getNameCache>,
  token: string | undefined
): Promise<string | undefined> {
  const hit = cache.getChatName("tg", chatId)
  if (hit) return hit

  const ch = getRuntime().getChannel("tg")
  if (ch?.resolveChatTitle) {
    const t = await ch.resolveChatTitle(chatId)
    if (t) return t
  }

  // 通道实例过旧(HMR 未 reconfigure)时直连 Bot API
  const tok = token?.trim()
  if (!tok) return undefined
  try {
    const bot = new Bot(tok)
    const c = await bot.api.getChat(chatId)
    const title = "title" in c && c.title ? String(c.title).trim() : ""
    if (title) {
      cache.setChatName("tg", chatId, title)
      return title
    }
  } catch {
    /* getChat 失败则回退裸 id */
  }
  return undefined
}
