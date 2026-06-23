import XLSX from 'xlsx'
import type { PublishBookRequest } from '../server/src/kdpPublish.js'
import type { KdpPrintContentSettings } from '../server/src/kdpContentUpdate.js'
import type { KdpBookFormat } from '../server/src/metadataStore.js'
import { sanitizeDescriptionHtml } from '../server/src/kdpMetadataUpdate.js'

export type KdpUploaderFormat = 'paperback' | 'hardcover' | 'ebook'

const SHEET_BY_FORMAT: Record<KdpUploaderFormat, string> = {
  paperback: 'Paperbacks',
  hardcover: 'Hardcovers',
  ebook: 'eBooks',
}

function yesNo(value: unknown): boolean | undefined {
  const s = String(value ?? '').trim().toUpperCase()
  if (s === 'YES' || s === 'Y' || s === 'TRUE') return true
  if (s === 'NO' || s === 'N' || s === 'FALSE') return false
  return undefined
}

function parseCategoryPath(raw: unknown): string[] | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const segments = text
    .split(/[›>»/|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments[0]?.toLowerCase() === 'books') segments.shift()
  // KDP picker often omits generic leaf labels like "General".
  while (segments.length > 1 && /^general$/i.test(segments[segments.length - 1]!)) {
    segments.pop()
  }
  return segments.length > 0 ? segments : null
}

function collectKeywords(row: Record<string, unknown>): string[] {
  const keywords: string[] = []
  for (let i = 1; i <= 7; i++) {
    const kw = String(row[`Keywords ${i}`] ?? '').trim()
    if (kw) keywords.push(kw)
  }
  return keywords
}

function mapInkAndPaper(raw: unknown): string | undefined {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return undefined
  if (text.includes('premium') && text.includes('color')) return 'premium_color'
  if (text.includes('standard') && text.includes('color')) return 'standard_color'
  if (text.includes('black') && text.includes('white')) return 'black_and_white'
  return undefined
}

function mapCoverFinish(raw: unknown): string | undefined {
  const text = String(raw ?? '').trim().toLowerCase()
  if (text.includes('gloss')) return 'GLOSSY'
  if (text.includes('matte')) return 'MATTE'
  return undefined
}

function mapBleed(raw: unknown): boolean | undefined {
  const text = String(raw ?? '').trim().toLowerCase()
  if (text.includes('bleed') && !text.includes('no bleed')) return true
  if (text.includes('no bleed')) return false
  return undefined
}

function resolveFilePath(baseDir: string, fileName: unknown): string | undefined {
  const name = String(fileName ?? '').trim()
  if (!name) return undefined
  return `${baseDir.replace(/\/$/, '')}/${name}`
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]
}

export type KdpUploaderToPublishOptions = {
  /** Directory containing Cover/Manuscript PDFs referenced in the workbook */
  assetsDir: string
  format?: KdpUploaderFormat
  /** Match Title column (case-insensitive substring) */
  titleMatch?: string
  dryRun?: boolean
  publish?: boolean
}

/**
 * Convert a KDP Uploader `.xlsx` row into a publish wizard spec.
 */
