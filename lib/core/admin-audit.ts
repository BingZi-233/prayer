import { randomUUID } from "node:crypto"

/**
 * A record may be created only after proxy authorization. A shared ADMIN_TOKEN
 * does not identify a person, so these values must never be rendered as a user
 * identity or used for authorization.
 */
export const ADMIN_AUDIT_ACTOR_TYPES = [
  "shared-admin-token",
  "development-unprotected",
] as const

export type AdminAuditActorType = (typeof ADMIN_AUDIT_ACTOR_TYPES)[number]

export const ADMIN_AUDIT_COMPLETION_RESULTS = [
  "accepted",
  "rejected",
  "failed",
  "partial",
] as const

export const ADMIN_AUDIT_RESULTS = [
  "started",
  ...ADMIN_AUDIT_COMPLETION_RESULTS,
] as const

export type AdminAuditResult = (typeof ADMIN_AUDIT_RESULTS)[number]
export type CompletedAdminAuditResult =
  (typeof ADMIN_AUDIT_COMPLETION_RESULTS)[number]

export const ADMIN_AUDIT_MUTATION_METHODS = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const

export type AdminAuditMutationMethod =
  (typeof ADMIN_AUDIT_MUTATION_METHODS)[number]

/**
 * Detail deliberately excludes strings, arrays, nested objects, request
 * bodies, headers, and error text. Callers may record only fixed names with
 * bounded counts/flags, never operator- or customer-provided content.
 */
export type AdminAuditDetail = Readonly<Record<string, boolean | number | null>>

export type AdminAuditDescriptor = Readonly<{
  action: string
  route: string
  method: AdminAuditMutationMethod
}>

export type AdminAuditStart = Readonly<
  AdminAuditDescriptor & {
    requestId: string
    actorType: AdminAuditActorType
    startedAt: number
  }
>

export type AdminAuditCompletion = Readonly<{
  result: CompletedAdminAuditResult
  httpStatus: number
  detail?: AdminAuditDetail
  finishedAt: number
}>

const REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACTION_RE = /^[a-z][a-z0-9._-]{0,95}$/
const ROUTE_RE = /^\/api(?:\/[a-z0-9._\-[\]]+)*$/
const DETAIL_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/
const SENSITIVE_DETAIL_KEY_RE =
  /(?:^|_)(?:id|token|secret|password|credential|cookie|header|body|text|content|message|question|answer|error|stack|trace|email|phone|address|user|chat|group|session|request|file|path)(?:_|$)/
const MAX_DETAIL_KEYS = 20
const MAX_DETAIL_BYTES = 1024
const MAX_DETAIL_COUNT = 1_000_000

function includes<T extends readonly string[]>(
  items: T,
  value: unknown
): boolean {
  return (
    typeof value === "string" && (items as readonly string[]).includes(value)
  )
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${label} 必须是非负安全整数`)
}

function assertHttpStatus(value: number): void {
  if (!Number.isInteger(value) || value < 100 || value > 599)
    throw new RangeError("HTTP 状态码必须在 100 到 599 之间")
}

/**
 * Classifies the authorization model after proxy authorization; it does not
 * authenticate a request. The shared token has no durable human identity, and
 * distinguishing header from cookie would be inaccurate when an invalid
 * header accompanies a valid cookie.
 * `sharedTokenConfigured` must use the same truthiness as proxy.ts's
 * `ADMIN_TOKEN` check.
 */
export function adminAuditActorType(
  sharedTokenConfigured: boolean
): AdminAuditActorType {
  return sharedTokenConfigured
    ? "shared-admin-token"
    : "development-unprotected"
}

/** Generates a server-side correlation id; never trust a caller-provided one. */
export function createAdminAuditRequestId(): string {
  return randomUUID()
}

export function isAdminAuditRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_RE.test(value)
}

export function normalizeAdminAuditDetail(detail: unknown): AdminAuditDetail {
  if (detail === undefined) return Object.freeze({})
  if (
    detail === null ||
    typeof detail !== "object" ||
    Array.isArray(detail) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(detail))
  )
    throw new TypeError("管理审计详情必须是普通对象")

  const entries = Object.entries(detail)
  if (entries.length > MAX_DETAIL_KEYS)
    throw new RangeError(`管理审计详情最多 ${MAX_DETAIL_KEYS} 个字段`)

  const normalized: Record<string, boolean | number | null> = {}
  for (const [key, value] of entries) {
    if (!DETAIL_KEY_RE.test(key)) throw new TypeError("管理审计详情字段名非法")
    if (SENSITIVE_DETAIL_KEY_RE.test(key))
      throw new TypeError("管理审计详情不能包含标识符或原始内容字段")
    if (
      value !== null &&
      typeof value !== "boolean" &&
      (typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > MAX_DETAIL_COUNT)
    )
      throw new TypeError("管理审计详情只允许布尔值、有限计数或 null")
    normalized[key] = value
  }
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_DETAIL_BYTES)
    throw new RangeError(`管理审计详情不能超过 ${MAX_DETAIL_BYTES} 字节`)
  return Object.freeze(normalized)
}

export function assertAdminAuditStart(value: AdminAuditStart): void {
  if (!isAdminAuditRequestId(value.requestId))
    throw new TypeError("管理审计 request id 非法")
  if (!includes(ADMIN_AUDIT_ACTOR_TYPES, value.actorType))
    throw new TypeError("管理审计 actor type 非法")
  if (!ACTION_RE.test(value.action)) throw new TypeError("管理审计 action 非法")
  if (!ROUTE_RE.test(value.route)) throw new TypeError("管理审计 route 非法")
  if (!includes(ADMIN_AUDIT_MUTATION_METHODS, value.method))
    throw new TypeError("管理审计 method 非法")
  assertTimestamp(value.startedAt, "管理审计开始时间")
}

export function assertAdminAuditCompletion(value: AdminAuditCompletion): void {
  if (!includes(ADMIN_AUDIT_COMPLETION_RESULTS, value.result))
    throw new TypeError("管理审计完成结果非法")
  assertHttpStatus(value.httpStatus)
  assertTimestamp(value.finishedAt, "管理审计完成时间")
  normalizeAdminAuditDetail(value.detail)
}

/**
 * Constructs a start with a new server-side id. It intentionally accepts no
 * caller-supplied correlation header or id.
 */
export function createAdminAuditStart(
  descriptor: AdminAuditDescriptor,
  startedAt: number,
  sharedTokenConfigured: boolean
): AdminAuditStart {
  const start: AdminAuditStart = {
    ...descriptor,
    requestId: createAdminAuditRequestId(),
    actorType: adminAuditActorType(sharedTokenConfigured),
    startedAt,
  }
  assertAdminAuditStart(start)
  return start
}

/**
 * `accepted` describes the handler's HTTP response only. It deliberately does
 * not claim that filesystem, CLI, runtime, or remote side effects were atomic.
 */
export function createAdminAuditCompletion(
  httpStatus: number,
  finishedAt: number,
  options: Readonly<{ partial?: boolean; detail?: AdminAuditDetail }> = {}
): AdminAuditCompletion {
  assertHttpStatus(httpStatus)
  const result: CompletedAdminAuditResult = options.partial
    ? "partial"
    : httpStatus >= 200 && httpStatus < 300
      ? "accepted"
      : httpStatus >= 400 && httpStatus < 500
        ? "rejected"
        : "failed"
  const completion: AdminAuditCompletion = {
    result,
    httpStatus,
    detail: normalizeAdminAuditDetail(options.detail),
    finishedAt,
  }
  assertAdminAuditCompletion(completion)
  return completion
}
