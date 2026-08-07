import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * 媒体查询属于 React 之外的状态源，用 useSyncExternalStore 订阅，
 * 而不是 useEffect + setState —— 后者会多触发一次渲染，
 * 且在并发渲染下可能读到撕裂的值。
 */
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // 服务端没有 window，一律按桌面渲染，客户端接管后再校正。
    () => false,
  )
}
