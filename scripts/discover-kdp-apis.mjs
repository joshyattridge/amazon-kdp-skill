#!/usr/bin/env node
/**
 * Probe KDP internal HTTP endpoints using saved session cookies.
 * Run: node scripts/discover-kdp-apis.mjs
 * Output: output/kdp-api-discovery.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sessionFile = path.join(repoRoot, '.kdp-session', 'amazon-kdp.json')
const outFile = path.join(repoRoot, 'output', 'kdp-api-discovery.json')

const REPORTS_ORIGIN = 'https://kdpreports.amazon.com'
const KDP_ORIGIN = 'https://kdp.amazon.com'

const REPORTS_ENDPOINTS = [
  '/metadata/customer/accountInfo',
  '/api/v2/reports/customerMetadata',
  '/api/v2/reports/booksMetadata',
  '/api/v2/reports/pagesReadByAsin',
]

const KDP_ENDPOINT_GUESSES = [
  '/en_US/api/bookshelf',
  '/en_US/api/bookshelf/titles',
  '/api/bookshelf',
  '/en_US/titles',
  '/en_US/api/titles',
  '/en_US/metadata/customer/accountInfo',
]

async function fetchProbe(page, url) {
  return page.evaluate(async (fetchUrl) => {
    try {
      const res = await fetch(fetchUrl, { credentials: 'include' })
      const contentType = res.headers.get('content-type') ?? ''
      const text = await res.text()
      let preview = text.slice(0, 2000)
      let parsed = null
      if (contentType.includes('json') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
        try {
          parsed = JSON.parse(text)
          preview = JSON.stringify(parsed).slice(0, 2000)
        } catch {
          /* not json */
        }
      }
      return {
        ok: res.ok,
        status: res.status,
        contentType,
        length: text.length,
        preview,
        topLevelKeys:
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? Object.keys(parsed).slice(0, 30)
            : Array.isArray(parsed)
              ? ['[array]', `length=${parsed.length}`]
              : null,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }, url)
}

async function captureNetworkOnPageLoad(page, url) {
  const requests = []
  const handler = (req) => {
    const u = req.url()
    if (u.includes('kdp.amazon.com') || u.includes('kdpreports.amazon.com')) {
      requests.push({ method: req.method(), url: u, resourceType: req.resourceType() })
    }
  }
  page.on('request', handler)
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.waitForTimeout(3000)
  } finally {
    page.off('request', handler)
  }
  return { finalUrl: page.url(), requests: requests.slice(0, 100) }
}

async function main() {
  try {
    await fs.access(sessionFile)
  } catch {
    console.error('No session. Run: npm run login')
    process.exit(1)
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ storageState: sessionFile })
  const page = await context.newPage()

  const result = {
    discoveredAt: new Date().toISOString(),
    reportsEndpoints: {},
    kdpEndpointGuesses: {},
    networkCapture: {},
  }

  await page.goto(`${REPORTS_ORIGIN}/reports/royalties`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  })

  for (const ep of REPORTS_ENDPOINTS) {
    const url = `${REPORTS_ORIGIN}${ep}`
    result.reportsEndpoints[ep] = await fetchProbe(page, url)
    await new Promise((r) => setTimeout(r, 4000))
  }

  // booksMetadata often requires POST from the reports dashboard context
  result.reportsEndpointsPost = {}
  for (const ep of ['/api/v2/reports/booksMetadata', '/api/v2/reports/customerMetadata']) {
    const url = `${REPORTS_ORIGIN}${ep}`
    result.reportsEndpointsPost[ep] = await page.evaluate(async (fetchUrl) => {
      try {
        const res = await fetch(fetchUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const text = await res.text()
        return { ok: res.ok, status: res.status, preview: text.slice(0, 2000) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }, url)
    await new Promise((r) => setTimeout(r, 4000))
  }

  await page.goto(`${KDP_ORIGIN}/en_US/bookshelf`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  })

  for (const ep of KDP_ENDPOINT_GUESSES) {
    const url = `${KDP_ORIGIN}${ep}`
    result.kdpEndpointGuesses[ep] = await fetchProbe(page, url)
    await new Promise((r) => setTimeout(r, 4000))
  }

  result.networkCapture.bookshelf = await captureNetworkOnPageLoad(
    page,
    `${KDP_ORIGIN}/en_US/bookshelf`,
  )

  result.networkCapture.reportsRoyalties = await captureNetworkOnPageLoad(
    page,
    `${REPORTS_ORIGIN}/reports/royalties`,
  )

  // Try to find a title-setup link and capture its XHR traffic
  const setupLink = await page.evaluate(() => {
    for (const a of document.querySelectorAll('a[href*="title-setup"]')) {
      const href = a.getAttribute('href')
      if (href?.includes('/details')) return href.startsWith('http') ? href : `https://kdp.amazon.com${href}`
    }
    return null
  })

  if (setupLink) {
    result.networkCapture.titleSetupDetails = await captureNetworkOnPageLoad(page, setupLink)
    result.sampleSetupUrl = setupLink

    // Probe JSON embedded in page
    result.embeddedState = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script')]
      for (const s of scripts) {
        const t = s.textContent ?? ''
        if (t.includes('keywords') && (t.includes('titleId') || t.includes('print_book'))) {
          return t.slice(0, 3000)
        }
      }
      return null
    })
  }

  await browser.close()

  await fs.mkdir(path.dirname(outFile), { recursive: true })
  await fs.writeFile(outFile, JSON.stringify(result, null, 2))
  console.log(`Wrote ${outFile}`)
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
