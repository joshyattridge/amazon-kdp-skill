import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { KdpAuthError, KdpClientError } from './kdpClient.js'
import { fetchBookMetadata, setupPageUrl, withKdpPage } from './kdpMetadata.js'
import { kdpGoto } from './kdpHttp.js'
import { kdpThrottle } from './kdpRateLimit.js'
import { clickKdpActionButton } from './kdpUiHelpers.js'
import { setReleaseNow } from './kdpCreateTitle.js'
import {
  type KdpBookFormat,
  type KdpBookMetadata,
  patchBookInCache,
  readMetadataCache,
} from './metadataStore.js'

const FILL_DETAILS_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../browser/fillBookDetails.js'),
  'utf8',
)

export type KdpMetadataChanges = {
  title?: string
  subtitle?: string
  description?: string
  descriptionHtml?: string
  keywords?: string[]
  seriesTitle?: string
  seriesNumber?: string
  primaryAuthor?: { firstName?: string; lastName?: string }
  contributors?: Array<{ role: string; firstName: string; lastName: string }>
  language?: string
  publisherLabel?: string
  editionNumber?: string
  readingInterestAgeMin?: string
  readingInterestAgeMax?: string
  isPublicDomain?: boolean
  isAdultContent?: boolean
  largePrint?: boolean
}

export type KdpMetadataUpdateOptions = {
  dryRun?: boolean
}

export type KdpMetadataUpdateResult = {
  titleId: string
  format: KdpBookFormat
  dryRun: boolean
  filled: string[]
  skipped: string[]
  saved: boolean
  errors: string[]
  book: KdpBookMetadata | null
}

export type KdpMetadataBatchUpdateResult = {
  dryRun: boolean
  results: KdpMetadataUpdateResult[]
  succeeded: number
  failed: number
}

type FillResult = {
  filled: string[]
  skipped: string[]
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function plainTextToDescriptionHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return ''
  return paragraphs
    .map((p) => `<p>${escapeHtml(p.replace(/\n/g, ' '))}</p>`)
    .join('')
}

function normalizeKeywords(keywords: string[]): string[] {
  return keywords.slice(0, 7).map((kw) => kw.trim())
}

function buildFillPayload(changes: KdpMetadataChanges): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (changes.title !== undefined) payload.title = changes.title
  if (changes.subtitle !== undefined) payload.subtitle = changes.subtitle
  if (changes.seriesTitle !== undefined) payload.seriesTitle = changes.seriesTitle
  if (changes.seriesNumber !== undefined) payload.seriesNumber = changes.seriesNumber
  if (changes.keywords !== undefined) {
    payload.keywords = normalizeKeywords(changes.keywords)
  }
  if (changes.descriptionHtml !== undefined) {
    payload.descriptionHtml = changes.descriptionHtml
  } else if (changes.description !== undefined) {
    payload.descriptionHtml = plainTextToDescriptionHtml(changes.description)
  }
  if (changes.primaryAuthor !== undefined) {
    payload.primaryAuthor = changes.primaryAuthor
  }
  if (changes.contributors !== undefined) {
    payload.contributors = changes.contributors
  }
  if (changes.language !== undefined) payload.language = changes.language
  if (changes.publisherLabel !== undefined) payload.publisherLabel = changes.publisherLabel
  if (changes.editionNumber !== undefined) payload.editionNumber = changes.editionNumber
  if (changes.readingInterestAgeMin !== undefined) {
    payload.readingInterestAgeMin = changes.readingInterestAgeMin
  }
  if (changes.readingInterestAgeMax !== undefined) {
    payload.readingInterestAgeMax = changes.readingInterestAgeMax
  }
  if (changes.isPublicDomain !== undefined) payload.isPublicDomain = changes.isPublicDomain
  if (changes.isAdultContent !== undefined) payload.isAdultContent = changes.isAdultContent
  if (changes.largePrint !== undefined) payload.largePrint = changes.largePrint
  return payload
}

function hasChanges(changes: KdpMetadataChanges): boolean {
  return Object.keys(buildFillPayload(changes)).length > 0
}

