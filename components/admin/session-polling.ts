type Timer = ReturnType<typeof setTimeout>

export function createInFlightLoader<T>(load: () => Promise<T>) {
  let inFlight: Promise<T> | null = null
  return () => {
    if (inFlight) return inFlight
    inFlight = load().finally(() => {
      inFlight = null
    })
    return inFlight
  }
}

export function createSessionPoller(
  load: () => Promise<void>,
  options: {
    intervalMs?: number
    isHidden?: () => boolean
    setTimer?: (fn: () => void, ms: number) => Timer
    clearTimer?: (timer: Timer) => void
  } = {}
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
      void poll()
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
      void poll()
    },
    poll,
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
    },
  }
}
