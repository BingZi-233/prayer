"use client"

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SectionCard } from "@/components/admin/section-card"
import { ConfigTabContent } from "./config-tab-content"

import type { ConfigForm } from "./use-config-form"

export function AdminSettings({
  cfg,
  updateField,
  fieldValue,
  groups,
  groupsLoading,
  adminQq,
  setAdminChannel,
  setAdminChatId,
  adminGroupOptions,
  adminTgOptions,
  embedded = false,
}: Pick<
  ConfigForm,
  | "cfg"
  | "updateField"
  | "fieldValue"
  | "groups"
  | "groupsLoading"
  | "adminQq"
  | "setAdminChannel"
  | "setAdminChatId"
  | "adminGroupOptions"
  | "adminTgOptions"
> & { embedded?: boolean }) {
  return (
    <ConfigTabContent value="admin" embedded={embedded}>
      <SectionCard
        title="管理面"
        description="转人工/反思/用量告警抄送与 !reset / !resume 落点。可与生效白名单无关。"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="adminChannel">通道</FieldLabel>
            <Select
              items={{ none: "无", qq: "QQ", tg: "Telegram" }}
              value={cfg.adminSurface?.channel ?? "none"}
              onValueChange={(v) => {
                if (v !== null) setAdminChannel(v as "none" | "qq" | "tg")
              }}
            >
              <SelectTrigger id="adminChannel">
                <SelectValue placeholder="选择管理面通道" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">无</SelectItem>
                  <SelectItem value="qq">QQ</SelectItem>
                  <SelectItem value="tg">Telegram</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              选择通知与管理命令落点通道；选「无」关闭管理面。
            </FieldDescription>
          </Field>

          {cfg.adminSurface?.channel === "qq" && (
            <Field>
              <FieldLabel htmlFor="adminSurfaceQq">管理群</FieldLabel>
              {groups ? (
                <Select
                  items={Object.fromEntries(
                    adminGroupOptions().map((g) => [
                      String(g.groupId),
                      `${g.groupName} (${g.groupId})`,
                    ])
                  )}
                  value={adminQq ? String(adminQq) : ""}
                  onValueChange={(v) => {
                    if (v !== null) setAdminChatId(v)
                  }}
                >
                  <SelectTrigger id="adminSurfaceQq">
                    <SelectValue placeholder="选择管理群" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {adminGroupOptions().map((g) => (
                        <SelectItem key={g.groupId} value={String(g.groupId)}>
                          {g.groupName} ({g.groupId})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <FieldDescription>
                  {groupsLoading
                    ? "正在获取群列表…"
                    : "bot 未连接,无法获取群列表。请先填写 QQ 通道连接并启动 bot。"}
                </FieldDescription>
              )}
            </Field>
          )}

          {cfg.adminSurface?.channel === "tg" && (
            <Field>
              <FieldLabel htmlFor="adminSurfaceTg">管理 Chat ID</FieldLabel>
              {adminTgOptions().length > 0 && (
                <Select
                  items={Object.fromEntries(
                    adminTgOptions().map((id) => [id, id])
                  )}
                  value={
                    cfg.adminSurface.chatId &&
                    adminTgOptions().includes(cfg.adminSurface.chatId)
                      ? cfg.adminSurface.chatId
                      : ""
                  }
                  onValueChange={(v) => {
                    if (v !== null) setAdminChatId(v)
                  }}
                >
                  <SelectTrigger id="adminSurfaceTgSelect">
                    <SelectValue placeholder="从生效 Chat 中选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {adminTgOptions().map((id) => (
                        <SelectItem key={id} value={id}>
                          {id}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              <Input
                id="adminSurfaceTg"
                className="mt-2 font-mono"
                value={cfg.adminSurface.chatId}
                placeholder="如 -1001234567890（可负号，字符串原样）"
                onChange={(e) => setAdminChatId(e.target.value)}
              />
              <FieldDescription>
                可从已生效 TG Chat 选择，或直接输入任意 chat
                id（不必在白名单内）。
              </FieldDescription>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="handoffTimeoutMin">
              转人工超时(分钟)
            </FieldLabel>
            <Input
              id="handoffTimeoutMin"
              inputMode="numeric"
              value={fieldValue("handoffTimeoutMin")}
              onChange={(e) => updateField("handoffTimeoutMin", e.target.value)}
            />
            <FieldDescription>
              转人工后无人处理超过此时长自动恢复自动答。默认 30 分钟。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </SectionCard>
    </ConfigTabContent>
  )
}
