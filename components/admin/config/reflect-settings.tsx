"use client"

import { TabsContent } from "@/components/ui/tabs"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/admin/section-card"

import { msToMin, minToMs, msToHr, hrToMs } from "./form-values"
import type { ConfigForm } from "./use-config-form"

export function ReflectSettings({
  cfg,
  setCfg,
  updateField,
  fieldValue,
}: Pick<ConfigForm, "cfg" | "setCfg" | "updateField" | "fieldValue">) {
  return (
    <TabsContent value="reflect">
      <SectionCard
        title="反思(知识沉淀)"
        description="从人工答复提炼知识。时间单位：分钟 / 小时。"
      >
        <FieldGroup>
          <Field>
            <FieldLabel>扫描间隔(分钟)</FieldLabel>
            <Input
              inputMode="numeric"
              value={msToMin(cfg.reflectScanMs)}
              onChange={(e) =>
                setCfg({ ...cfg, reflectScanMs: minToMs(e.target.value) })
              }
            />
            <FieldDescription>默认 5 分钟。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>回看窗口(分钟)</FieldLabel>
            <Input
              inputMode="numeric"
              value={msToMin(cfg.reflectLookbackMs)}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  reflectLookbackMs: minToMs(e.target.value),
                })
              }
            />
            <FieldDescription>默认 120 分钟(2 小时)。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>静置阈值(分钟)</FieldLabel>
            <Input
              inputMode="numeric"
              value={msToMin(cfg.reflectSettleMs)}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  reflectSettleMs: minToMs(e.target.value),
                })
              }
            />
            <FieldDescription>默认 10 分钟。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="reflectWindowMax">单窗最大消息数</FieldLabel>
            <Input
              id="reflectWindowMax"
              inputMode="numeric"
              value={fieldValue("reflectWindowMax")}
              onChange={(e) => updateField("reflectWindowMax", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>整理周期(小时)</FieldLabel>
            <Input
              inputMode="numeric"
              value={msToHr(cfg.reflectCompactMs)}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  reflectCompactMs: hrToMs(e.target.value),
                })
              }
            />
            <FieldDescription>
              默认 1 小时。设 0 关闭自动整理。超 30 条时自动分批整理。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="reflectCompactMinEntries">
              整理最少条目
            </FieldLabel>
            <Input
              id="reflectCompactMinEntries"
              inputMode="numeric"
              value={fieldValue("reflectCompactMinEntries")}
              onChange={(e) =>
                updateField("reflectCompactMinEntries", e.target.value)
              }
            />
          </Field>
          <Field>
            <FieldLabel>自动升格周期(小时)</FieldLabel>
            <Input
              inputMode="numeric"
              value={msToHr(cfg.reflectPromoteMs)}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  reflectPromoteMs: hrToMs(e.target.value),
                })
              }
            />
            <FieldDescription>
              Agent 评审高质量反思并固化为正式文档。默认 24 小时。设 0 关闭。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="reflectPromoteMinEntries">
              升格最少候选
            </FieldLabel>
            <Input
              id="reflectPromoteMinEntries"
              inputMode="numeric"
              value={fieldValue("reflectPromoteMinEntries")}
              onChange={(e) =>
                updateField("reflectPromoteMinEntries", e.target.value)
              }
            />
            <FieldDescription>
              候选(已入库未升格)达到此数才调 LLM。默认 1。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="reflectPromoteMaxPerRun">
              单轮最多升格
            </FieldLabel>
            <Input
              id="reflectPromoteMaxPerRun"
              inputMode="numeric"
              value={fieldValue("reflectPromoteMaxPerRun")}
              onChange={(e) =>
                updateField("reflectPromoteMaxPerRun", e.target.value)
              }
            />
            <FieldDescription>防止一次升格过多。默认 5。</FieldDescription>
          </Field>
        </FieldGroup>
      </SectionCard>
    </TabsContent>
  )
}
