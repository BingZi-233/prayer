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

import type { ConfigForm } from "./use-config-form"

/** 平台品牌与客服身份设置；业务事实仍由知识库和插件提供。 */
export function BrandSettings({
  cfg,
  updateField,
}: Pick<ConfigForm, "cfg" | "updateField">) {
  return (
    <TabsContent value="brand">
      <SectionCard
        title="品牌"
        description="设置对外名称与客服身份。保存后会同步到管理后台和 Agent。"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="brandName">品牌名称</FieldLabel>
            <Input
              id="brandName"
              value={cfg.brandName ?? "Prayer"}
              maxLength={80}
              onChange={(e) => updateField("brandName", e.target.value)}
            />
            <FieldDescription>
              默认是 Prayer，也可以填写团队或产品的白标名称。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="brandDescription">品牌简介</FieldLabel>
            <Input
              id="brandDescription"
              value={cfg.brandDescription ?? "多渠道 AI 客服中台"}
              maxLength={500}
              onChange={(e) => updateField("brandDescription", e.target.value)}
            />
            <FieldDescription>
              用一句话说明客服所服务的产品或业务；具体事实仍以知识库和业务插件为准。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </SectionCard>
    </TabsContent>
  )
}
