import type { KdpBookMetadata } from './metadataStore.js'

export type MetadataAuditIssue = {
  titleId: string
  format: string
  title: string
  field: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

export type MetadataAuditResult = {
  bookCount: number
  issueCount: number
  issues: MetadataAuditIssue[]
  summary: {
    emptyKeywords: number
    shortDescriptions: number
    missingCategories: number
    missingAsin: number
    kdpSelectEnrolled: number
    noListPrice: number
  }
}

function pushIssue(
  issues: MetadataAuditIssue[],
  book: KdpBookMetadata,
  field: string,
  severity: MetadataAuditIssue['severity'],
  message: string,
): void {
  issues.push({
    titleId: book.titleId,
    format: book.format,
    title: book.title,
    field,
    severity,
    message,
  })
}

export function analyzeBookMetadata(books: KdpBookMetadata[]): MetadataAuditResult {
  const issues: MetadataAuditIssue[] = []
  const summary = {
    emptyKeywords: 0,
    shortDescriptions: 0,
    missingCategories: 0,
    missingAsin: 0,
    kdpSelectEnrolled: 0,
    noListPrice: 0,
  }

  for (const book of books) {
    const filledKeywords = book.keywords.filter((k) => k.trim()).length
    if (filledKeywords < 7) {
      summary.emptyKeywords += 1
      pushIssue(
        issues,
        book,
        'keywords',
        filledKeywords === 0 ? 'error' : 'warning',
        `Only ${filledKeywords}/7 keyword slots filled.`,
      )
    }

    for (let i = 0; i < book.keywords.length; i++) {
      const kw = book.keywords[i]?.trim() ?? ''
      if (kw && kw.length > 50) {
        pushIssue(
          issues,
          book,
          `keyword${i + 1}`,
          'error',
          `Keyword ${i + 1} exceeds 50 characters (${kw.length}).`,
        )
      }
    }

    if (book.description.trim().length < 100) {
      summary.shortDescriptions += 1
      pushIssue(
        issues,
        book,
        'description',
        'warning',
        `Description is only ${book.description.trim().length} characters.`,
      )
    }

    if (book.categories.length === 0) {
      summary.missingCategories += 1
      pushIssue(issues, book, 'categories', 'warning', 'No categories assigned.')
    }

    if (!book.asin.trim() && book.publishingStatus !== 'DRAFT') {
      summary.missingAsin += 1
      pushIssue(issues, book, 'asin', 'info', 'No ASIN in cached metadata.')
    }

    if (book.kdpSelect) {
      summary.kdpSelectEnrolled += 1
    }

    if (!book.listPriceUsd.trim() && book.format !== 'hardcover') {
      summary.noListPrice += 1
      pushIssue(issues, book, 'listPriceUsd', 'info', 'No US list price in cache.')
    }

    const dupes = new Set<string>()
    for (const kw of book.keywords) {
      const lower = kw.trim().toLowerCase()
      if (!lower) continue
      if (dupes.has(lower)) {
        pushIssue(issues, book, 'keywords', 'warning', `Duplicate keyword: "${kw}".`)
      }
      dupes.add(lower)
    }
  }

  return {
    bookCount: books.length,
    issueCount: issues.length,
    issues,
    summary,
  }
}
