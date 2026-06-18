#!/usr/bin/env node
/**
 * Export cached KDP book metadata to a spreadsheet.
 *
 * Usage:
 *   node scripts/export-metadata-xlsx.mjs [output.xlsx]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cachePath = path.join(repoRoot, '.kdp-session', 'book-metadata.json')

const BASE_COLUMNS = [
  'titleId',
  'format',
  'title',
  'subtitle',
  'description',
  'authorFirstName',
  'authorLastName',
  'contributors',
  'language',
  'publishingStatus',
  'publisherLabel',
  'editionNumber',
  'seriesTitle',
  'seriesNumber',
  'categories',
  'keyword1',
  'keyword2',
  'keyword3',
  'keyword4',
  'keyword5',
  'keyword6',
  'keyword7',
  'readingInterestAgeMin',
  'readingInterestAgeMax',
  'homeMarketplace',
  'isPublicDomain',
  'isAdultContent',
  'largePrint',
  'isbn',
  'imprint',
  'trimSize',
  'inkAndPaper',
  'interiorFileName',
  'coverFileName',
  'pageCount',
  'manuscriptStatus',
  'coverStatus',
  'asin',
  'listPriceUsd',
  'territory',
  'royaltyPlan',
  'fileSizeKb',
  'kdpSelect',
  'syncedAt',
]

function formatContributors(contributors) {
  if (!Array.isArray(contributors) || contributors.length === 0) return ''
  return contributors
    .map((c) => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
      return c.role ? `${c.role}: ${name}` : name
    })
    .filter(Boolean)
    .join('; ')
}

function bookToRow(book, priceKeys) {
  const row = {
    titleId: book.titleId ?? '',
    format: book.format ?? '',
    title: book.title ?? '',
    subtitle: book.subtitle ?? '',
    description: book.description ?? '',
    authorFirstName: book.primaryAuthor?.firstName ?? '',
    authorLastName: book.primaryAuthor?.lastName ?? '',
    contributors: formatContributors(book.contributors),
    language: book.language ?? '',
    publishingStatus: book.publishingStatus ?? '',
    publisherLabel: book.publisherLabel ?? '',
    editionNumber: book.editionNumber ?? '',
    seriesTitle: book.seriesTitle ?? '',
    seriesNumber: book.seriesNumber ?? '',
    categories: Array.isArray(book.categories) ? book.categories.join('; ') : '',
    keyword1: book.keywords?.[0] ?? '',
    keyword2: book.keywords?.[1] ?? '',
    keyword3: book.keywords?.[2] ?? '',
    keyword4: book.keywords?.[3] ?? '',
    keyword5: book.keywords?.[4] ?? '',
    keyword6: book.keywords?.[5] ?? '',
    keyword7: book.keywords?.[6] ?? '',
    readingInterestAgeMin: book.readingInterestAgeMin ?? '',
    readingInterestAgeMax: book.readingInterestAgeMax ?? '',
    homeMarketplace: book.homeMarketplace ?? '',
    isPublicDomain: book.isPublicDomain ?? false,
    isAdultContent: book.isAdultContent ?? false,
    largePrint: book.largePrint ?? false,
    isbn: book.isbn ?? '',
    imprint: book.imprint ?? '',
    trimSize: book.trimSize ?? '',
    inkAndPaper: book.inkAndPaper ?? '',
    interiorFileName: book.interiorFileName ?? '',
    coverFileName: book.coverFileName ?? '',
    pageCount: book.pageCount ?? '',
    manuscriptStatus: book.manuscriptStatus ?? '',
    coverStatus: book.coverStatus ?? '',
    asin: book.asin ?? '',
    listPriceUsd: book.listPriceUsd ?? '',
    territory: book.territory ?? '',
    royaltyPlan: book.royaltyPlan ?? '',
    fileSizeKb: book.fileSizeKb ?? '',
    kdpSelect: book.kdpSelect ?? false,
    syncedAt: book.syncedAt ?? '',
  }

  for (const key of priceKeys) {
    row[`price_${key}`] = book.prices?.[key] ?? ''
  }

  return row
}

async function main() {
  let cacheRaw
  try {
    cacheRaw = await fs.readFile(cachePath, 'utf8')
  } catch {
    console.error('No metadata cache found. Run: npm run sync:metadata')
    process.exit(1)
  }

  const cache = JSON.parse(cacheRaw)
  const books = Array.isArray(cache.books) ? cache.books : []
  if (books.length === 0) {
    console.error('Metadata cache is empty. Run: npm run sync:metadata')
    process.exit(1)
  }

  const priceKeys = [...new Set(books.flatMap((b) => Object.keys(b.prices || {})))].sort()
  const columns = [...BASE_COLUMNS, ...priceKeys.map((k) => `price_${k}`)]

  const rows = books.map((book) => bookToRow(book, priceKeys))
  const sheet = XLSX.utils.json_to_sheet(rows, { header: columns })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Book Metadata')

  const outPath = path.resolve(
    process.argv[2] || path.join(repoRoot, 'output', `kdp-book-metadata-${new Date().toISOString().slice(0, 10)}.xlsx`),
  )
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  await fs.writeFile(outPath, buffer)

  console.log(
    JSON.stringify(
      {
        output: outPath,
        books: books.length,
        cacheSyncedAt: cache.syncedAt,
        columns: columns.length,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