export function kdpUploaderRowToPublishSpec(
  row: Record<string, unknown>,
  options: KdpUploaderToPublishOptions,
): PublishBookRequest {
  const format: KdpBookFormat =
    options.format === 'hardcover'
      ? 'hardcover'
      : options.format === 'ebook'
        ? 'kindle'
        : 'paperback'

  const categories = ['Category 1', 'Category 2', 'Category 3']
    .map((key) => parseCategoryPath(row[key]))
    .filter((p): p is string[] => p !== null)
    .map((path) => ({ path }))

  const listPrice = row['Amazon.com']
  const listPriceUsd =
    listPrice !== undefined && String(listPrice).trim() !== ''
      ? String(listPrice)
      : undefined

  const printSettings: KdpPrintContentSettings = {}
  const width = Number(row['Width (in)'])
  const height = Number(row['Height (in)'])
  if (Number.isFinite(width) && width > 0) printSettings.trimWidthIn = width
  if (Number.isFinite(height) && height > 0) printSettings.trimHeightIn = height

  const ink = mapInkAndPaper(row['Interior & paper type'])
  if (ink) printSettings.inkAndPaper = ink

  const bleed = mapBleed(row['Bleed Settings'])
  if (bleed !== undefined) printSettings.interiorHasBleed = bleed

  const finish = mapCoverFinish(row['Paperback cover finish'])
  if (finish) printSettings.coverFinish = finish

  const barcode = yesNo(row['Cover include barcode'])
  if (barcode !== undefined) printSettings.hasPublisherBarcode = barcode

  const aiGenerated = yesNo(row['AI-Generated'])
  if (aiGenerated !== undefined) printSettings.containsAiContent = aiGenerated

  const aiText = String(row['AI-Texts'] ?? '').trim()
  if (aiText && aiText.toUpperCase() !== 'NONE') printSettings.aiTextAmount = aiText

  const aiTextTool = String(row['AI-Texts-Tool'] ?? row['AI-Texts-Tools'] ?? '').trim()
  if (aiTextTool) printSettings.aiTextTool = aiTextTool

  const aiImages = String(row['AI-Images'] ?? '').trim()
  if (aiImages && aiImages.toUpperCase() !== 'NONE') printSettings.aiImagesAmount = aiImages

  const aiImagesTool = String(row['AI-Images-Tools'] ?? row['AI-Images-Tool'] ?? '').trim()
  if (aiImagesTool) printSettings.aiImagesTool = aiImagesTool

  const aiTranslations = String(row['AI-Translations'] ?? '').trim()
  if (aiTranslations && aiTranslations.toUpperCase() !== 'NONE') {
    printSettings.aiTranslationsAmount = aiTranslations
  }

  const publicDomain = yesNo(row['Public Domain'])
  const largePrint = yesNo(row['Large print'])

  return {
    format,
    create: true,
    dryRun: options.dryRun ?? true,
    publish: options.publish ?? false,
    details: {
      title: String(row.Title ?? '').trim(),
      subtitle: String(row.Subtitle ?? '').trim() || undefined,
      descriptionHtml: String(row.Description ?? '').trim()
        ? sanitizeDescriptionHtml(String(row.Description ?? '').trim())
        : undefined,
      language: String(row.Language ?? 'English').trim(),
      primaryAuthor: {
        firstName: String(row['Author first name'] ?? '').trim(),
        lastName: String(row['Author last name'] ?? '').trim(),
      },
      keywords: collectKeywords(row),
      isPublicDomain: publicDomain ?? false,
      isAdultContent: false,
      largePrint: largePrint ?? false,
      seriesTitle: String(row.Series ?? '').trim() || undefined,
      publisherLabel: String(row.Imprint ?? '').trim() || undefined,
    },
    categories,
    content: {
      interiorPath: resolveFilePath(options.assetsDir, row.Manuscript),
      coverPath: resolveFilePath(options.assetsDir, row.Cover),
      printSettings: Object.keys(printSettings).length > 0 ? printSettings : undefined,
    },
    pricing: listPriceUsd
      ? {
          listPriceUsd,
          territory: 'worldwide',
        }
      : undefined,
  }
}

export function findKdpUploaderRow(
  workbook: XLSX.WorkBook,
  options: Pick<KdpUploaderToPublishOptions, 'format' | 'titleMatch'>,
): Record<string, unknown> | null {
  const format = options.format ?? 'paperback'
  const sheetName = SHEET_BY_FORMAT[format]
  const rows = sheetRows(workbook, sheetName)
  const match = (options.titleMatch ?? '').trim().toLowerCase()
  if (!match) return rows[0] ?? null
  return (
    rows.find((row) => String(row.Title ?? '').toLowerCase().includes(match)) ?? null
  )
}

export function parseKdpUploaderWorkbook(
  workbook: XLSX.WorkBook,
  options: KdpUploaderToPublishOptions,
): PublishBookRequest {
  const row = findKdpUploaderRow(workbook, options)
  if (!row) {
    throw new Error(
      `No matching row in ${SHEET_BY_FORMAT[options.format ?? 'paperback']} for title "${options.titleMatch ?? ''}".`,
    )
  }
  return kdpUploaderRowToPublishSpec(row, options)
}

export function parseKdpUploaderFile(
  filePath: string,
  options: KdpUploaderToPublishOptions,
): PublishBookRequest {
  const workbook = XLSX.readFile(filePath)
  return parseKdpUploaderWorkbook(workbook, options)
}