async function fillDetailsPage(
  page: Page,
  format: KdpBookFormat,
  changes: KdpMetadataChanges,
): Promise<FillResult> {
  const payload = buildFillPayload(changes)
  if (Object.keys(payload).length === 0) {
    return { filled: [], skipped: [] }
  }
  return page.evaluate(
    `(${FILL_DETAILS_FN})(${JSON.stringify(format)}, ${JSON.stringify(payload)})`,
  ) as Promise<FillResult>
}

export async function ensureLanguageSelected(
  page: Page,
  format: KdpBookFormat,
  language: string,
): Promise<void> {
  const selectId =
    format === 'paperback'
      ? 'data-print-book-language-native'
      : format === 'hardcover'
        ? 'data-hardcover-book-language-native'
        : 'data-language-native'

  const normalized = language.trim().toLowerCase()
  const value =
    normalized === 'english'
      ? 'english'
      : normalized === 'german'
        ? 'german'
        : normalized === 'french'
          ? 'french'
          : normalized === 'spanish'
            ? 'spanish'
            : normalized

  await page.evaluate(
    `(({ id, wantedValue, wantedText }) => {
      const syncHidden = (val) => {
        for (const name of [
          'data[print_book][language]',
          'data[language]',
          'data[hardcover_book][language]',
        ]) {
          const hidden = document.querySelector('input[name="' + name + '"]')
          if (hidden) {
            hidden.value = val
            hidden.dispatchEvent(new Event('change', { bubbles: true }))
          }
        }
      }
      const el = document.getElementById(id)
      if (!el) return
      for (const opt of el.options) {
        if (
          opt.value.toLowerCase() === wantedValue ||
          opt.text.trim().toLowerCase() === wantedText ||
          opt.text.trim().toLowerCase() === wantedValue
        ) {
          el.value = opt.value
          el.dispatchEvent(new Event('change', { bubbles: true }))
          syncHidden(opt.value)
          return
        }
      }
      for (const opt of el.options) {
        if (opt.text.trim().toLowerCase().includes(wantedText)) {
          el.value = opt.value
          el.dispatchEvent(new Event('change', { bubbles: true }))
          syncHidden(opt.value)
          return
        }
      }
    })(${JSON.stringify({ id: selectId, wantedValue: value, wantedText: normalized })})`,
  )

  const dropdown = page
    .locator('label')
    .filter({ hasText: /^Language$/i })
    .locator('..')
    .locator('span.a-button-dropdown')
    .first()
  if (await dropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
    await dropdown.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)
    const english = page.locator('a.a-dropdown-link').filter({ hasText: /^English$/i }).first()
    if (await english.isVisible({ timeout: 2000 }).catch(() => false)) {
      await english.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(500)
    }
  }

  await page.waitForTimeout(500)
}

