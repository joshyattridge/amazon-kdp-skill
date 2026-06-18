#!/usr/bin/env node
/** Verify KDP_REQUEST_DELAY_MS is enforced between sequential throttled calls. */
import { kdpThrottle, getKdpRequestDelayMs } from '../server/src/kdpRateLimit.js'

const delayMs = getKdpRequestDelayMs()
console.log(`Configured delay: ${delayMs}ms`)

const t0 = Date.now()
await kdpThrottle()
await kdpThrottle()
const elapsed = Date.now() - t0

console.log(`Two sequential kdpThrottle() calls took ${elapsed}ms`)

if (delayMs <= 0) {
  console.log('Throttle disabled (delay <= 0) — skip timing check.')
  process.exit(0)
}

const minExpected = delayMs * 0.9
if (elapsed < minExpected) {
  console.error(`FAIL: expected at least ~${delayMs}ms between calls, got ${elapsed}ms`)
  process.exit(1)
}

console.log(`PASS: throttle enforces ~${delayMs}ms gap`)
