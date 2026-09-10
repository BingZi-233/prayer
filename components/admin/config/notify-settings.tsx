"use client"

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { SectionCard } from "@/components/admin/section-card"

import type { ConfigForm } from "./use-config-form"

export function NotifySettings({
  cfg,
  setCfg,
}: Pick<ConfigForm, "cfg" | "setCfg"> ) {
  return (
    <SectionCard title="通知" description="向管理面推送的运行通知。">
      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox
            id="reflectNotifyAdmin"
            checked={cfg.reflectNotifyAdmin}
            onCheckedChange={(v) =>
              setCfg({ ...cfg, reflectNotifyAdmin: v === true })
            }
          />
          <FieldLabel htmlFor="reflectNotifyAdmin">反思通知管理面</FieldLabel>
        </Field>
      </FieldGroup>
    </SectionCard>
  )
}
