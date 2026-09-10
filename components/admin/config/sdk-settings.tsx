"use client"

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/admin/section-card"

import type { ConfigForm } from "./use-config-form"

export function SdkSettings({
  cfg,
  updateField,
}: Pick<ConfigForm, "cfg" | "updateField"> ) {
  return (
    <SectionCard
      title="Claude Agent SDK"
      description="模型与 API 密钥请直接编辑配置目录下的 settings.json，本页仅管理配置路径。"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="claudeConfigDir">CLAUDE_CONFIG_DIR</FieldLabel>
          <Input
            id="claudeConfigDir"
            value={cfg.claudeConfigDir}
            placeholder="./data/claude-config"
            onChange={(e) => updateField("claudeConfigDir", e.target.value)}
          />
        </Field>
      </FieldGroup>
    </SectionCard>
  )
}
