import * as XLSX from 'xlsx'
import { parseRoyaltyDateToIsoForFx } from './royaltyDate.js'

export type KdpRow = {
  title: string
  royalty: number
  /** ISO 4217 when present in the file (e.g. USD, JPY, EUR) */
  currency: string
  /** YYYY-MM-DD: sale/accrual period from the file, for historical FX */
  royaltyDateIso: string | null
  units: number
  /**
   * From the file when matched: prefers **Avg. Offer Price without tax** when that
   * column exists; otherwise list / customer-style price columns (same numeric field).
   */
  listPrice: number | null
  marketplace: string
  royaltyType: string
  asin: string
  /**
   * KENP pages read for a Kindle Unlimited row. Zero/absent for sales rows.
   * Present on synthetic rows materialized from the KENP sheet; kept on the
   * base row so KU-aware charts can distinguish pages from units.
   */
  kenpPages?: number
  /** True when the row came from the KENP sheet (estimated KU royalty). */
  isKu?: boolean
  raw: Record<string, unknown>
}

/** Raw KENP Read sheet row — pages only. Royalty is derived later from the user's per-page rate. */
export type KenpRow = {
  title: string
  asin: string
  marketplace: string
  /** Pages read in this row. Always ≥ 0. */
  kenpPages: number
  royaltyDateIso: string | null
  raw: Record<string, unknown>
}

export type ParseResult = {
  /** Primary label for the UI (one sheet or joined names) */
  sheetName: string
  sheetsUsed: string[]
  rows: KdpRow[]
  /** KENP Read rows, if the workbook had a KENP sheet. Empty otherwise. */
  kenpRows: KenpRow[]
  /** Name of the KENP sheet we parsed, if any (used for UI labeling). */
  kenpSheetName: string | null
  headers: string[]
  warnings: string[]
}

/** Royalty type label used for synthetic KU rows created from KENP pages. */
export const KU_ROYALTY_TYPE = 'Kindle Unlimited (KENP)'

function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function matrixFromSheet(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][]
}

/** Prefer specific unit metrics before generic “units” so we don’t bind Paid Units on summary rows. */
const UNITS_PATTERNS = [
  'net units sold',
  'net units',
  'kindle edition normalized page',
  'kenp read',
  'kenp',
  'pages read',
  'free units',
  'paid units',
  'units sold',
  'units',
]

const ROYALTY_PATTERNS = [
  'royalty', // matches "Royalty", "Royalty (USD)" — not "Avg. List Price"
  'earnings',
  'royalty in buyer currency',
  'net royalty',
  'net proceeds',
  'royalty price',
  'estimated royalty',
  'payout',
]

const TITLE_PATTERNS = [
  'book title',
  'title',
  'product title',
  'name',
  'item name',
]

const MARKET_PATTERNS = [
  'marketplace',
  'country',
  'store',
  'region',
  'sales channel',
]
const TYPE_PATTERNS = [
  'transaction type',
  'royalty type',
  'transaction',
  'type',
  'line item',
]
const ASIN_PATTERNS = ['asin', 'isbn', 'asin/isbn', 'isbn/asin']

/** Prefer columns that are clearly list/customer price, not royalty. */
const LIST_PRICE_EXCLUDE = /royalty|payout|net proceeds|earnings|proceeds/i

/**
 * KDP Combined / royalty sheets often expose both **Avg. List Price** and **Avg. Offer
 * Price without tax**. Offer price reflects promos/discounts better — scan these first.
 */
const LIST_PRICE_OFFER_PATTERNS = [
  'avg. offer price without tax',
  'average offer price without tax',
  'avg. offer price',
  'average offer price',
  'offer price without tax',
] as const

const LIST_PRICE_PATTERNS = [
  'list price',
  'avg. list',
  'average list',
  'customer price',
  'your price',
  'digital list',
  'suggested digital list',
] as const