async function collectPageErrors(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const messages = new Set()
    for (const el of document.querySelectorAll('.a-alert-error, .a-alert.a-alert-error')) {
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
      if (text && text.length < 500) messages.add(text)
    }
    for (const el of document.querySelectorAll('.field-error, [data-field-error="true"]')) {
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
      if (text && text.length < 300) messages.add(text)
    }
    return [...messages]
  })()`) as Promise<string[]>
}

function keywordSlots(keywords: string[]): string[] {
  const slots = normalizeKeywords(keywords)
  while (slots.length < 7) slots.push('')
  return slots.slice(0, 7)
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function changesApplied(book: KdpBookMetadata, changes: KdpMetadataChanges): boolean {
  if (changes.title !== undefined && book.title.trim() !== changes.title.trim()) {
    return false
  }
  if (changes.subtitle !== undefined && book.subtitle.trim() !== changes.subtitle.trim()) {
    return false
  }
  if (changes.description !== undefined && book.description.trim() !== changes.description.trim()) {
    return false
  }
  if (changes.descriptionHtml !== undefined) {
    const expected = stripHtml(changes.descriptionHtml)
    const actual = stripHtml(book.description)
    if (!expected || !actual) return false
    const probe = expected.slice(0, Math.min(80, expected.length))
    if (!actual.includes(probe) && !expected.includes(actual.slice(0, 80))) return false
  }
  if (changes.seriesTitle !== undefined && book.seriesTitle.trim() !== changes.seriesTitle.trim()) {
    return false
  }
  if (changes.seriesNumber !== undefined && book.seriesNumber.trim() !== changes.seriesNumber.trim()) {
    return false
  }
  if (changes.keywords !== undefined) {
    const expected = keywordSlots(changes.keywords)
    const actual = keywordSlots(book.keywords)
    for (let i = 0; i < 7; i++) {
      if (expected[i].toLowerCase() !== actual[i].toLowerCase()) return false
    }
  }
  return true
}

async function finalizeMetadataSave(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
  changes: KdpMetadataChanges,
  fillResult: FillResult,
): Promise<KdpMetadataUpdateResult> {
  const pageErrors = await collectPageErrors(page)
  const parsePage = await page.context().newPage()
  let refreshed: KdpBookMetadata | null = null
  try {
    refreshed = await fetchBookMetadata(page, parsePage, { titleId, format })
  } finally {
    await parsePage.close().catch(() => {})
  }

  if (refreshed && changesApplied(refreshed, changes)) {
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
    errors:
      pageErrors.length > 0
        ? pageErrors
        : ['Changes were not applied on KDP. Re-read metadata did not match the requested update.'],
    book: refreshed,
  }
}

async function clickSaveOnDetailsPage(page: Page): Promise<void> {
  await clickKdpActionButton(page, {
    buttonIds: ['save-and-continue-announce', 'save-announce', 'unsaved-changes-save-announce'],
    labels: ['Save and Continue', 'Save as Draft', 'Save Changes', 'Save'],
  })
}

async function isDetailsPageReady(page: Page, format: KdpBookFormat): Promise<boolean> {
  return page.evaluate((fmt) => {
    if (document.title === 'Server Busy') return false
    const kwId =
      fmt === 'paperback'
        ? 'data-print-book-keywords-0'
        : fmt === 'hardcover'
          ? 'data-hardcover-book-keywords-0'
          : 'data-keywords-0'
    return !!document.getElementById(kwId)
  }, format)
}

async function bypassServerBusy(page: Page): Promise<void> {
  const title = await page.title()
  if (title !== 'Server Busy') return

  const continueBtn = page
    .locator('input[type="submit"], button, a.a-button-text, span.a-button-inner')
    .filter({ hasText: /continue/i })
    .first()
  if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await continueBtn.click({ timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(2000)
  }
}

async function openDetailsPageWithRetry(
  page: Page,
  format: KdpBookFormat,
  titleId: string,
): Promise<void> {
  const detailsUrl = setupPageUrl(format, titleId, 'details')

  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      await page.waitForTimeout(3000 + attempt * 2000)
    }

    const response = await kdpGoto(page, detailsUrl, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    })

    if (page.url().toLowerCase().includes('signin')) {
      throw new KdpAuthError()
    }
    if (!response?.ok()) {
      throw new KdpClientError(
        `Could not open KDP details page for ${titleId} (${format}).`,
      )
    }

    await bypassServerBusy(page)

    if ((await page.title()) === 'Server Busy') {
      await kdpGoto(page, detailsUrl, { waitUntil: 'networkidle', timeout: 120_000 })
    }

    if (await isDetailsPageReady(page, format)) {
      return
    }
  }

  throw new KdpClientError(
    `KDP details page did not load editable fields for ${titleId} (${format}). Amazon may be rate-limiting — try again in a few minutes.`,
  )
}

export async function updateBookMetadata(
  titleId: string,
  format: KdpBookFormat,
  changes: KdpMetadataChanges,
  options: KdpMetadataUpdateOptions = {},
): Promise<KdpMetadataUpdateResult> {
  if (!titleId.trim()) {
    throw new KdpClientError('titleId is required.')
  }
  if (format !== 'kindle' && format !== 'paperback' && format !== 'hardcover') {
    throw new KdpClientError('format must be kindle, paperback, or hardcover.')
  }
  if (!hasChanges(changes)) {
    throw new KdpClientError('No metadata changes provided.')
  }
  if (changes.keywords && changes.keywords.length > 7) {
    throw new KdpClientError('KDP allows at most 7 keywords.')
  }

  const dryRun = options.dryRun ?? false

  return withKdpPage(async (page) => {
    await openDetailsPageWithRetry(page, format, titleId)

    if (changes.language) {
      await ensureLanguageSelected(page, format, changes.language)
    }
    await setReleaseNow(page)

    const fillResult = await fillDetailsPage(page, format, changes)

    if (fillResult.skipped.length > 0 && fillResult.filled.length === 0) {
      throw new KdpClientError(
        `Could not find editable fields on KDP: ${fillResult.skipped.join(', ')}`,
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

    if (changes.language) {
      await ensureLanguageSelected(page, format, changes.language)
    }
    await setReleaseNow(page)

    await clickSaveOnDetailsPage(page)

    if (page.url().toLowerCase().includes('signin')) {
      throw new KdpAuthError()
    }

    return finalizeMetadataSave(page, titleId, format, changes, fillResult)
  })
}

export async function updateBookMetadataBatch(
  updates: Array<{
    titleId: string
    format: KdpBookFormat
    changes: KdpMetadataChanges
  }>,
  options: KdpMetadataUpdateOptions = {},
): Promise<KdpMetadataBatchUpdateResult> {
  if (updates.length === 0) {
    throw new KdpClientError('No updates provided.')
  }

  const dryRun = options.dryRun ?? false
  const results: KdpMetadataUpdateResult[] = []

  await withKdpPage(async (page) => {
    for (let i = 0; i < updates.length; i++) {
      const update = updates[i]
      if (i > 0) {
        await kdpThrottle()
      }
      try {
        const result = await updateBookMetadataOnPage(
          page,
          update.titleId,
          update.format,
          update.changes,
          dryRun,
        )
        results.push(result)
      } catch (e) {
        if (e instanceof KdpAuthError) throw e
        results.push({
          titleId: update.titleId,
          format: update.format,
          dryRun,
          filled: [],
          skipped: [],
          saved: false,
          errors: [e instanceof Error ? e.message : 'Update failed.'],
          book: null,
        })
      }
    }
  })

  return {
    dryRun,
    results,
    succeeded: results.filter((r) => r.saved || (dryRun && r.filled.length > 0)).length,
    failed: results.filter((r) => !r.saved && !(dryRun && r.filled.length > 0)).length,
  }
}

export async function updateBookMetadataOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
  changes: KdpMetadataChanges,
  dryRun: boolean,
  options: { skipOpen?: boolean } = {},
): Promise<KdpMetadataUpdateResult> {
  if (!options.skipOpen) {
    await openDetailsPageWithRetry(page, format, titleId)
  }

  const fillResult = await fillDetailsPage(page, format, changes)

  if (fillResult.skipped.length > 0 && fillResult.filled.length === 0) {
    throw new KdpClientError(
      `Could not find editable fields: ${fillResult.skipped.join(', ')}`,
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

  if (changes.language) {
    await ensureLanguageSelected(page, format, changes.language)
  }
  await setReleaseNow(page)

  await clickSaveOnDetailsPage(page)

  if (page.url().toLowerCase().includes('signin')) {
    throw new KdpAuthError()
  }

  return finalizeMetadataSave(page, titleId, format, changes, fillResult)
}

export async function saveDetailsOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
  changes: KdpMetadataChanges,
): Promise<KdpMetadataUpdateResult> {
  if (!page.url().includes('/details')) {
    await openDetailsPageWithRetry(page, format, titleId)
  }
  await setReleaseNow(page)
  if (changes.language) {
    await ensureLanguageSelected(page, format, changes.language)
  }
  const fillResult = await fillDetailsPage(page, format, changes)
  await clickSaveOnDetailsPage(page)
  await page.waitForTimeout(5000)
  if (page.url().toLowerCase().includes('signin')) {
    throw new KdpAuthError()
  }
  return finalizeMetadataSave(page, titleId, format, changes, fillResult)
}

export async function findBookInCache(
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpBookMetadata | null> {
  const cache = await readMetadataCache()
  return (
    cache?.books.find((b) => b.titleId === titleId && b.format === format) ?? null
  )
}
