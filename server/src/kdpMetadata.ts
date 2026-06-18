import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { KdpAuthError, KdpClientError } from './kdpClient.js'
import { fetchAndParseKdpHtml, kdpFetchHtml, parseKdpHtml } from './kdpHtmlParse.js'
import { kdpGoto } from './kdpHttp.js'
import { fetchAccountCatalogSize, fetchReportsBooksMetadata } from './kdpReportsApi.js'
import { kdpThrottle } from './kdpRateLimit.js'
import {
  type KdpBookFormat,
  type KdpBookMetadata,
  type KdpMetadataCache,
  type KdpMetadataSyncStats,
  METADATA_CACHE_VERSION,
  writeMetadataCache,
} from './metadataStore.js'
import { sessionExists, sessionFilePath } from './session.js'

const BOOKSHELF_URL = 'https://kdp.amazon.com/en_US/bookshelf'

const PARSE_DETAILS_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../browser/parseBookDetails.js'),
  'utf8',
)

const PARSE_CONTENT_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../browser/parseBookContent.js'),
  'utf8',
)

const PARSE_PRICING_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../browser/parseBookPricing.js'),
  'utf8',
)

const SCAN_BOOKSHELF_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../browser/scanBookshelf.js'),
  'utf8',
)

const FORMAT_ORDER: KdpBookFormat[] = ['kindle', 'paperback', 'hardcover']

type ParsedDetails = {
  title: string
  subtitle: string
  description: string
  language: string
  primaryAuthorFirstName: string
  primaryAuthorLastName: string
  publisherLabel: string
  editionNumber: string
  seriesTitle: string
  seriesNumber: string
  homeMarketplace: string
  readingInterestAgeMin: string
  readingInterestAgeMax: string
  publishingStatus: string
  isPublicDomain: boolean
  isAdultContent: boolean
  largePrint: boolean
  keywords: string[]
  categories: string[]
  contributors: Array<{ role: string; firstName: string; lastName: string }>
}

type ParsedContent = {
  isbn: string
  imprint: string
  trimSize: string
  inkAndPaper: string
  interiorFileName: string
  coverFileName: string
  pageCount: string
  manuscriptStatus: string
  coverStatus: string
}

type ParsedPricing = {
  asin: string
  listPriceUsd: string
  prices: Record<string, string>
  territory: string
  royaltyPlan: string
  fileSizeKb: string
  kdpSelect: boolean
}

type TitleFormatRef = {
  titleId: string
  format: KdpBookFormat
}

type BookshelfPageScan = {
  bookshelfRows: number
  titleIds: string[]
  refs: Array<{ titleId: string; format: string }>
}

type BookshelfScan = {
  refs: TitleFormatRef[]
  bookshelfRows: number
  uniqueTitleIds: number
  pagesScanned: number
}

export async function withKdpPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return withKdpPages(async ({ action }) => fn(action))
}

/** Separate pages avoid setContent/HTML parse conflicting with live navigation. */
export async function withKdpPages<T>(
  fn: (pages: { action: Page; parse: Page }) => Promise<T>,
): Promise<T> {
  if (!(await sessionExists())) {
    throw new KdpAuthError()
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })

  try {
    const context = await browser.newContext({ storageState: sessionFilePath() })
    const action = await context.newPage()
    const parse = await context.newPage()
    return await fn({ action, parse })
  } finally {
    await browser.close()
  }
}

async function scanCurrentBookshelfPage(page: Page): Promise<BookshelfPageScan> {
  return page.evaluate(`(${SCAN_BOOKSHELF_FN})()`) as Promise<BookshelfPageScan>
}

async function scanBookshelfHtml(page: Page, html: string): Promise<BookshelfPageScan> {
  return parseKdpHtml<BookshelfPageScan>(page, html, SCAN_BOOKSHELF_FN)
}

async function collectBookshelfRefsFromReportsApi(
  page: Page,
): Promise<TitleFormatRef[] | null> {
  const refs = await fetchReportsBooksMetadata(page)
  if (refs.length === 0) return null
  return refs.map((r) => ({ titleId: r.titleId, format: r.format }))
}

