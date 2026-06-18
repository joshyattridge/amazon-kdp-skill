import type { Page } from 'playwright'
import { KDP_API } from './config.js'
import { kdpFetchJson } from './kdpHttp.js'
import type { KdpBookFormat } from './metadataStore.js'

export type ReportsBookRef = {
  titleId: string
  format: KdpBookFormat
  title?: string
  asin?: string
}

type UnknownRecord = Record<string, unknown>

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function normalizeFormat(raw: unknown): KdpBookFormat | null {
  const s = asString(raw)?.toLowerCase()
  if (s === 'kindle' || s === 'paperback' || s === 'hardcover') return s
  if (s?.includes('ebook') || s?.includes('kindle')) return 'kindle'
  if (s?.includes('hardcover')) return 'hardcover'
  if (s?.includes('paperback') || s?.includes('print')) return 'paperback'
  return null
}

function titleIdFromRecord(row: UnknownRecord): string | undefined {
  return (
    asString(row.titleId) ??
    asString(row.titleID) ??
    asString(row.bookId) ??
    asString(row.id)
  )
}

function asinFromRecord(row: UnknownRecord): string | undefined {
  return asString(row.asin) ?? asString(row.ASIN)
}

function collectBookRows(node: unknown, out: UnknownRecord[]): void {
  if (!node) return
  if (Array.isArray(node)) {
    for (const item of node) collectBookRows(item, out)
    return
  }
  if (typeof node !== 'object') return

  const row = node as UnknownRecord
  const titleId = titleIdFromRecord(row)
  const asin = asinFromRecord(row)
  if (titleId || asin) {
    out.push(row)
  }

  for (const value of Object.values(row)) {
    if (value && typeof value === 'object') {
      collectBookRows(value, out)
    }
  }
}

/** Extract title/format refs from kdpreports booksMetadata JSON (shape varies). */
export function parseBooksMetadataRefs(data: unknown): ReportsBookRef[] {
  const rows: UnknownRecord[] = []
  collectBookRows(data, rows)

  const refs = new Map<string, ReportsBookRef>()
  for (const row of rows) {
    const titleId = titleIdFromRecord(row)
    if (!titleId || !/^[A-Z0-9]{10,14}$/.test(titleId)) continue

    const formatsRaw = row.formats ?? row.availableFormats ?? row.bookFormats
    const formatList = Array.isArray(formatsRaw)
      ? formatsRaw
      : [row.format ?? row.bookFormat ?? row.mediaType ?? 'paperback']

    for (const fmtRaw of formatList) {
      const format =
        typeof fmtRaw === 'string'
          ? normalizeFormat(fmtRaw)
          : normalizeFormat((fmtRaw as UnknownRecord)?.format ?? (fmtRaw as UnknownRecord)?.type)
      if (!format) continue
      refs.set(`${titleId}:${format}`, {
        titleId,
        format,
        title: asString(row.title) ?? asString(row.bookTitle),
        asin: asinFromRecord(row),
      })
    }
  }

  return [...refs.values()]
}

export async function fetchReportsBooksMetadata(page: Page): Promise<ReportsBookRef[]> {
  const data = await kdpFetchJson<unknown>(page, KDP_API.booksMetadata)
  if (!data) return []
  return parseBooksMetadataRefs(data)
}

export async function fetchReportsCustomerMetadata(page: Page): Promise<unknown | null> {
  return kdpFetchJson<unknown>(page, KDP_API.customerMetadata)
}

export async function fetchAccountCatalogSize(page: Page): Promise<number | null> {
  const reportsCount = await fetchReportsCatalogSize(page)
  if (reportsCount != null) return reportsCount

  const data = await kdpFetchJson<{
    customerAccountInfoModel?: { catalogSize?: number }
  }>(page, KDP_API.accountInfo)
  const size = data?.customerAccountInfoModel?.catalogSize
  return typeof size === 'number' && size > 0 ? size : null
}

type ReportsMetadataResponse = {
  reportsMetadata?: {
    books?: Record<string, unknown>
  }
}

/** Book count from kdpreports reportsMetadata (more reliable than accountInfo catalogSize). */
export async function fetchReportsCatalogSize(page: Page): Promise<number | null> {
  const data = await kdpFetchJson<ReportsMetadataResponse>(page, KDP_API.reportsMetadata)
  const books = data?.reportsMetadata?.books
  if (!books || typeof books !== 'object') return null
  return Object.keys(books).length
}

export async function fetchReportsMetadata(page: Page): Promise<ReportsMetadataResponse | null> {
  return kdpFetchJson<ReportsMetadataResponse>(page, KDP_API.reportsMetadata)
}
