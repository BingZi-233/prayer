"use client"

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/admin/section-card"

import { msToMin, minToMs } from "./form-values"
import type { ConfigForm } from "./use-config-form"

export function SessionSettings({
  cfg,
  setCfg,
}: Pick<ConfigForm, "cfg" | "setCfg"> & {
}) {
  return (
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
  )
}
