import type { APIResponse, Page } from 'playwright'
import { kdpThrottle } from './kdpRateLimit.js'

type GotoOptions = Parameters<Page['goto']>[1]

/** Rate-limited page navigation to KDP. */
export async function kdpGoto(
  page: Page,
  url: string,
  options?: GotoOptions,
) {
  await kdpThrottle()
  return page.goto(url, options)
}

/** Rate-limited Playwright API request (e.g. report download URLs). */
export async function kdpRequestGet(
  page: Page,
  url: string,
  timeoutMs = 120_000,
): Promise<APIResponse> {
  await kdpThrottle()
  return page.request.get(url, { timeout: timeoutMs })
}

/** Rate-limited JSON GET via Playwright request context (session cookies). */
export async function kdpFetchJson<T>(
  page: Page,
  url: string,
): Promise<T | null> {
  await kdpThrottle()
  const res = await page.request.get(url)
  if (!res.ok()) return null
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** Rate-limited text GET via Playwright request context. */
export async function kdpFetchText(
  page: Page,
  url: string,
): Promise<{ ok: boolean; status: number; text: string }> {
  await kdpThrottle()
  const res = await page.request.get(url)
  return { ok: res.ok(), status: res.status(), text: await res.text() }
}

/** Rate-limited JSON POST via Playwright request context. */
export async function kdpFetchJsonPost<T>(
  page: Page,
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  await kdpThrottle()
  const res = await page.request.post(url, {
    headers: { 'Content-Type': 'application/json' },
    data: body,
  })
  try {
    return { ok: res.ok(), status: res.status(), data: (await res.json()) as T }
  } catch {
    return { ok: res.ok(), status: res.status(), data: null }
  }
}
