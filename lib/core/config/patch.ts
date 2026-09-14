import { z } from "zod"
import { mergeSecret } from "../settings-writer"
import {
  appConfigBaseSchema,
  groupPolicySchema,
  isSafeGroupPolicyKey,
  isConfigRecord,
  type AppConfig,
  type GroupPolicy,
} from "./schema"

type ConfigShape = typeof appConfigBaseSchema.shape
type PatchShape = {
  [K in keyof ConfigShape]: z.ZodOptional<ReturnType<ConfigShape[K]["unwrap"]>>
}

const groupPoliciesPatchSchema = z.preprocess(
  (value) => {
    // Zod materializes records into ordinary objects; assigning an own
    // `__proto__` key during that step can silently alter the prototype before
    // a post-parse refinement sees it. Inspect the wire object first and turn
    // unsafe records into an unmistakably invalid value.
    if (
      isConfigRecord(value) &&
      Object.keys(value).some((key) => !isSafeGroupPolicyKey(key))
    )
      return null
    return value
  },
  z
    .record(z.string(), groupPolicySchema.nullable())
    .superRefine((record, ctx) => {
      for (const key of Object.keys(record)) {
        if (!isSafeGroupPolicyKey(key))
          ctx.addIssue({ code: "custom", message: "群策略键非法" })
      }
    })
    .optional()
)

// 先去掉 default 再 optional：否则 Zod 会给未提交字段补默认值，局部保存会覆盖旧值。
const patchFields = Object.fromEntries(
  Object.entries(appConfigBaseSchema.shape).map(([key, schema]) => [
    key,
    schema.unwrap().optional(),
  ])
) as PatchShape

export const configPatchSchema = z.object(patchFields).extend({
  /** null 删除该群覆盖；对象整份替换该群策略，其他群保持原样。 */
  groupPolicies: groupPoliciesPatchSchema,
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
    const merged: Record<string, GroupPolicy> = Object.fromEntries(
      Object.entries(current.groupPolicies).filter(([key]) =>
        isSafeGroupPolicyKey(key)
      )
    )
    for (const [key, policy] of Object.entries(groupPolicies)) {
      if (!isSafeGroupPolicyKey(key)) continue
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
