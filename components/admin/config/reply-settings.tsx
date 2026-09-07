"use client"

import { TabsContent } from "@/components/ui/tabs"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { SectionCard } from "@/components/admin/section-card"

import type { ConfigForm } from "./use-config-form"

export function ReplySettings({
  cfg,
  setCfg,
  updateField,
  fieldValue,
}: Pick<ConfigForm, "cfg" | "setCfg" | "updateField" | "fieldValue">) {
  return (
    <TabsContent value="reply">
      <SectionCard
        title="回复体验"
        description="收到消息确认、支持链接与长文拆分。"
      >
        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox
              id="ackEnabled"
              checked={cfg.ackEnabled !== false}
              onCheckedChange={(v) =>
                setCfg({ ...cfg, ackEnabled: v === true })
              }
            />
            <FieldLabel htmlFor="ackEnabled">
              @ 后先回「收到,正在查」
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="supportUrl">支持链接(官网)</FieldLabel>
            <Input
              id="supportUrl"
              value={cfg.supportUrl ?? ""}
              onChange={(e) => updateField("supportUrl", e.target.value)}
            />
            <FieldDescription>
              办不了订单/退款时引导此链接;帮助文案也会附带。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="maxReplyChars">单条字数上限</FieldLabel>
            <Input
              id="maxReplyChars"
              inputMode="numeric"
              value={fieldValue("maxReplyChars")}
              onChange={(e) => updateField("maxReplyChars", e.target.value)}
            />
            <FieldDescription>
              超出按标点拆成多条发送。0 = 不拆。默认 900。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="usageBudgetUsd">日用量预算(USD)</FieldLabel>
            <Input
              id="usageBudgetUsd"
              inputMode="decimal"
              value={fieldValue("usageBudgetUsd")}
              onChange={(e) => updateField("usageBudgetUsd", e.target.value)}
            />
            <FieldDescription>
              超过后向管理面告警。0 = 不告警。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </SectionCard>
    </TabsContent>
  )
}
