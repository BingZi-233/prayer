/**
 * Serialize knowledge-base filesystem/index mutations within this process.
 *
 * The app routes and the ingest CLI can be loaded by different Next/Node
 * module graphs, so the queue lives on globalThis instead of in a module-local
 * singleton. This is intentionally process-local; multi-process deployments
 * still need an external lock or a single writer.
 */
type KbMutationState = { queue: Promise<void> }

const root = globalThis as typeof globalThis & {
  __prayerKbMutationState?: KbMutationState
}

const state =
  root.__prayerKbMutationState ??
  (root.__prayerKbMutationState = { queue: Promise.resolve() })

export function withKbMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = state.queue
  let release!: () => void
  state.queue = new Promise<void>((resolve) => {
    release = resolve
  })
  return previous
    .catch(() => undefined)
    .then(fn)
    .finally(() => release())
}
