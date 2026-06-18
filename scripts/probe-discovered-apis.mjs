#!/usr/bin/env node
/** Quick probe of discovered KDP endpoints from network capture. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sessionFile = path.join(repoRoot, '.kdp-session', 'amazon-kdp.json')

const ENDPOINTS = [
  'https://kdpreports.amazon.com/metadata/reports/reportsMetadata',
  'https://kdpreports.amazon.com/reports/royalties/table/titles',
  'https://kdpreports.amazon.com/reports/royalties/marketplaceOverviewV2',
  'https://kdpreports.amazon.com/api/v2/reports/customerPreferences',
  'https://kdp.amazon.com/xray/status',
]

async function probe(page, url, init = {}) {
  const res = await page.request.fetch(url, init)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* html or empty */
  }
  return {
    status: res.status(),
    ok: res.ok(),
    contentType: res.headers()['content-type'] ?? '',
    length: text.length,
    preview: text.slice(0, 1500),
    jsonKeys: json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).slice(0, 20) : null,
    arrayLength: Array.isArray(json) ? json.length : null,
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ storageState: sessionFile })
  const page = await context.newPage()
  await page.goto('https://kdpreports.amazon.com/reports/royalties', {
    waitUntil: 'networkidle',
    timeout: 120_000,
  })

  const out = {}
  for (const url of ENDPOINTS) {
    out[url] = await probe(page, url)
    await new Promise((r) => setTimeout(r, 4000))
    // POST variant for table/titles
    if (url.includes('table/titles')) {
      out[`POST ${url}`] = await probe(page, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: '{}',
      })
    }
  }

  await browser.close()
  console.log(JSON.stringify(out, null, 2))
}

main().catch(console.error)
