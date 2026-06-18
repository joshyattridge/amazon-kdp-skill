import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { KdpAuthError, KdpClientError } from './kdpClient.js'
import { fetchBookMetadata, setupPageUrl, withKdpPage } from './kdpMetadata.js'
import { kdpGoto } from './kdpHttp.js'
import { kdpThrottle } from './kdpRateLimit.js'
import {
  type KdpBookFormat,
  type KdpBookMetadata,
  patchBookInCache,
} from './metadataStore.js'

const FILL_PRICING_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../browser/fillBookPricing.js'),
  'utf8',
)

export type KdpPricingChanges = {
  listPriceUsd?: string
  prices?: Record<string, string>
  territory?: 'worldwide' | 'individual'
  royaltyPlan?: string
  kdpSelect?: boolean
}

export type KdpPricingUpdateOptions = {
  dryRun?: boolean
}

export type KdpPricingUpdateResult = {
  titleId: string
  format: KdpBookFormat
  dryRun: boolean
  filled: string[]
  skipped: string[]
  saved: boolean
  errors: string[]
  book: KdpBookMetadata | null
}

type FillResult = { filled: string[]; skipped: string[] }

function buildFillPayload(changes: KdpPricingChanges): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (changes.listPriceUsd !== undefined) payload.listPriceUsd = changes.listPriceUsd
  if (changes.prices !== undefined) payload.prices = changes.prices
  if (changes.territory !== undefined) payload.territory = changes.territory
  if (changes.royaltyPlan !== undefined) payload.royaltyPlan = changes.royaltyPlan
  if (changes.kdpSelect !== undefined) payload.kdpSelect = changes.kdpSelect
  return payload
}

function hasChanges(changes: KdpPricingChanges): boolean {
  return Object.keys(buildFillPayload(changes)).length > 0
}

async function fillPricingPage(
  page: Page,
  format: KdpBookFormat,
  changes: KdpPricingChanges,
): Promise<FillResult> {
  const payload = buildFillPayload(changes)
  return page.evaluate(
    `(${FILL_PRICING_FN})(${JSON.stringify(format)}, ${JSON.stringify(payload)})`,
  ) as Promise<FillResult>
}

async function clickSaveOnPricingPage(page: Page): Promise<void> {
  const patterns = [
    /^save and continue$/i,
    /^save as draft$/i,
    /^save and publish$/i,
    /^save changes$/i,
    /^save$/i,
    /^publish$/i,
  ]

  for (const pattern of patterns) {
    const button = page.getByRole('button', { name: pattern }).first()
    if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
      await button.click({ timeout: 15_000 })
      await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      return
    }
  }

  const submit = page.locator('input[type="submit"][value*="Save" i]').first()
  if (await submit.isVisible({ timeout: 1500 }).catch(() => false)) {
    await submit.click({ timeout: 15_000 })
    await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
    return
  }

  throw new KdpClientError('Could not find a Save button on the KDP pricing page.')
}

async function isPricingPageReady(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    if (document.title === 'Server Busy') return false
    return (
      !!document.getElementById('price-input-usd') ||
      !!document.querySelector('input[name="data[digital][royalty_plan]"]') ||
      !!document.querySelector('input[name="data[digital][channels][amazon][US][price_vat_inclusive]"]') ||
      !!document.querySelector('input[name="data[digital][royalty_rate]-radio"]') ||
      !!document.querySelector('input[name="data[is_select]-check"]')
    )
  })
}

async function openPricingPageWithRetry(
  page: Page,
  format: KdpBookFormat,
  titleId: string,
): Promise<void> {
  const pricingUrl = setupPageUrl(format, titleId, 'pricing')

  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await page.waitForTimeout(3000 + attempt * 2000)

    const response = await kdpGoto(page, pricingUrl, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    })

    if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()
    if (!response?.ok()) {
      throw new KdpClientError(`Could not open KDP pricing page for ${titleId} (${format}).`)
    }

    if (await isPricingPageReady(page)) return
  }

  throw new KdpClientError(
    `KDP pricing page did not load for ${titleId} (${format}).`,
  )
}

