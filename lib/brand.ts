/**
 * Prayer 的平台品牌与客服身份配置。
 *
 * 品牌是核心运行时的一部分，但具体业务（例如 PackyAPI）应由知识库和
 * 插件提供，而不是写死在客服编排里。默认值放在这里，方便 UI、提示词和
 * 后台状态使用同一份真源。
 */
export const DEFAULT_BRAND = {
  name: "Prayer",
  description: "多渠道 AI 客服中台",
} as const

export type BrandProfile = {
  name: string
  description: string
}

export type BrandInput = Partial<BrandProfile> | null | undefined

/** 从配置/外部输入得到安全、非空的品牌资料。 */
export function resolveBrand(input: BrandInput = {}): BrandProfile {
  const name = input?.name?.trim() || DEFAULT_BRAND.name
  const description = input?.description?.trim() || DEFAULT_BRAND.description
  return { name, description }
}