function colIndexListPrice(headers: string[]): number | null {
  const norm = headers.map((h) => String(h).trim()).map(normalizeHeader)

  const matchColumn = (patterns: readonly string[]): number | null => {
    for (let i = 0; i < norm.length; i++) {
      const h = norm[i]!
      if (!h) continue
      if (LIST_PRICE_EXCLUDE.test(h)) continue
      for (const p of patterns) {
        if (h.includes(p) || h === p) {
          if (p === 'your price' && h.includes('royalt')) continue
          return i
        }
      }
    }
    return null
  }

  const offer = matchColumn(LIST_PRICE_OFFER_PATTERNS)
  if (offer !== null) return offer
  return matchColumn(LIST_PRICE_PATTERNS)
}
const CURRENCY_PATTERNS = [
  'currency',
  'royalty currency',
  'payout currency',
  'currency code',
]
const ROYALTY_DATE_PATTERNS = [
  'royalty date',
  'payout month',
  'revenue month',
  'accrual month',
  'revenue month (utc)',
]

/**
 * KENP page-count columns on the dedicated KENP Read sheet. Ordered most-
 * specific first so we don't accidentally bind a different "pages" column.
 */
const KENP_PAGES_PATTERNS = [
  'kindle edition normalized page (kenp) read',
  'kindle edition normalized page',
  'kenp read',
  'kenp pages read',
  'kenp',
  'pages read',
]

/** Sheet names that typically hold the KENP detail rows. */
const KENP_SHEET_NAME = /kenp|kindle\s*edition\s*normalized/i

const SKIP_SHEET_NAME =
  /report definition|report definitions|definitions? only/i

const COMBINED_SHEET = /(^|[^a-z])combined(\s+sales|[^a-z]|$)/i
const ROLLUP_SHEET = /^(summary|totals?)$/i
const DISJOINT_ROYALTY_SHEET =
  /^(ebook|paperback|hardcover|audiobook|audio\s*book).*(royalt|earnings)|.*(ebook|paperback|hardcover|audiobook).*(royalt|earnings)/i

function scoreHeaderRow(cells: unknown[]): number {
  const norm = cells.map(normalizeHeader).filter(Boolean)
  let score = 0
  for (const c of norm) {
    if (ROYALTY_PATTERNS.some((p) => c.includes(p))) score += 3
    if (UNITS_PATTERNS.some((p) => c === p || c.includes(p))) score += 2
    if (TITLE_PATTERNS.some((p) => c === p || c.includes('title'))) score += 2
    if (MARKET_PATTERNS.some((p) => c.includes(p))) score += 1
    if (TYPE_PATTERNS.some((p) => c.includes(p))) score += 1
    if (c.includes('asin') || c.includes('isbn')) score += 1
  }
  return score
}

function findHeaderRow(matrix: unknown[][]): number {
  let best = 0
  let bestIdx = 0
  const limit = Math.min(matrix.length, 60)
  for (let i = 0; i < limit; i++) {
    const row = matrix[i] ?? []
    const s = scoreHeaderRow(row)
    if (s > best) {
      best = s
      bestIdx = i
    }
  }
  return best >= 3 ? bestIdx : -1
}

function colIndex(headers: string[], patterns: string[]): number | null {
  const norm = headers.map(normalizeHeader)
  for (const p of patterns) {
    const pl = p.toLowerCase()
    const idx = norm.findIndex(
      (h) => h && (h === pl || h.includes(pl) || h.startsWith(`${pl} `)),
    )
    if (idx >= 0) return idx
  }
  return null
}

/** Do not use date/percent/label columns as the currency amount. */
const ROYALTY_EXCLUDE_H =
  /royalty\s*(date|day|time|month|year|range|period|start|end|report|type|rate|split|model|class|status)\b|report\s*royalty|period\s*royalty|est\.?\s*royalty|historical/i

