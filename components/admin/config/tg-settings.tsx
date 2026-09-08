"use client"

import { X, Plus } from "lucide-react"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SectionCard } from "@/components/admin/section-card"
import { ChannelDot } from "@/components/channel-status-lights"
import { ConfigTabContent } from "./config-tab-content"

import type { ConfigForm } from "./use-config-form"

export function TgSettings({
  cfg,
  setCfg,
  enabledTgIds,
  tgChatDraft,
  setTgChatDraft,
  addTgChat,
  removeTgChat,
  tgTokenConfigured,
  tgBypassWarn,
  tgChannel,
  tgChatTitle,
  embedded = false,
}: Pick<
  ConfigForm,
  | "cfg"
  | "setCfg"
  | "enabledTgIds"
  | "tgChatDraft"
  | "setTgChatDraft"
  | "addTgChat"
  | "removeTgChat"
  | "tgTokenConfigured"
  | "tgBypassWarn"
  | "tgChannel"
  | "tgChatTitle"
> & { embedded?: boolean }) {
  return (
    <ConfigTabContent value="tg" embedded={embedded}>
      <SectionCard
        title="TG 通道"
        description="Telegram Bot Token 与群相关参数。"
        action={
          tgChannel ? (
            <ChannelDot ch={tgChannel} />
          ) : !tgTokenConfigured ? (
            <span className="text-xs text-muted-foreground">未配置</span>
          ) : (
            <span className="text-xs text-muted-foreground">状态同步中…</span>
          )
        }
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="telegramBotToken">Bot Token</FieldLabel>
            <Input
              id="telegramBotToken"
              value={cfg.telegramBotToken ?? ""}
              placeholder="留空不修改"
              onChange={(e) =>
                setCfg({ ...cfg, telegramBotToken: e.target.value })
              }
              autoComplete="off"
            />
            <FieldDescription>
              来自
              @BotFather。已保存的密钥以掩码显示,留空或不改动则保留原值。token
              为空则不启动 TG 通道。
            </FieldDescription>
            {tgChannel?.lastError ? (
              <p className="mt-1 text-sm text-destructive">
                通道异常: {tgChannel.lastError}
              </p>
            ) : null}
            {tgBypassWarn ? (
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                旁路已降级(Privacy / bypass 关闭):反思与主动补位可能不可用。请在
                @BotFather 关闭 Group Privacy Mode 并重新拉 bot 进群。
                {tgChannel?.detail ? (
                  <span className="ml-1 font-mono text-xs text-muted-foreground">
                    {tgChannel.detail}
                  </span>
                ) : null}
              </p>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="enabledChatsTg">生效群</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="enabledChatsTg"
                value={tgChatDraft}
                placeholder="Chat ID,如 -1001234567890"
                className="font-mono text-sm"
                onChange={(e) => setTgChatDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addTgChat()
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={addTgChat}
                className="shrink-0"
              >
                <Plus data-icon="inline-start" />
                添加
              </Button>
            </div>
            {enabledTgIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {enabledTgIds.map((id) => {
                  const title = tgChatTitle(id)
                  return (
                    <Badge
                      key={id}
                      variant="secondary"
                      className="cursor-pointer gap-1"
                      onClick={() => removeTgChat(id)}
                    >
                      {title ? `${title} (${id})` : id}
                      <X className="size-3" />
                    </Badge>
                  )
                })}
              </div>
            )}
            <FieldDescription>
              仅这些群里 bot 才会回复。id 按字符串保存(可负号);Enter
              或点添加写入,保存时也会合并未点添加的输入。也可在「生效会话」页一键开关。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </SectionCard>
    </ConfigTabContent>
  )
}
