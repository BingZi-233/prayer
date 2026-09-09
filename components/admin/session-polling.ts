type Timer = ReturnType<typeof setTimeout>
type SessionPollerOptions = {
  intervalMs?: number
  isHidden?: () => boolean
  setTimer?: (fn: () => void, ms: number) => Timer
  clearTimer?: (timer: Timer) => void
}

export function commitIfMounted<T>(
  value: T,
  isMounted: () => boolean,
  commit: (value: T) => void
): boolean {
  if (!isMounted()) return false
  commit(value)
  return true
}

export function createInFlightLoader<T>(load: () => T | Promise<T>) {
  let inFlight: Promise<T> | null = null
  return () => {
    if (inFlight) return inFlight
    inFlight = Promise.resolve()
      .then(load)
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }
}

export function createMountedInFlightLoader<T>(
  load: () => T | Promise<T>,
  isMounted: () => boolean,
  commit: (value: T) => void
) {
  const shared = createInFlightLoader(load)
  return () =>
    shared().then((value) => {
      commitIfMounted(value, isMounted, commit)
      return value
    })
}

export async function refreshAfterAction<T>(
  response: { ok: boolean; [key: string]: unknown },
  loadSessions: () => Promise<T>
): Promise<T | null> {
  if (!response.ok) return null
  return loadSessions()
}

type SessionAction = "reset_all" | "reset" | "resume_handoff"
type SessionActionResponse = {
  ok: boolean
  data: { reset?: number }
  error?: string
  [key: string]: unknown
}

export async function postSessionAction<T>(
  action: SessionAction,
  key: string | undefined,
  loadSessions: () => Promise<T>,
  fetcher: (
    input: string,
    init: RequestInit
  ) => Promise<{
    json(): Promise<SessionActionResponse>
  }> = fetch
): Promise<{
  response: SessionActionResponse
  refreshed: T | null
}> {
  const body = key === undefined ? { action } : { action, key }
  const response = await fetcher("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => res.json())
  const refreshed = await refreshAfterAction(response, loadSessions)
  return { response, refreshed }
}

export function createSessionListCoordinator<T>(
  load: () => T | Promise<T>,
  isMounted: () => boolean,
  commit: (value: T) => void,
  options?: SessionPollerOptions,
  afterPoll?: (value: T) => void | Promise<void>
) {
  const loadSessions = createMountedInFlightLoader(load, isMounted, commit)
  const poller = createSessionPoller(async () => {
    const value = await loadSessions()
    if (afterPoll) await afterPoll(value)
  }, options)
  return { loadSessions, poller }
}

export function createSessionPoller(
  load: () => Promise<void>,
  options: SessionPollerOptions = {}
) {
  const intervalMs = options.intervalMs ?? 4000
  const isHidden = options.isHidden ?? (() => document.hidden)
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
  let inFlight: Promise<void> | null = null
  let stopped = false
  let timer: Timer | null = null
  const schedule = () => {
    if (stopped || timer) return
    timer = setTimer(() => {
      timer = null
      void poll().catch(() => {})
    }, intervalMs)
  }
  const poll = () => {
    if (inFlight) return inFlight
    if (stopped) return Promise.resolve()
    if (isHidden()) {
      schedule()
      return Promise.resolve()
    }
    inFlight = load().finally(() => {
      inFlight = null
      schedule()
    })
    return inFlight
  }
  return {
    start() {
      stopped = false
      void poll().catch(() => {})
    },
    poll,
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
    },
  }
}
