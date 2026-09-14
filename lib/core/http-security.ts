/** Shared request-boundary guards for the admin HTTP surface. */

/** Keep JSON/admin mutations bounded before a parser or schema sees them. */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024

/** Sentinel returned by readJsonBody when the bounded reader rejects a body. */
export const REQUEST_BODY_TOO_LARGE = Symbol("request-body-too-large")

/** Sentinel returned by readEmptyBody when a body is present on a no-body route. */
export const REQUEST_BODY_PRESENT = Symbol("request-body-present")

export type JsonBody = unknown | typeof REQUEST_BODY_TOO_LARGE

export type EmptyBodyResult =
  null | typeof REQUEST_BODY_TOO_LARGE | typeof REQUEST_BODY_PRESENT

/**
 * Check the advertised size without trusting it as the only protection.
 * Multiple/invalid Content-Length values are rejected as malformed input.
 */
export function contentLengthExceeds(
  headers: Headers,
  maxBytes = MAX_REQUEST_BODY_BYTES
): boolean {
  const raw = headers.get("content-length")
  if (raw == null) return false
  if (!/^\d+$/.test(raw.trim())) return true
  const length = Number(raw)
  return !Number.isSafeInteger(length) || length > maxBytes
}

/**
 * Parse JSON through a bounded stream. This also covers chunked requests that
 * do not provide Content-Length; no route is allowed to buffer an unbounded
 * body before its schema runs.
 */
export async function readJsonBody(
  request: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES
): Promise<JsonBody> {
  if (contentLengthExceeds(request.headers, maxBytes))
    return REQUEST_BODY_TOO_LARGE

  // Next's proxyClientMaxBodySize may terminate a chunked stream exactly at
  // the configured boundary.  A truncated prefix can still be valid JSON, so
  // treat an unadvertised body that reaches the boundary as oversized rather
  // than accepting data we cannot prove was complete.
  const hasAdvertisedLength = request.headers.get("content-length") != null

  if (!request.body) return null

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    reader = request.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes || (!hasAdvertisedLength && total >= maxBytes)) {
        try {
          await reader.cancel()
        } catch {
          // The request is already over the limit; cancellation is best effort.
        }
        return REQUEST_BODY_TOO_LARGE
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader?.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/**
 * Verify that a mutation which has no payload really has no payload.
 *
 * `proxyClientMaxBodySize` only exposes a bounded clone to the route and does
 * not itself fail an oversized request.  Reading just the first non-empty
 * chunk keeps no-body endpoints from accepting a truncated chunked request,
 * without buffering an attacker-controlled stream.
 */
export async function readEmptyBody(
  request: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES
): Promise<EmptyBodyResult> {
  const rawLength = request.headers.get("content-length")
  if (contentLengthExceeds(request.headers, maxBytes))
    return REQUEST_BODY_TOO_LARGE

  // A valid non-zero Content-Length is enough to prove a body exists. Do not
  // wait for or buffer the stream; the route will reject it immediately.
  if (rawLength != null && Number(rawLength.trim()) > 0)
    return REQUEST_BODY_PRESENT
  if (!request.body) return null

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = request.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) return null
      if (!value || value.byteLength === 0) continue
      try {
        await reader.cancel()
      } catch {
        // Cancellation is best effort; the route still rejects the request.
      }
      return value.byteLength > maxBytes
        ? REQUEST_BODY_TOO_LARGE
        : REQUEST_BODY_PRESENT
    }
  } catch {
    // A stream which cannot be proven empty must not reach a side effect.
    return REQUEST_BODY_PRESENT
  } finally {
    reader?.releaseLock()
  }
}

/** Map a no-body guard result to one stable API error/status pair. */
export function emptyBodyFailure(
  result: EmptyBodyResult
): { status: 400 | 413; message: string } | null {
  if (result === null) return null
  return result === REQUEST_BODY_TOO_LARGE
    ? { status: 413, message: "请求体过大" }
    : { status: 400, message: "该接口不接受请求体" }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase())
}

/**
 * Cookie-authenticated mutations must carry a same-origin Origin or Referer.
 * Header-token clients are handled separately by proxy.ts, so this deliberately
 * stays strict for browser cookies while not imposing CORS policy on GETs.
 */
export function isSameOriginRequest(
  request: Pick<Request, "url" | "headers">,
  expectedOrigin?: string
): boolean {
  const expected = expectedOrigin ?? originFor(request.url)
  if (!expected) return false
  const origin = request.headers.get("origin")?.trim()
  if (origin) return originFor(origin) === expected

  const referer = request.headers.get("referer")?.trim()
  if (!referer) return false
  try {
    return new URL(referer).origin === expected
  } catch {
    return false
  }
}

function originFor(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}