function colIndexRoyalty(headers: string[]): number | null {
  const norm = headers.map((h) => String(h).trim())
  const nlow = norm.map((h) => normalizeHeader(h))

  const isAmountCol = (h: string) => h && !ROYALTY_EXCLUDE_H.test(h)

  // Prefer a plain `Royalty` (with optional ` (CCY)`) or known payout synonyms.
  const direct = nlow.findIndex(
    (h) =>
      isAmountCol(h) &&
      /^(earnings|payout|net proceeds|net royalty|royalty)(\s+|\s*\([^)]+\)\s*)?$/.test(
        h,
      ),
  )
  if (direct >= 0) return direct

  for (const p of ROYALTY_PATTERNS) {
    const pl = p.toLowerCase()
    const idx = nlow.findIndex((h) => {
      if (!h || !isAmountCol(h)) return false
      if (h === pl) return true
      if (h.includes(pl)) {
        if (pl.length <= 3) return h === pl
        return true
      }
      return false
    })
    if (idx >= 0) return idx
  }
  return null
}

function hasTitleAndRoyaltyColumns(headers: string[]): boolean {
  return (
    colIndex(headers, TITLE_PATTERNS) !== null &&
    colIndexRoyalty(headers) !== null
  )
}

function parseNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  let s = String(v).trim()
  if (!s) return 0
  s = s.replace(/[$£€₹¥\s\u00a0]/g, '')
  // European: 1.234,56 or 1 234,56
  if (/^[\d.]+,\d{1,4}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/\d+,\d{1,2}$/.test(s) && !/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, '.')
  }
  s = s.replace(/[()]/g, '')
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function rowToObjects(
  matrix: unknown[][],
  headerIdx: number,
): { headers: string[]; objects: Record<string, unknown>[] } {
  const headerCells = matrix[headerIdx] ?? []
  const headers = headerCells.map((c) => String(c ?? '').trim())
  const objects: Record<string, unknown>[] = []
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? []
    if (line.every((c) => String(c ?? '').trim() === '')) continue
    const o: Record<string, unknown> = {}
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c}`
      if (!key) continue
      o[key] = line[c]
    }
    objects.push(o)
  }
  return { headers, objects }
}

function sheetDataRowCount(
  matrix: unknown[][],
  headerIdx: number,
): number {
  let n = 0
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? []
    if (!line.every((c) => String(c ?? '').trim() === '')) n++
  }
  return n
}

type SheetPick = { name: string; score: number; hasDetail: boolean }

function scoreDetailSheet(
  name: string,
  matrix: unknown[][],
  headerIdx: number,
  rowCount: number,
): number {
  const row = headerIdx >= 0 ? (matrix[headerIdx] ?? []) : []
  const base = scoreHeaderRow(row)
  const headers = (matrix[headerIdx] ?? []).map((c) => String(c ?? '').trim())
  const hasDetail = hasTitleAndRoyaltyColumns(headers)
  const lower = name.toLowerCase()
  let s = base + (hasDetail ? 40 : 0) + Math.min(rowCount, 50_000) * 0.0001
  if (COMBINED_SHEET.test(lower)) s += 25
  if (lower.includes('royalty') && lower.includes('order')) s += 3
  if (ROLLUP_SHEET.test(lower) || /monthly|by month|total/i.test(lower))
    s -= 45
  if (lower.includes('summary') && !hasDetail) s -= 60
  if (SKIP_SHEET_NAME.test(lower)) s -= 10_000
  return s
}

function bestSheetName(workbook: XLSX.WorkBook): string {
  const bestName = workbook.SheetNames[0] ?? ''
  let best: SheetPick = { name: bestName, score: -1e9, hasDetail: false }
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const matrix = matrixFromSheet(sheet)
    const hi = findHeaderRow(matrix)
    if (hi < 0) continue
    const n = sheetDataRowCount(matrix, hi)
    const s = scoreDetailSheet(name, matrix, hi, n)
    const headers = (matrix[hi] ?? []).map((c) => String(c ?? '').trim())
    const hasDetail = hasTitleAndRoyaltyColumns(headers)
    if (s > best.score || (s === best.score && hasDetail && !best.hasDetail)) {
      best = { name, score: s, hasDetail }
    }
  }
  return best.name
}

function selectSheetsToParse(workbook: XLSX.WorkBook): string[] {
  const names = workbook.SheetNames
  if (names.length === 0) return []

  const byName: Record<string, XLSX.WorkSheet> = { ...workbook.Sheets }
  const detailSheets: string[] = []
  for (const name of names) {
    if (SKIP_SHEET_NAME.test(name)) continue
    const sh = byName[name]
    if (!sh) continue
    const matrix = matrixFromSheet(sh)
    const hi = findHeaderRow(matrix)
    if (hi < 0) continue
    const headers = (matrix[hi] ?? []).map((c) => String(c ?? '').trim())
    if (hasTitleAndRoyaltyColumns(headers) && sheetDataRowCount(matrix, hi) > 0) {
      if (COMBINED_SHEET.test(name) || name.toLowerCase().includes('combined sales'))
        return [name]
    }
  }

  for (const name of names) {
    if (SKIP_SHEET_NAME.test(name)) continue
    const sh = byName[name]
    if (!sh) continue
    if (!DISJOINT_ROYALTY_SHEET.test(name)) continue
    const matrix = matrixFromSheet(sh)
    const hi = findHeaderRow(matrix)
    if (hi < 0) continue
    const headers = (matrix[hi] ?? []).map((c) => String(c ?? '').trim())
    if (hasTitleAndRoyaltyColumns(headers) && sheetDataRowCount(matrix, hi) > 0) {
      detailSheets.push(name)
    }
  }
  if (detailSheets.length > 0) return detailSheets

  return [bestSheetName(workbook)]
}

function buildRows(
  objects: Record<string, unknown>[],
  headers: string[],
): KdpRow[] {
  const iTitle = colIndex(headers, TITLE_PATTERNS)
  const iRoyalty = colIndexRoyalty(headers)
  const iUnits = colIndex(headers, UNITS_PATTERNS)
  const iMarket = colIndex(headers, MARKET_PATTERNS)
  const iType = colIndex(headers, TYPE_PATTERNS)
  const iAsin = colIndex(headers, ASIN_PATTERNS)
  const iListPrice = colIndexListPrice(headers)
  const iCurrency = colIndex(headers, CURRENCY_PATTERNS)
  const iRoyaltyDate = colIndex(headers, ROYALTY_DATE_PATTERNS)
  const iPeriod = colIndex(headers, [
    'date',
    'order date',
    'period',
    'month',
  ])

  const rows: KdpRow[] = []
  for (const o of objects) {
    const cell = (idx: number | null) =>
      idx !== null && headers[idx] !== undefined
        ? o[headers[idx]!]
        : undefined

    let title = iTitle !== null ? String(cell(iTitle) ?? '').trim() : ''
    if (!title && iPeriod !== null) {
      title = String(cell(iPeriod) ?? '').trim() || ''
    }
    if (!title && iRoyaltyDate !== null) {
      title = String(cell(iRoyaltyDate) ?? '').trim() || ''
    }
    const royalty = iRoyalty !== null ? parseNumber(cell(iRoyalty)) : 0
    const units = iUnits !== null ? parseNumber(cell(iUnits)) : 0
    let listPrice: number | null = null
    if (iListPrice !== null) {
      const rawLp = cell(iListPrice)
      const t = String(rawLp ?? '').trim()
      if (t) {
        const n = parseNumber(rawLp)
        if (n > 0) listPrice = n
      }
    }
    const marketplace = iMarket !== null ? String(cell(iMarket) ?? '').trim() : ''
    const royaltyType =
      iType !== null ? String(cell(iType) ?? '').trim() : ''
    const asin = iAsin !== null ? String(cell(iAsin) ?? '').trim() : ''
    let currency = iCurrency !== null ? String(cell(iCurrency) ?? '').trim() : ''
    if (currency) {
      const u = currency.toUpperCase()
      if (/^[A-Z]{3}$/.test(u)) currency = u
    }

    const dateForFx =
      iRoyaltyDate !== null
        ? cell(iRoyaltyDate)
        : iPeriod !== null
          ? cell(iPeriod)
          : undefined
    const royaltyDateIso = parseRoyaltyDateToIsoForFx(
      dateForFx === undefined ? null : dateForFx,
    )

    if (!title && !royalty && !units) continue

    rows.push({
      title: title || '(no title)',
      royalty,
      currency,
      royaltyDateIso,
      units,
      listPrice,
      marketplace,
      royaltyType,
      asin,
      raw: o,
    })
  }
  return rows
}

function colIndexKenpPages(headers: string[]): number | null {
  const norm = headers.map(normalizeHeader)
  // Prefer exact / longest-first match so "KENP Read" wins over generic "Pages".
  for (const p of KENP_PAGES_PATTERNS) {
    const pl = p.toLowerCase()
    const idx = norm.findIndex((h) => h === pl || h.includes(pl))
    if (idx >= 0) return idx
  }
  return null
}

function hasTitleAndKenpColumns(headers: string[]): boolean {
  return (
    colIndex(headers, TITLE_PATTERNS) !== null &&
    colIndexKenpPages(headers) !== null
  )
}

/**
 * Find the KENP detail sheet in a KDP workbook. Returns null if no sheet has
 * Title + KENP-pages columns (e.g. some exports omit KU data entirely).
 */
function findKenpSheetName(workbook: XLSX.WorkBook): string | null {
  let best: { name: string; score: number } | null = null
  for (const name of workbook.SheetNames) {
    if (SKIP_SHEET_NAME.test(name)) continue
    const sh = workbook.Sheets[name]
    if (!sh) continue
    const matrix = matrixFromSheet(sh)
    const hi = findHeaderRow(matrix)
    if (hi < 0) continue
    const headers = (matrix[hi] ?? []).map((c) => String(c ?? '').trim())
    if (!hasTitleAndKenpColumns(headers)) continue
    // A dedicated KENP sheet won't usually have a royalty column — penalize
    // sheets that also look like sales sheets to avoid double-counting.
    const hasRoyalty = colIndexRoyalty(headers) !== null
    let s = 10
    if (KENP_SHEET_NAME.test(name)) s += 50
    if (!hasRoyalty) s += 20
    if (hasRoyalty) s -= 30
    if (best === null || s > best.score) best = { name, score: s }
  }
  return best?.name ?? null
}

function buildKenpRows(
  objects: Record<string, unknown>[],
  headers: string[],
): KenpRow[] {
  const iTitle = colIndex(headers, TITLE_PATTERNS)
  const iAsin = colIndex(headers, ASIN_PATTERNS)
  const iMarket = colIndex(headers, MARKET_PATTERNS)
  const iPages = colIndexKenpPages(headers)
  const iRoyaltyDate = colIndex(headers, ROYALTY_DATE_PATTERNS)
  const iPeriod = colIndex(headers, [
    'date',
    'order date',
    'period',
    'month',
  ])

  const rows: KenpRow[] = []
  for (const o of objects) {
    const cell = (idx: number | null) =>
      idx !== null && headers[idx] !== undefined
        ? o[headers[idx]!]
        : undefined

    const pages = iPages !== null ? parseNumber(cell(iPages)) : 0
    if (!(pages > 0)) continue

    const title = iTitle !== null ? String(cell(iTitle) ?? '').trim() : ''
    const asin = iAsin !== null ? String(cell(iAsin) ?? '').trim() : ''
    const marketplace = iMarket !== null ? String(cell(iMarket) ?? '').trim() : ''
    const dateForFx =
      iRoyaltyDate !== null
        ? cell(iRoyaltyDate)
        : iPeriod !== null
          ? cell(iPeriod)
          : undefined
    const royaltyDateIso = parseRoyaltyDateToIsoForFx(
      dateForFx === undefined ? null : dateForFx,
    )

    rows.push({
      title: title || '(no title)',
      asin,
      marketplace,
      kenpPages: pages,
      royaltyDateIso,
      raw: o,
    })
  }
  return rows
}

function parseKenpSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  warnings: string[],
): KenpRow[] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const matrix = matrixFromSheet(sheet)
  const headerIdx = findHeaderRow(matrix)
  if (headerIdx < 0) {
    warnings.push(`“${sheetName}”: KENP sheet header not recognized.`)
    return []
  }
  const { headers, objects } = rowToObjects(matrix, headerIdx)
  return buildKenpRows(objects, headers)
}

/**
 * Convert raw KENP pages into synthetic `KdpRow`s so the existing dashboard
 * (filters, FX pipeline, totals, top-books, etc.) treats estimated KU
 * royalties uniformly. Royalty = pages × `usdPerKenpPage`, currency = USD.
 */
export function kenpRowsToKdpRows(
  kenpRows: KenpRow[],
  usdPerKenpPage: number,
): KdpRow[] {
  if (kenpRows.length === 0) return []
  const rate =
    Number.isFinite(usdPerKenpPage) && usdPerKenpPage > 0 ? usdPerKenpPage : 0
  return kenpRows.map((k) => ({
    title: k.title,
    royalty: k.kenpPages * rate,
    currency: 'USD',
    royaltyDateIso: k.royaltyDateIso,
    units: 0,
    listPrice: null,
    marketplace: k.marketplace,
    royaltyType: KU_ROYALTY_TYPE,
    asin: k.asin,
    kenpPages: k.kenpPages,
    isKu: true,
    raw: k.raw,
  }))
}

function parseOneSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  warnings: string[],
): { rows: KdpRow[]; headers: string[]; warning?: string } {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { rows: [], headers: [], warning: `Missing sheet: ${sheetName}.` }
  }
  const matrix = matrixFromSheet(sheet)
  const headerIdx = findHeaderRow(matrix)
  if (headerIdx < 0) {
    warnings.push(
      `“${sheetName}”: no recognizable header. Try a KDP “Generate report” or Prior Months’ Royalties Excel download.`,
    )
    return { rows: [], headers: [] }
  }
  const { headers, objects } = rowToObjects(matrix, headerIdx)
  if (colIndexRoyalty(headers) === null && colIndex(headers, UNITS_PATTERNS) === null) {
    warnings.push(
      `“${sheetName}”: no royalty or units column matched. Column names may differ from typical KDP exports.`,
    )
  }
  return { rows: buildRows(objects, headers), headers }
}

/**
 * Parse an in-memory KDP report `.xlsx` workbook (sheets the parser recognizes).
 */
export function parseKdpWorkbook(workbook: XLSX.WorkBook): ParseResult {
  const warnings: string[] = []
  const kenpSheetName = findKenpSheetName(workbook)
  const sheetNames = selectSheetsToParse(workbook).filter(
    (n) => n !== kenpSheetName,
  )
  if (sheetNames.length === 0 && !kenpSheetName) {
    return {
      sheetName: '',
      sheetsUsed: [],
      rows: [],
      kenpRows: [],
      kenpSheetName: null,
      headers: [],
      warnings: ['No usable sheet with a header row was found.'],
    }
  }

  let allRows: KdpRow[] = []
  let headersOut: string[] = []
  for (const name of sheetNames) {
    const { rows, headers, warning } = parseOneSheet(
      workbook,
      name,
      warnings,
    )
    if (warning) warnings.push(warning)
    if (headers.length > 0 && headersOut.length === 0) headersOut = headers
    allRows = allRows.concat(rows)
  }

  const kenpRows = kenpSheetName
    ? parseKenpSheet(workbook, kenpSheetName, warnings)
    : []

  if (allRows.length === 0 && kenpRows.length === 0) {
    warnings.push('No data rows were parsed after the header row(s).')
  }

  const sheetName =
    sheetNames.length === 1
      ? sheetNames[0]!
      : sheetNames.join(' + ')

  return {
    sheetName,
    sheetsUsed: sheetNames,
    rows: allRows,
    kenpRows,
    kenpSheetName,
    headers: headersOut,
    warnings,
  }
}

/**
 * Read an Amazon KDP `.xlsx` from an ArrayBuffer.
 */
export function parseKdpXlsxBuffer(buf: ArrayBuffer): ParseResult {
  return parseKdpWorkbook(
    XLSX.read(buf, { type: 'array', cellDates: true }),
  )
}

/**
 * Read a KDP `.xlsx` file into a workbook (callers should enforce extension).
 */
export async function fileToKdpWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer()
  return XLSX.read(buf, { type: 'array', cellDates: true })
}
