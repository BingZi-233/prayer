"use client"

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { SectionCard } from "@/components/admin/section-card"

import { msToSec, secToMs } from "./form-values"
import type { ConfigForm } from "./use-config-form"

export function ProactiveSettings({
  cfg,
  setCfg,
  updateField,
  fieldValue,
}: Pick<ConfigForm, "cfg" | "setCfg" | "updateField" | "fieldValue"> & {
}) {
  return (
    <SectionCard
      title="主动回复"
      description="无人应答时谨慎补位。也可在主动回复页一键开关。"
    >
      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox
            id="proactiveEnabled"
            checked={cfg.proactiveEnabled}
            onCheckedChange={(v) =>
              setCfg({ ...cfg, proactiveEnabled: v === true })
            }
          />
          <FieldLabel htmlFor="proactiveEnabled">
            启用主动回复(全局)
          </FieldLabel>
        </Field>
        <Field>
          <FieldLabel>静默阈值(秒)</FieldLabel>
          <Input
            inputMode="numeric"
            value={msToSec(cfg.proactiveSilenceMs)}
            onChange={(e) =>
              setCfg({
                ...cfg,
                proactiveSilenceMs: secToMs(e.target.value),
              })
            }
          />
          <FieldDescription>
            默认 180 秒无人应答才主动补位。需即时补位可填几秒。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>扫描间隔(秒)</FieldLabel>
          <Input
            inputMode="numeric"
            value={msToSec(cfg.proactiveScanMs)}
            onChange={(e) =>
              setCfg({
                ...cfg,
                proactiveScanMs: secToMs(e.target.value),
              })
            }
          />
          <FieldDescription>默认 60 秒,最小 1 秒。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="proactiveMaxPerScan">
            单次最多补位数
          </FieldLabel>
          <Input
            id="proactiveMaxPerScan"
            inputMode="numeric"
            value={fieldValue("proactiveMaxPerScan")}
            onChange={(e) =>
              updateField("proactiveMaxPerScan", e.target.value)
            }
          />
        </Field>
      </FieldGroup>
    </SectionCard>
  )
}
