import { z } from "zod"
import { mergeSecret } from "../settings-writer"
import {
  appConfigSchema,
  groupPolicySchema,
  type AppConfig,
  type GroupPolicy,
} from "./schema"

type ConfigShape = typeof appConfigSchema.shape
type PatchShape = {
  [K in keyof ConfigShape]: z.ZodOptional<ReturnType<ConfigShape[K]["unwrap"]>>
}

// 先去掉 default 再 optional：否则 Zod 会给未提交字段补默认值，局部保存会覆盖旧值。
const patchFields = Object.fromEntries(
  Object.entries(appConfigSchema.shape).map(([key, schema]) => [
    key,
    schema.unwrap().optional(),
  ])
) as PatchShape

export const configPatchSchema = z.object(patchFields).extend({
  /** null 删除该群覆盖；对象整份替换该群策略，其他群保持原样。 */
  groupPolicies: z.record(z.string(), groupPolicySchema.nullable()).optional(),
})

export type ConfigPatch = z.output<typeof configPatchSchema>

/** HTTP 更新语义的纯函数；不读库、不重启运行时，也不修改传入对象。 */
export function mergeConfigPatch(
  current: AppConfig,
  patch: ConfigPatch
): Partial<AppConfig> {
  const { groupPolicies, ...fields } = patch
  const next: Partial<AppConfig> = { ...fields }

  for (const key of ["onebotAccessToken", "telegramBotToken"] as const) {
    if (fields[key] !== undefined)
      next[key] = mergeSecret(current[key], fields[key])
  }

  if (groupPolicies !== undefined) {
    const merged: Record<string, GroupPolicy> = { ...current.groupPolicies }
    for (const [key, policy] of Object.entries(groupPolicies)) {
      const clean =
        policy === null
          ? {}
          : Object.fromEntries(
              Object.entries(policy).filter(([, value]) => value !== undefined)
            )
      if (Object.keys(clean).length === 0) delete merged[key]
      else merged[key] = clean
    }
    next.groupPolicies = merged
  }
  return next
}
