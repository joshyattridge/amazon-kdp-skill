import fs from 'node:fs/promises'
import path from 'node:path'
import { SESSION_DIR } from './config.js'

export type KdpBookFormat = 'paperback' | 'kindle' | 'hardcover'

export type KdpContributor = {
  role: string
  firstName: string
  lastName: string
}

export type KdpBookMetadata = {
  titleId: string
  format: KdpBookFormat
  title: string
  subtitle: string
  description: string
  language: string
  publishingStatus: string
  primaryAuthor: {
    firstName: string
    lastName: string
  }
  contributors: KdpContributor[]
  publisherLabel: string
  editionNumber: string
  seriesTitle: string
  seriesNumber: string
  categories: string[]
  keywords: string[]
  readingInterestAgeMin: string
  readingInterestAgeMax: string
  homeMarketplace: string
  isPublicDomain: boolean
  isAdultContent: boolean
  largePrint: boolean
  isbn: string
  imprint: string
  trimSize: string
  inkAndPaper: string
  interiorFileName: string
  coverFileName: string
  pageCount: string
  manuscriptStatus: string
  coverStatus: string
  asin: string
  listPriceUsd: string
  prices: Record<string, string>
  territory: string
  royaltyPlan: string
  fileSizeKb: string
  kdpSelect: boolean
  syncedAt: string
}

export type KdpMetadataSyncStats = {
  /** Rows in the Bookshelf table across all pages (includes format sub-rows). */
  bookshelfRows: number
  /** Unique KDP title IDs on Bookshelf. */
  uniqueTitleIds: number
  /** Bookshelf pages scanned (pagination). */
  pagesScanned: number
  /** Title/format pairs queued for metadata fetch. */
  discoveredRefs: number
  /** Metadata successfully read from a details page. */
  syncedCount: number
  /** Details pages that could not be read (empty or blocked). */
  skippedCount: number
}

export type KdpMetadataCache = {
  /** Bump when stored book shape or sync coverage changes. */
  cacheVersion?: number
  syncedAt: string
  books: KdpBookMetadata[]
  stats?: KdpMetadataSyncStats
}

export const METADATA_CACHE_VERSION = 2

const METADATA_FILE = path.join(SESSION_DIR, 'book-metadata.json')

/** Fill defaults for older cache entries missing expanded metadata fields. */
export function normalizeBookMetadata(
  raw: Partial<KdpBookMetadata> &
    Pick<KdpBookMetadata, 'titleId' | 'format' | 'title' | 'syncedAt'>,
): KdpBookMetadata {
  return {
    titleId: raw.titleId,
    format: raw.format,
    title: raw.title ?? '',
    subtitle: raw.subtitle ?? '',
    description: raw.description ?? '',
    language: raw.language ?? '',
    publishingStatus: raw.publishingStatus ?? '',
    primaryAuthor: {
      firstName: raw.primaryAuthor?.firstName ?? '',
      lastName: raw.primaryAuthor?.lastName ?? '',
    },
    contributors: Array.isArray(raw.contributors) ? raw.contributors : [],
    publisherLabel: raw.publisherLabel ?? '',
    editionNumber: raw.editionNumber ?? '',
    seriesTitle: raw.seriesTitle ?? '',
    seriesNumber: raw.seriesNumber ?? '',
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    readingInterestAgeMin: raw.readingInterestAgeMin ?? '',
    readingInterestAgeMax: raw.readingInterestAgeMax ?? '',
    homeMarketplace: raw.homeMarketplace ?? '',
    isPublicDomain: raw.isPublicDomain ?? false,
    isAdultContent: raw.isAdultContent ?? false,
    largePrint: raw.largePrint ?? false,
    isbn: raw.isbn ?? '',
    imprint: raw.imprint ?? '',
    trimSize: raw.trimSize ?? '',
    inkAndPaper: raw.inkAndPaper ?? '',
    interiorFileName: raw.interiorFileName ?? '',
    coverFileName: raw.coverFileName ?? '',
    pageCount: raw.pageCount ?? '',
    manuscriptStatus: raw.manuscriptStatus ?? '',
    coverStatus: raw.coverStatus ?? '',
    asin: raw.asin ?? '',
    listPriceUsd: raw.listPriceUsd ?? '',
    prices: raw.prices && typeof raw.prices === 'object' ? raw.prices : {},
    territory: raw.territory ?? '',
    royaltyPlan: raw.royaltyPlan ?? '',
    fileSizeKb: raw.fileSizeKb ?? '',
    kdpSelect: raw.kdpSelect ?? false,
    syncedAt: raw.syncedAt,
  }
}

export async function readMetadataCache(): Promise<KdpMetadataCache | null> {
  try {
    const raw = await fs.readFile(METADATA_FILE, 'utf8')
    const parsed = JSON.parse(raw) as KdpMetadataCache
    if (!parsed || !Array.isArray(parsed.books)) return null
    return {
      ...parsed,
      books: parsed.books.map((book) => normalizeBookMetadata(book)),
    }
  } catch {
    return null
  }
}

export async function writeMetadataCache(cache: KdpMetadataCache): Promise<void> {
  await fs.mkdir(SESSION_DIR, { recursive: true })
  await fs.writeFile(METADATA_FILE, JSON.stringify(cache, null, 2), 'utf8')
}

export async function removeMetadataCache(): Promise<void> {
  try {
    await fs.unlink(METADATA_FILE)
  } catch {
    /* no cache */
  }
}

/** Replace or insert one book record in the local cache after a metadata update. */
export async function patchBookInCache(book: KdpBookMetadata): Promise<KdpBookMetadata> {
  const normalized = normalizeBookMetadata(book)
  const existing = await readMetadataCache()
  const books = existing?.books ?? []
  const index = books.findIndex(
    (b) => b.titleId === normalized.titleId && b.format === normalized.format,
  )
  if (index >= 0) {
    books[index] = normalized
  } else {
    books.push(normalized)
  }
  books.sort((a, b) => {
    const titleCmp = a.title.localeCompare(b.title)
    if (titleCmp !== 0) return titleCmp
    const order = ['kindle', 'paperback', 'hardcover'] as const
    return order.indexOf(a.format) - order.indexOf(b.format)
  })
  await writeMetadataCache({
    cacheVersion: existing?.cacheVersion ?? METADATA_CACHE_VERSION,
    syncedAt: new Date().toISOString(),
    books,
    stats: existing?.stats,
  })
  return normalized
}
