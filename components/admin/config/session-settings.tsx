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

import { msToMin, minToMs } from "./form-values"
import type { ConfigForm } from "./use-config-form"

export function SessionSettings({
  cfg,
  setCfg,
  updateField,
  fieldValue,
}: Pick<ConfigForm, "cfg" | "setCfg" | "updateField" | "fieldValue">) {
  return (
    <TabsContent value="session">
      <SectionCard title="会话" description="空闲超时后开启新对话。">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="resumeTtlMin">会话空闲超时(分钟)</FieldLabel>
            <Input
              id="resumeTtlMin"
              inputMode="numeric"
              value={msToMin(cfg.resumeTtlMs)}
              onChange={(e) =>
                setCfg({ ...cfg, resumeTtlMs: minToMs(e.target.value) })
              }
            />
            <FieldDescription>默认 5 分钟。设 0 关闭超时。</FieldDescription>
          </Field>
        </FieldGroup>
      </SectionCard>

      <SectionCard
        title="知识库预检索"
        description="每轮消息进模型前自动检索知识库并把片段拼进提问，不依赖模型自己决定要不要查。"
      >
        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox
              id="kbPrefetchEnabled"
              checked={cfg.kbPrefetchEnabled !== false}
              onCheckedChange={(v) =>
                setCfg({ ...cfg, kbPrefetchEnabled: v === true })
              }
            />
            <FieldLabel htmlFor="kbPrefetchEnabled">开启预检索注入</FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="kbPrefetchTopK">注入片段条数</FieldLabel>
            <Input
              id="kbPrefetchTopK"
              inputMode="numeric"
              value={fieldValue("kbPrefetchTopK")}
              onChange={(e) => updateField("kbPrefetchTopK", e.target.value)}
            />
            <FieldDescription>
              默认 5。调小可压住长会话的上下文增长。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="kbPrefetchMaxDistance">
              相关性距离上限
            </FieldLabel>
            <Input
              id="kbPrefetchMaxDistance"
              inputMode="decimal"
              value={fieldValue("kbPrefetchMaxDistance")}
              onChange={(e) =>
                updateField("kbPrefetchMaxDistance", e.target.value)
              }
            />
            <FieldDescription>
              越大越宽松;向量 L2 距离,1.0 约等于余弦相似度 0.5。默认 1.0。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </SectionCard>
    </TabsContent>
  )
}
