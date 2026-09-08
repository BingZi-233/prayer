"use client"

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/admin/section-card"
import { ConfigTabContent } from "./config-tab-content"

import type { ConfigForm } from "./use-config-form"

export function StorageSettings({
  cfg,
  updateField,
  embedded = false,
}: Pick<ConfigForm, "cfg" | "updateField"> & { embedded?: boolean }) {
  return (
    <ConfigTabContent value="storage" embedded={embedded}>
      <SectionCard title="存储" description="数据库文件路径。">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="dbPath">数据库路径</FieldLabel>
            <Input
              id="dbPath"
              value={cfg.dbPath}
              placeholder="./data/agent.db"
              onChange={(e) => updateField("dbPath", e.target.value)}
            />
          </Field>
        </FieldGroup>
      </SectionCard>
    </ConfigTabContent>
  )
}
