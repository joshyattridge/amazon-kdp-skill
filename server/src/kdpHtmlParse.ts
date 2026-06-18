import type { Page } from 'playwright'
import { KdpAuthError } from './kdpClient.js'
import { kdpRequestGet } from './kdpHttp.js'

export type HtmlFetchResult =
  | { ok: true; html: string; url: string }
  | { ok: false; reason: 'auth' | 'http' | 'empty' }

function looksLikeSignIn(html: string, url: string): boolean {
  const u = url.toLowerCase()
  if (u.includes('signin') || u.includes('/ap/')) return true
  return (
    html.includes('ap/signin') &&
    html.includes('password') &&
    !html.includes('data-print-book-title') &&
    !html.includes('data-title')
  )
}

/** GET page HTML via Playwright request API (session cookies, no full navigation). */
export async function kdpFetchHtml(page: Page, url: string): Promise<HtmlFetchResult> {
  const res = await kdpRequestGet(page, url)
  const finalUrl = res.url()
  const html = await res.text()

  if (looksLikeSignIn(html, finalUrl)) {
    return { ok: false, reason: 'auth' }
  }
  if (!res.ok() || html.length < 100) {
    return { ok: false, reason: res.ok() ? 'empty' : 'http' }
  }
  return { ok: true, html, url: finalUrl }
}

/** Parse server-rendered KDP HTML with existing in-page parser functions. */
export async function parseKdpHtml<T>(
  page: Page,
  html: string,
  parserSource: string,
): Promise<T> {
  await page.setContent(html, { waitUntil: 'domcontentloaded' })
  return page.evaluate(`(${parserSource})()`) as Promise<T>
}

export async function fetchAndParseKdpHtml<T>(
  requestPage: Page,
  parsePage: Page,
  url: string,
  parserSource: string,
): Promise<T | null> {
  const fetched = await kdpFetchHtml(requestPage, url)
  if (!fetched.ok) {
    if (fetched.reason === 'auth') throw new KdpAuthError()
    return null
  }
  return parseKdpHtml<T>(parsePage, fetched.html, parserSource)
}