function pricingApplied(book: KdpBookMetadata, changes: KdpPricingChanges): boolean {
  if (changes.listPriceUsd !== undefined) {
    const expected = changes.listPriceUsd.replace(',', '.')
    const actual = (book.listPriceUsd || book.prices.USD || '').replace(',', '.')
    if (actual !== expected) return false
  }
  if (changes.kdpSelect !== undefined && book.kdpSelect !== changes.kdpSelect) {
    return false
  }
  if (changes.royaltyPlan !== undefined && book.royaltyPlan !== changes.royaltyPlan) {
    return false
  }
  return true
}

export async function updateBookPricingOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
  changes: KdpPricingChanges,
  dryRun: boolean,
  options: { skipOpen?: boolean } = {},
): Promise<KdpPricingUpdateResult> {
  if (!options.skipOpen) {
    await openPricingPageWithRetry(page, format, titleId)
  }

  const fillResult = await fillPricingPage(page, format, changes)

  if (fillResult.skipped.length > 0 && fillResult.filled.length === 0) {
    throw new KdpClientError(
      `Could not find editable pricing fields: ${fillResult.skipped.join(', ')}`,
    )
  }

  if (dryRun) {
    return {
      titleId,
      format,
      dryRun: true,
      filled: fillResult.filled,
      skipped: fillResult.skipped,
      saved: false,
      errors: [],
      book: null,
    }
  }

  await clickSaveOnPricingPage(page)

  const parsePage = await page.context().newPage()
  let refreshed: KdpBookMetadata | null = null
  try {
    refreshed = await fetchBookMetadata(page, parsePage, { titleId, format })
  } finally {
    await parsePage.close().catch(() => {})
  }

  if (refreshed && pricingApplied(refreshed, changes)) {
    await patchBookInCache(refreshed)
    return {
      titleId,
      format,
      dryRun: false,
      filled: fillResult.filled,
      skipped: fillResult.skipped,
      saved: true,
      errors: [],
      book: refreshed,
    }
  }

  return {
    titleId,
    format,
    dryRun: false,
    filled: fillResult.filled,
    skipped: fillResult.skipped,
    saved: false,
    errors: ['Pricing changes were not verified after save.'],
    book: refreshed,
  }
}

export async function updateBookPricing(
  titleId: string,
  format: KdpBookFormat,
  changes: KdpPricingChanges,
  options: KdpPricingUpdateOptions = {},
): Promise<KdpPricingUpdateResult> {
  if (!titleId.trim()) throw new KdpClientError('titleId is required.')
  if (!hasChanges(changes)) throw new KdpClientError('No pricing changes provided.')

  const dryRun = options.dryRun ?? false

  return withKdpPage(async (page) =>
    updateBookPricingOnPage(page, titleId, format, changes, dryRun),
  )
}

export async function updateBookPricingBatch(
  updates: Array<{ titleId: string; format: KdpBookFormat; changes: KdpPricingChanges }>,
  options: KdpPricingUpdateOptions = {},
): Promise<{ dryRun: boolean; results: KdpPricingUpdateResult[]; succeeded: number; failed: number }> {
  const dryRun = options.dryRun ?? false
  const results: KdpPricingUpdateResult[] = []

  for (let i = 0; i < updates.length; i++) {
    if (i > 0) await kdpThrottle()
    try {
      results.push(await updateBookPricing(updates[i].titleId, updates[i].format, updates[i].changes, { dryRun }))
    } catch (e) {
      results.push({
        titleId: updates[i].titleId,
        format: updates[i].format,
        dryRun,
        filled: [],
        skipped: [],
        saved: false,
        errors: [e instanceof Error ? e.message : 'Update failed.'],
        book: null,
      })
    }
  }

  return {
    dryRun,
    results,
    succeeded: results.filter((r) => r.saved || (dryRun && r.filled.length > 0)).length,
    failed: results.filter((r) => !r.saved && !(dryRun && r.filled.length > 0)).length,
  }
}
