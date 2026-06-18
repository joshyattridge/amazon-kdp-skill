import { KDP_REQUEST_DELAY_MS } from './config.js'

let lastRequestAt = 0

/** Minimum gap between outbound KDP page loads and API calls (ms). */
export function getKdpRequestDelayMs(): number {
  return KDP_REQUEST_DELAY_MS
}

/**
 * Wait until at least KDP_REQUEST_DELAY_MS has passed since the last KDP request.
 * Call before every page.goto, fetch, and page.request to Amazon KDP domains.
 */
export async function kdpThrottle(): Promise<void> {
  const delayMs = KDP_REQUEST_DELAY_MS
  if (delayMs <= 0) return

  const now = Date.now()
  const elapsed = lastRequestAt > 0 ? now - lastRequestAt : delayMs
  if (elapsed < delayMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs - elapsed))
  }
  lastRequestAt = Date.now()
}

/** Reset throttle clock (e.g. after a long idle gap is unnecessary — skip for simplicity). */
export function resetKdpThrottle(): void {
  lastRequestAt = 0
}
