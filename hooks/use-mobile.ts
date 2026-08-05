import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// useSyncExternalStore:订阅 matchMedia,快照即当前是否移动端;
// SSR/首帧快照按 false(与原 useState(undefined) → !!undefined 行为一致)
export function useIsMobile() {
  return React.useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(MOBILE_QUERY)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false
  )
}
