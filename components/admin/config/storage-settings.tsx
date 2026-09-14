"use client"

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/admin/section-card"

import type { ConfigForm } from "./use-config-form"

export function StorageSettings({
  cfg,
}: Pick<ConfigForm, "cfg">) {
  return (
    <SectionCard
      title="存储"
      description="数据库路径由部署环境中的 DB_PATH 决定，不能在运行时修改。"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="dbPath">数据库路径</FieldLabel>
          <Input
            id="dbPath"
            value={cfg.dbPath}
            placeholder="./data/agent.db"
            readOnly
            aria-readonly="true"
          />
        </Field>
      </FieldGroup>
    </SectionCard>
  )
}