async function collectBookshelfRefsFromHtml(
  actionPage: Page,
  parsePage: Page,
): Promise<BookshelfScan | null> {
  const fetched = await kdpFetchHtml(actionPage, BOOKSHELF_URL)
  if (!fetched.ok) {
    if (fetched.reason === 'auth') throw new KdpAuthError()
    return null
  }

  const scan = await scanBookshelfHtml(parsePage, fetched.html)
  const refMap = new Map<string, TitleFormatRef>()
  const titleIdSet = new Set(scan.titleIds)

  for (const ref of normalizeRefs(scan.refs)) {
    refMap.set(`${ref.titleId}:${ref.format}`, ref)
  }
  for (const id of scan.titleIds) {
    titleIdSet.add(id)
  }

  for (const titleId of titleIdSet) {
    const hasRef = FORMAT_ORDER.some((format) => refMap.has(`${titleId}:${format}`))
    if (!hasRef) {
      refMap.set(`${titleId}:paperback`, { titleId, format: 'paperback' })
    }
  }

  return {
    refs: [...refMap.values()],
    bookshelfRows: scan.bookshelfRows,
    uniqueTitleIds: titleIdSet.size,
    pagesScanned: 1,
  }
}

async function collectBookshelfRefs(
  actionPage: Page,
  parsePage: Page,
): Promise<BookshelfScan> {
  const apiRefs = await collectBookshelfRefsFromReportsApi(actionPage)
  if (apiRefs && apiRefs.length > 0) {
    return {
      refs: apiRefs.sort((a, b) => {
        const titleCmp = a.titleId.localeCompare(b.titleId)
        if (titleCmp !== 0) return titleCmp
        return FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format)
      }),
      bookshelfRows: apiRefs.length,
      uniqueTitleIds: new Set(apiRefs.map((r) => r.titleId)).size,
      pagesScanned: 0,
    }
  }

  const htmlScan = await collectBookshelfRefsFromHtml(actionPage, parsePage)
  if (htmlScan && htmlScan.refs.length > 0) {
    const catalogSize = await fetchAccountCatalogSize(actionPage)
    const looksComplete =
      catalogSize == null || htmlScan.uniqueTitleIds >= catalogSize * 0.9
    if (looksComplete) {
      return htmlScan
    }
  }

  return collectBookshelfRefsViaBrowser(actionPage)
}

/** Paginated Bookshelf scrape — fallback when API/HTML fetch do not return refs. */
async function collectBookshelfRefsViaBrowser(page: Page): Promise<BookshelfScan> {
  await kdpGoto(page, BOOKSHELF_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  if (page.url().toLowerCase().includes('signin')) {
    throw new KdpAuthError()
  }

  const refMap = new Map<string, TitleFormatRef>()
  const titleIdSet = new Set<string>()
  let totalRows = 0
  let pagesScanned = 0

  const mergeScan = (scan: BookshelfPageScan) => {
    totalRows += scan.bookshelfRows
    pagesScanned += 1
    for (const id of scan.titleIds) {
      titleIdSet.add(id)
    }
    for (const ref of normalizeRefs(scan.refs)) {
      refMap.set(`${ref.titleId}:${ref.format}`, ref)
    }
  }

  mergeScan(await scanCurrentBookshelfPage(page))

  const pageNumbers = (await page.evaluate(`(() => {
    const nums = new Set()
    for (const anchor of document.querySelectorAll('.a-pagination li a')) {
      const text = (anchor.textContent ?? '').trim()
      if (/^\\d+$/.test(text)) nums.add(Number(text))
    }
    return [...nums].sort((a, b) => a - b)
  })()`)) as number[]

  let previousIds = [...titleIdSet].sort().join(',')

  for (const pageNum of pageNumbers) {
    if (pageNum === 1) continue

    let loaded = false
    for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
      const clicked = await page
        .locator('.a-pagination li a')
        .filter({ hasText: new RegExp(`^${pageNum}$`) })
        .first()
        .click({ timeout: 15_000 })
        .then(() => true)
        .catch(() => false)

      if (!clicked) continue

      await kdpThrottle()

      await page
        .waitForFunction(
          `(num) => {
            const selected = document.querySelector('.a-pagination .a-selected')
            return (selected?.textContent ?? '').trim() === String(num)
          }`,
          pageNum,
          { timeout: 15_000 },
        )
        .catch(() => {})

      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})

      const scan = await scanCurrentBookshelfPage(page)
      const currentIds = scan.titleIds.sort().join(',')
      if (currentIds !== previousIds && scan.titleIds.length > 0) {
        mergeScan(scan)
        previousIds = [...titleIdSet].sort().join(',')
        loaded = true
      }
    }
  }

  // Fallback: titles visible on Bookshelf without an edit/details link still
  // often have a paperback details page (e.g. Live titles with pricing only).
  for (const titleId of titleIdSet) {
    const hasRef = FORMAT_ORDER.some(
      (format) => refMap.has(`${titleId}:${format}`),
    )
    if (!hasRef) {
      refMap.set(`${titleId}:paperback`, { titleId, format: 'paperback' })
    }
  }

  return {
    refs: [...refMap.values()],
    bookshelfRows: totalRows,
    uniqueTitleIds: titleIdSet.size,
    pagesScanned,
  }
}

