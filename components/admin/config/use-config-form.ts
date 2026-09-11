"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useLive } from "@/components/live-provider"
import type { AppConfig as Cfg } from "@/lib/core/config/schema"
import type { ChatRef } from "@/lib/core/chat/types"
import { excludeAdminSurface } from "@/lib/core/config/chats"

type ScalarConfigKey = Exclude<
  {
    [K in keyof Cfg]: NonNullable<Cfg[K]> extends string | number ? K : never
  }[keyof Cfg],
  undefined
>

function qqChatIds(chats: ChatRef[]): number[] {
  return chats
    .filter((c) => c.channel === "qq")
    .map((c) => Number(c.chatId))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function tgChatIds(chats: ChatRef[]): string[] {
  return chats.filter((c) => c.channel === "tg").map((c) => c.chatId)
}

function withQqChats(chats: ChatRef[], ids: number[]): ChatRef[] {
  return [
    ...chats.filter((c) => c.channel !== "qq"),
    ...ids.map((id) => ({ channel: "qq" as const, chatId: String(id) })),
  ]
}

function withTgChats(chats: ChatRef[], ids: string[]): ChatRef[] {
  return [
    ...chats.filter((c) => c.channel !== "tg"),
    ...ids.map((id) => ({ channel: "tg" as const, chatId: id })),
  ]
}

/** 管理面与生效会话互斥：切换管理面时同步剔除白名单里的同一 chat */
function withoutAdminChat(chats: ChatRef[], admin: ChatRef | null): ChatRef[] {
  if (!admin) return chats
  const id = admin.chatId.trim()
  if (!id) return chats
  return excludeAdminSurface(chats, { ...admin, chatId: id })
}

function adminQqId(surface: ChatRef | null | undefined): number {
  if (surface?.channel === "qq") {
    const n = Number(surface.chatId)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return 0
}

interface AdminCandidate {
  userId: number
  name: string
  role: "owner" | "admin"
  groupIds: number[]
}

/** 配置页的取数和保存边界；区块组件只编辑同一份草稿。 */
export function useConfigForm() {
  const { status } = useLive()
  const [cfg, setCfg] = useState<Cfg | null>(null)
  /** 上次保存(或加载)时的配置快照,用来判断有没有未保存改动 */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [groups, setGroups] = useState<
    { groupId: number; groupName: string }[] | null
  >(null)
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [admins, setAdmins] = useState<AdminCandidate[] | null>(null)
  const [adminsLoading, setAdminsLoading] = useState(false)
  /** 待加入的 TG chat id 草稿（点添加 / 保存时合并） */
  const [tgChatDraft, setTgChatDraft] = useState("")
  /** chatId 字符串 → 显示名（/api/chats/names，含 TG 负 id） */
  const [chatNames, setChatNames] = useState<Record<string, string>>({})

  const [error, setError] = useState<string | null>(null)
  const [loadVersion, setLoadVersion] = useState(0)
  const reload = () => setLoadVersion((version) => version + 1)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/config", { signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) throw new Error(result.error ?? "配置加载失败")
        setCfg(result.data as Cfg)
        setSavedSnapshot(JSON.stringify(result.data))
        setError(null)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : "配置加载失败")
        }
      })
    return () => controller.abort()
  }, [loadVersion])

  useEffect(() => {
    fetch("/api/onebot/groups")
      .then((x) => x.json())
      .then((r) => setGroups(r.ok ? r.data : null))
      .catch(() => setGroups(null))
      .finally(() => setGroupsLoading(false))
  }, [])

  // 多通道会话显示名（TG 负 id 以 Number 映射）
  useEffect(() => {
    fetch("/api/chats/names")
      .then((x) => x.json())
      .then((r) => {
        if (!r.ok || !Array.isArray(r.data)) return
        const map: Record<string, string> = {}
        for (const row of r.data as { groupId: number; groupName: string }[]) {
          map[String(row.groupId)] = row.groupName
        }
        setChatNames(map)
      })
      .catch(() => {
        /* 名称仅展示用，失败静默 */
      })
  }, [])

  // QQ 生效群变化后重拉跨群管理员名单(去重)。服务端 name-cache(含 role)命中时几乎瞬时。
  const enabledQq = cfg ? qqChatIds(cfg.enabledChats) : []
  const enabledKey = enabledQq
    .slice()
    .sort((a, b) => a - b)
    .join(",")
  // 渲染期调整 loading/清空,避免在 effect 同步路径里 setState
  const [prevEnabledKey, setPrevEnabledKey] = useState(enabledKey)
  if (prevEnabledKey !== enabledKey) {
    setPrevEnabledKey(enabledKey)
    if (enabledKey) {
      setAdminsLoading(true)
    } else {
      setAdmins([])
      setAdminsLoading(false)
    }
  }
  useEffect(() => {
    if (!enabledKey) return
    let cancelled = false
    fetch(`/api/onebot/admins?groups=${encodeURIComponent(enabledKey)}`)
      .then((x) => x.json())
      .then((r) => {
        if (cancelled) return
        setAdmins(r.ok ? (r.data as AdminCandidate[]) : null)
      })
      .catch(() => {
        if (!cancelled) setAdmins(null)
      })
      .finally(() => {
        if (!cancelled) setAdminsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // 仅随 QQ 生效群集合变化刷新;cfg 本体其它字段不触发
  }, [enabledKey])

  function updateField(k: ScalarConfigKey, v: string) {
    if (!cfg) return
    setCfg({ ...cfg, [k]: typeof cfg[k] === "number" ? Number(v) : v })
  }

  /** 从草稿/批量文本拆出 chat id（字符串原样，禁止 Number） */
  function parseChatIdParts(text: string): string[] {
    return text
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  function mergeTgChats(base: string[], ...extraTexts: string[]): string[] {
    const set = new Set((base ?? []).map(String))
    for (const t of extraTexts) {
      for (const id of parseChatIdParts(t)) set.add(id)
    }
    return Array.from(set)
  }

  async function save() {
    if (!cfg) return
    // 管理面校验：已选通道则 chatId 必填
    if (cfg.adminSurface && !cfg.adminSurface.chatId.trim()) {
      toast.error("管理面已选通道但未填会话")
      return
    }
    // TG 管理面但 token 真正为空（非掩码）时仅警告，仍允许保存
    if (
      cfg.adminSurface?.channel === "tg" &&
      !(cfg.telegramBotToken ?? "").includes("•") &&
      !(cfg.telegramBotToken ?? "").trim()
    ) {
      toast.message("管理面为 TG 但未配置 Bot Token，通知可能发送失败")
    }
    setBusy(true)
    // 保存前把输入框未点「添加」的内容一并写入
    const tgIds = mergeTgChats(tgChatIds(cfg.enabledChats), tgChatDraft)
    const enabledChats = withTgChats(cfg.enabledChats, tgIds)
    const payload: Partial<Cfg> = {
      ...cfg,
      enabledChats,
      // chatId 去空白，避免 isAdminSurface 精确匹配失败
      adminSurface: cfg.adminSurface
        ? {
            channel: cfg.adminSurface.channel,
            chatId: cfg.adminSurface.chatId.trim(),
          }
        : null,
    }
    if (
      typeof payload.onebotAccessToken === "string" &&
      payload.onebotAccessToken.includes("•")
    ) {
      delete payload.onebotAccessToken
    }
    if (
      typeof payload.telegramBotToken === "string" &&
      payload.telegramBotToken.includes("•")
    ) {
      delete payload.telegramBotToken
    }
    try {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then((x) => x.json())
      if (r.ok) {
        const data = r.data as Cfg
        const saved = Array.isArray(data.enabledChats)
          ? data.enabledChats
          : enabledChats
        const savedTg = tgChatIds(saved)
        setCfg(data)
        setSavedSnapshot(JSON.stringify(data))
        setTgChatDraft("")
        if (savedTg.length === 0 && !cfg.telegramBotToken) {
          toast.success("配置已保存并生效")
        } else if (savedTg.length === 0) {
          toast.success("配置已保存（TG 生效 Chat 仍为空，@bot 不会应答）")
        } else {
          toast.success(`配置已保存并生效（TG ${savedTg.length} 个 chat）`)
        }
      } else {
        toast.error(`保存失败:${r.error}`)
      }
    } catch (e) {
      toast.error(`保存失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  function addTgChat() {
    if (!cfg) return
    const id = tgChatDraft.trim()
    if (!id) return
    // 管理面同一 chat 不能当生效会话
    if (
      cfg.adminSurface?.channel === "tg" &&
      cfg.adminSurface.chatId.trim() === id
    ) {
      toast.message("管理面会话不能设为生效会话", {
        description: "该会话只处理 !reset / !resume 管理命令。",
      })
      setTgChatDraft("")
      return
    }
    // 禁止 Number 化：超级群 id 常为负大整数，字符串原样保留
    const next = mergeTgChats(tgChatIds(cfg.enabledChats), id)
    setCfg({ ...cfg, enabledChats: withTgChats(cfg.enabledChats, next) })
    setTgChatDraft("")
  }

  function removeTgChat(id: string) {
    if (!cfg) return
    const next = tgChatIds(cfg.enabledChats).filter((c) => c !== id)
    setCfg({ ...cfg, enabledChats: withTgChats(cfg.enabledChats, next) })
  }

  const fieldValue = (k: ScalarConfigKey) => (cfg ? String(cfg[k] ?? "") : "")

  function toggleGroup(id: number) {
    if (!cfg) return
    // 管理群只负责管理命令,不能同时当生效会话
    if (adminQqId(cfg.adminSurface) === id) {
      toast.message("管理群不能设为生效群", {
        description: "该群只处理 !reset / !resume 管理命令,不参与客服问答。",
      })
      return
    }
    const set = new Set(qqChatIds(cfg.enabledChats))
    if (set.has(id)) set.delete(id)
    else set.add(id)
    setCfg({
      ...cfg,
      enabledChats: withQqChats(cfg.enabledChats, Array.from(set)),
    })
  }

  /** 管理面通道：none → null；qq/tg → { channel, chatId }（chatId 可暂空） */
  function setAdminChannel(channel: "none" | "qq" | "tg") {
    if (!cfg) return
    if (channel === "none") {
      setCfg({ ...cfg, adminSurface: null })
      return
    }
    const prev = cfg.adminSurface
    const next: ChatRef = {
      channel,
      chatId: prev?.channel === channel ? prev.chatId : "",
    }
    setCfg({
      ...cfg,
      adminSurface: next,
      enabledChats: withoutAdminChat(cfg.enabledChats, next),
    })
  }

  function setAdminChatId(chatId: string) {
    if (!cfg || !cfg.adminSurface) return
    const next: ChatRef = { ...cfg.adminSurface, chatId }
    setCfg({
      ...cfg,
      adminSurface: next,
      enabledChats: withoutAdminChat(cfg.enabledChats, next),
    })
  }

  function toggleExtraAt(qq: number) {
    if (!cfg) return
    const set = new Set(cfg.extraAtQQs)
    if (set.has(qq)) set.delete(qq)
    else set.add(qq)
    setCfg({ ...cfg, extraAtQQs: Array.from(set) })
  }

  const groupName = (id: number) =>
    groups?.find((g) => g.groupId === id)?.groupName ?? String(id)
  const adminLabel = (qq: number) => {
    const a = admins?.find((x) => x.userId === qq)
    if (a) return `${a.name} (${qq})`
    return String(qq)
  }
  const adminQq = adminQqId(cfg?.adminSurface)
  const adminGroupOptions = (): { groupId: number; groupName: string }[] => {
    if (!groups) return []
    if (adminQq && !groups.some((g) => g.groupId === adminQq)) {
      return [{ groupId: adminQq, groupName: String(adminQq) }, ...groups]
    }
    return groups
  }
  /** TG 管理面：生效列表 + 当前 chatId 不在列表时注入占位 */
  const adminTgOptions = (): string[] => {
    const ids = cfg ? tgChatIds(cfg.enabledChats) : []
    const cur =
      cfg?.adminSurface?.channel === "tg" ? cfg.adminSurface.chatId.trim() : ""
    if (cur && !ids.includes(cur)) return [cur, ...ids]
    return ids
  }
  const enabledQqIds = cfg ? qqChatIds(cfg.enabledChats) : []
  const enabledTgIds = cfg ? tgChatIds(cfg.enabledChats) : []

  const tgChannel = useMemo(
    () => status?.channels?.find((c) => c.id === "tg"),
    [status?.channels]
  )
  const tgTokenConfigured =
    !!cfg &&
    ((cfg.telegramBotToken ?? "").includes("•") ||
      !!(cfg.telegramBotToken ?? "").trim())
  const tgBypassWarn = !!(
    tgChannel?.detail && /bypass-off|privacy/i.test(tgChannel.detail)
  )
  const tgChatTitle = (id: string) => {
    const n = chatNames[id] ?? chatNames[String(Number(id))]
    if (n && n !== id && n !== String(Number(id))) return n
    return null
  }

  const dirty = Boolean(
    cfg && savedSnapshot && JSON.stringify(cfg) !== savedSnapshot
  )

  return {
    cfg,
    dirty,
    setCfg,
    updateField,
    fieldValue,
    groups,
    groupsLoading,
    admins,
    adminsLoading,
    enabledQqIds,
    enabledTgIds,
    adminQq,
    toggleGroup,
    adminLabel,
    toggleExtraAt,
    groupName,
    tgChatDraft,
    setTgChatDraft,
    addTgChat,
    removeTgChat,
    tgTokenConfigured,
    tgBypassWarn,
    tgChannel,
    tgChatTitle,
    setAdminChannel,
    setAdminChatId,
    adminGroupOptions,
    adminTgOptions,
    busy,
    save,
    error,
    reload,
  }
}

export type ConfigForm = Omit<ReturnType<typeof useConfigForm>, "cfg"> & {
  cfg: Cfg
}
