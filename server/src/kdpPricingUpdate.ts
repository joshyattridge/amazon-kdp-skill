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
import { clickKdpActionButton, dismissKdpOverlays } from './kdpUiHelpers.js'
import { gatherBlockers, recoverFromBlockers, type RecoveryAttempt } from './kdpRecovery.js'

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
  recoveryLog?: RecoveryAttempt[]
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
  await clickKdpActionButton(page, {
    buttonIds: ['save-announce', 'save-and-continue-announce'],
    labels: ['Save as Draft', 'Save and Continue', 'Save and Publish', 'Save'],
  })
}

/** Poll until KDP unlocks the pricing page (content processing complete). */
export async function waitForPricingPageReady(
  page: Page,
  format: KdpBookFormat,
  titleId: string,
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 600_000
  const deadline = Date.now() + timeoutMs
  const pricingUrl = setupPageUrl(format, titleId, 'pricing')

  while (Date.now() < deadline) {
    const response = await kdpGoto(page, pricingUrl, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    }).catch(() => null)

    if (response?.ok() && (await isPricingPageReady(page))) return true
    await page.waitForTimeout(10_000)
  }
  return false
}

async function isPricingPageReady(page: Page): Promise<boolean> {
  return page.evaluate(`(() => {
    if (document.title === 'Server Busy') return false
    return (
      !!document.getElementById('price-input-usd') ||
      !!document.querySelector('input[name="data[print_book][list_price][USD][amount]"]') ||
      !!document.querySelector('input[name="data[print_book][list_price][US][amount]"]') ||
      !!document.querySelector('input[name="data[digital][royalty_plan]"]') ||
      !!document.querySelector('input[name="data[digital][channels][amazon][US][price_vat_inclusive]"]') ||
      !!document.querySelector('input[name="data[digital][royalty_rate]-radio"]') ||
      !!document.querySelector('input[name="data[is_select]-check"]')
    )
  })()`) as Promise<boolean>
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

  if (changes.listPriceUsd !== undefined) {
    const usd = page.locator('#price-input-usd').first()
    if (await usd.isVisible({ timeout: 3000 }).catch(() => false)) {
      await usd.scrollIntoViewIfNeeded().catch(() => {})
      await usd.click({ timeout: 5000 }).catch(() => {})
      await usd.fill(changes.listPriceUsd)
      await page.waitForTimeout(300)
      if (!fillResult.filled.includes('listPriceUsd')) fillResult.filled.push('listPriceUsd')
      fillResult.skipped = fillResult.skipped.filter((s) => s !== 'listPriceUsd')
    }
  }

  if (changes.territory === 'worldwide') {
    const worldwide = page.locator('#worldwide-rights')
    if (await worldwide.isVisible({ timeout: 2000 }).catch(() => false)) {
      await worldwide.check({ timeout: 5000 }).catch(() => {})
    }
  }

  if (fillResult.skipped.includes('listPriceUsd') && changes.listPriceUsd !== undefined) {
    await page.evaluate(
      `(price) => {
        const el =
          document.getElementById('price-input-usd') ||
          document.querySelector('input[name="data[print_book][list_price][USD][amount]"]') ||
          document.querySelector('input[name="data[print_book][list_price][US][amount]"]')
        if (el) {
          el.value = price
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }`,
      changes.listPriceUsd,
    )
    if (!fillResult.filled.includes('listPriceUsd')) {
      fillResult.filled.push('listPriceUsd')
      fillResult.skipped = fillResult.skipped.filter((s) => s !== 'listPriceUsd')
    }
  }

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

  await dismissKdpOverlays(page)

  const recoveryLog: RecoveryAttempt[] = []
  let onPageUsd = ''
  let refreshed: KdpBookMetadata | null = null
  let saved = false

  for (let attempt = 1; attempt <= 4; attempt++) {
    await dismissKdpOverlays(page)
    await clickSaveOnPricingPage(page)
    await page.waitForTimeout(5000)

    onPageUsd = (await page.evaluate(`(() => {
      return (
        document.getElementById('price-input-usd')?.value ||
        document.querySelector('input[name="data[print_book][list_price][USD][amount]"]')?.value ||
        document.querySelector('input[name="data[print_book][list_price][US][amount]"]')?.value ||
        ''
      )
    })()`)) as string

    if (
      changes.listPriceUsd !== undefined &&
      onPageUsd &&
      onPageUsd.replace(',', '.') === changes.listPriceUsd.replace(',', '.')
    ) {
      saved = true
      break
    }

    const parsePage = await page.context().newPage()
    try {
      refreshed = await fetchBookMetadata(page, parsePage, { titleId, format })
    } finally {
      await parsePage.close().catch(() => {})
    }

    if (refreshed && pricingApplied(refreshed, changes)) {
      saved = true
      break
    }

    if (attempt < 4) {
      const blockers = await gatherBlockers(page, ['Pricing changes were not verified after save.'])
      const recovery = await recoverFromBlockers(page, blockers, { step: 'pricing' })
      recovery.attempt = attempt
      recoveryLog.push(recovery)
      await page.waitForTimeout(1500)
    }
  }

  if (saved && onPageUsd) {
    return {
      titleId,
      format,
      dryRun: false,
      filled: fillResult.filled,
      skipped: fillResult.skipped,
      saved: true,
      errors: [],
      book: { titleId, format, listPriceUsd: onPageUsd } as KdpBookMetadata,
      recoveryLog: recoveryLog.length > 0 ? recoveryLog : undefined,
    }
  }

  if (saved && refreshed && pricingApplied(refreshed, changes)) {
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
      recoveryLog: recoveryLog.length > 0 ? recoveryLog : undefined,
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
    recoveryLog: recoveryLog.length > 0 ? recoveryLog : undefined,
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

  return withKdpPage(
    async (page) => updateBookPricingOnPage(page, titleId, format, changes, dryRun),
    { headless: false },
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