function normalizeRefs(raw: Array<{ titleId: string; format: string }>): TitleFormatRef[] {
  const map = new Map<string, TitleFormatRef>()
  for (const ref of raw) {
    const format = ref.format as KdpBookFormat
    if (format !== 'kindle' && format !== 'paperback' && format !== 'hardcover') {
      continue
    }
    map.set(`${ref.titleId}:${format}`, { titleId: ref.titleId, format })
  }
  return [...map.values()].sort((a, b) => {
    const titleCmp = a.titleId.localeCompare(b.titleId)
    if (titleCmp !== 0) return titleCmp
    return FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format)
  })
}

export function setupPageUrl(
  format: KdpBookFormat,
  titleId: string,
  step: 'details' | 'content' | 'pricing',
): string {
  const setupPath =
    format === 'paperback' && step === 'pricing' ? 'print-setup' : 'title-setup'
  return `https://kdp.amazon.com/en_US/${setupPath}/${format}/${titleId}/${step}`
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchBookMetadata(
  requestPage: Page,
  parsePage: Page,
  ref: TitleFormatRef,
): Promise<KdpBookMetadata | null> {
  const details = await fetchAndParseKdpHtml<ParsedDetails>(
    requestPage,
    parsePage,
    setupPageUrl(ref.format, ref.titleId, 'details'),
    PARSE_DETAILS_FN,
  )
  if (!details) {
    return null
  }

  const description = stripHtml(details.description)
  const hasContent =
    Boolean(details.title.trim()) ||
    Boolean(details.subtitle.trim()) ||
    Boolean(description) ||
    details.keywords.length > 0 ||
    details.categories.length > 0 ||
    Boolean(details.primaryAuthorFirstName.trim()) ||
    Boolean(details.primaryAuthorLastName.trim())

  if (!hasContent) {
    return null
  }

  let content: ParsedContent = {
    isbn: '',
    imprint: '',
    trimSize: '',
    inkAndPaper: '',
    interiorFileName: '',
    coverFileName: '',
    pageCount: '',
    manuscriptStatus: '',
    coverStatus: '',
  }
  const parsedContent = await fetchAndParseKdpHtml<ParsedContent>(
    requestPage,
    parsePage,
    setupPageUrl(ref.format, ref.titleId, 'content'),
    PARSE_CONTENT_FN,
  )
  if (parsedContent) {
    content = parsedContent
  }

  let pricing: ParsedPricing = {
    asin: '',
    listPriceUsd: '',
    prices: {},
    territory: '',
    royaltyPlan: '',
    fileSizeKb: '',
    kdpSelect: false,
  }
  const parsedPricing = await fetchAndParseKdpHtml<ParsedPricing>(
    requestPage,
    parsePage,
    setupPageUrl(ref.format, ref.titleId, 'pricing'),
    PARSE_PRICING_FN,
  )
  if (parsedPricing) {
    pricing = parsedPricing
  }

  return {
    titleId: ref.titleId,
    format: ref.format,
    title: details.title.trim() || '(untitled)',
    subtitle: details.subtitle.trim(),
    description,
    language: details.language,
    publishingStatus: details.publishingStatus,
    primaryAuthor: {
      firstName: details.primaryAuthorFirstName,
      lastName: details.primaryAuthorLastName,
    },
    contributors: details.contributors,
    publisherLabel: details.publisherLabel,
    editionNumber: details.editionNumber,
    seriesTitle: details.seriesTitle,
    seriesNumber: details.seriesNumber,
    categories: details.categories,
    keywords: details.keywords,
    readingInterestAgeMin: details.readingInterestAgeMin,
    readingInterestAgeMax: details.readingInterestAgeMax,
    homeMarketplace: details.homeMarketplace,
    isPublicDomain: details.isPublicDomain,
    isAdultContent: details.isAdultContent,
    largePrint: details.largePrint,
    isbn: content.isbn,
    imprint: content.imprint,
    trimSize: content.trimSize,
    inkAndPaper: content.inkAndPaper,
    interiorFileName: content.interiorFileName,
    coverFileName: content.coverFileName,
    pageCount: content.pageCount,
    manuscriptStatus: content.manuscriptStatus,
    coverStatus: content.coverStatus,
    asin: pricing.asin,
    listPriceUsd: pricing.listPriceUsd,
    prices: pricing.prices,
    territory: pricing.territory,
    royaltyPlan: pricing.royaltyPlan,
    fileSizeKb: pricing.fileSizeKb,
    kdpSelect: pricing.kdpSelect,
    syncedAt: new Date().toISOString(),
  }
}

export async function syncAllBookMetadata(): Promise<KdpMetadataCache> {
  return withKdpPages(async ({ action, parse }) => {
    const scan = await collectBookshelfRefs(action, parse)
    return syncBooksFromRefs(action, parse, scan)
  })
}

export type BookshelfListItem = {
  titleId: string
  format: KdpBookFormat
  title?: string
  asin?: string
}

export type BookshelfListResult = {
  refs: BookshelfListItem[]
  bookshelfRows: number
  uniqueTitleIds: number
  pagesScanned: number
}

/** Fast Bookshelf scan — title/format refs only, no per-book metadata fetch. */
export async function listBookshelf(): Promise<BookshelfListResult> {
  return withKdpPages(async ({ action, parse }) => {
    const scan = await collectBookshelfRefs(action, parse)
    return {
      refs: scan.refs,
      bookshelfRows: scan.bookshelfRows,
      uniqueTitleIds: scan.uniqueTitleIds,
      pagesScanned: scan.pagesScanned,
    }
  })
}

/** Refresh metadata for a single title/format and patch the local cache. */
export async function syncBookMetadata(
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpBookMetadata> {
  return withKdpPages(async ({ action, parse }) => {
    const meta = await fetchBookMetadata(action, parse, { titleId, format })
    if (!meta) {
      throw new KdpClientError(
        `Could not read metadata for ${titleId} (${format}).`,
      )
    }
    const { patchBookInCache } = await import('./metadataStore.js')
    return patchBookInCache(meta)
  })
}

async function syncBooksFromRefs(
  action: Page,
  parse: Page,
  scan: BookshelfScan,
): Promise<KdpMetadataCache> {
  const refs = scan.refs

  if (refs.length === 0) {
    throw new KdpClientError(
      'No titles found on your KDP Bookshelf. Check that your account has published or in-setup books.',
    )
  }

  const books: KdpBookMetadata[] = []
  let skippedCount = 0

  for (const ref of refs) {
    const meta = await fetchBookMetadata(action, parse, ref)
    if (meta) {
      books.push(meta)
    } else {
      skippedCount += 1
    }
  }

  if (books.length === 0) {
    throw new KdpClientError('Could not read metadata from any Bookshelf title.')
  }

  books.sort((a, b) => {
    const titleCmp = a.title.localeCompare(b.title)
    if (titleCmp !== 0) return titleCmp
    return FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format)
  })

  const stats: KdpMetadataSyncStats = {
    bookshelfRows: scan.bookshelfRows,
    uniqueTitleIds: scan.uniqueTitleIds,
    pagesScanned: scan.pagesScanned,
    discoveredRefs: refs.length,
    syncedCount: books.length,
    skippedCount,
  }

  const cache: KdpMetadataCache = {
    cacheVersion: METADATA_CACHE_VERSION,
    syncedAt: new Date().toISOString(),
    books,
    stats,
  }
  await writeMetadataCache(cache)
  return cache
}
