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

const FILL_CONTENT_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../browser/fillBookContent.js'),
  'utf8',
)

export type KdpPrintContentSettings = {
  trimWidthIn?: number
  trimHeightIn?: number
  inkAndPaper?: string
  interiorHasBleed?: boolean
  coverFinish?: string
  hasPublisherBarcode?: boolean
  aiTextAmount?: string
  aiTextTool?: string
  aiImagesAmount?: string
  aiImagesTool?: string
  aiTranslationsAmount?: string
  containsAiContent?: boolean
  assignFreeIsbn?: boolean
}

export type KdpContentUploadOptions = {
  dryRun?: boolean
  printSettings?: KdpPrintContentSettings
}

export type KdpContentUploadResult = {
  titleId: string
  format: KdpBookFormat
  fileType: 'interior' | 'cover'
  dryRun: boolean
  uploaded: boolean
  errors: string[]
  book: KdpBookMetadata | null
}

export async function openContentPage(page: Page, format: KdpBookFormat, titleId: string): Promise<void> {
  const url = setupPageUrl(format, titleId, 'content')
  const response = await kdpGoto(page, url, { waitUntil: 'networkidle', timeout: 120_000 })
  if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()
  if (!response?.ok()) {
    throw new KdpClientError(`Could not open content page for ${titleId} (${format}).`)
  }
}

function contentInputSelector(fileType: 'interior' | 'cover'): string {
  if (fileType === 'interior') {
    return [
      '#data-print-book-publisher-interior-file-upload-AjaxInput',
      '#data-hardcover-book-publisher-interior-file-upload-AjaxInput',
      'input[type="file"][id*="interior"]',
      'input[type="file"][accept*="pdf"]',
    ].join(', ')
  }
  return [
    '#data-print-book-publisher-cover-file-upload-AjaxInput',
    '#data-print-book-publisher-cover-pdf-only-file-upload-AjaxInput',
    '#data-hardcover-book-publisher-cover-file-upload-AjaxInput',
    'input[type="file"][id*="cover"]',
  ].join(', ')
}

async function clickSaveOnContentPage(page: Page): Promise<void> {
  const patterns = [
    /^save and continue$/i,
    /^save as draft$/i,
    /^save changes$/i,
    /^save$/i,
  ]
  for (const pattern of patterns) {
    const button = page.getByRole('button', { name: pattern }).first()
    if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
      await button.click({ timeout: 15_000 })
      await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
      return
    }
  }
  throw new KdpClientError('Could not find Save button on content page.')
}

async function revealContentUpload(page: Page, fileType: 'interior' | 'cover'): Promise<void> {
  if (fileType === 'interior') {
    const btn = page.getByRole('button', { name: /^Upload manuscript$/i }).first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click({ timeout: 10_000 })
      await page.waitForTimeout(1500)
    }
  } else {
    const pdfBtn = page.locator('#data-print-book-publisher-cover-pdf-only-file-upload-browse-button-announce')
    if (await pdfBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pdfBtn.click({ timeout: 10_000 })
      await page.waitForTimeout(1500)
      return
    }
    const btn = page.getByRole('button', { name: /^Upload your cover file$/i }).first()
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click({ timeout: 10_000 })
      await page.waitForTimeout(1500)
    }
  }
}

export async function assignFreeKdpIsbn(page: Page): Promise<string | null> {
  const existing = await page.evaluate(
    () => (document.getElementById('print-isbn-free-isbn') as HTMLInputElement | null)?.value || null,
  )
  if (existing) return existing

  const link = page.getByRole('link', { name: /Get a free KDP ISBN/i }).first()
  if (await link.isVisible({ timeout: 5000 }).catch(() => false)) {
    await link.click({ timeout: 10_000 })
    await page.waitForTimeout(2000)
  }

  await page.evaluate(() => {
    const freeRadio = document.getElementById('print-isbn') as HTMLInputElement | null
    if (freeRadio) {
      freeRadio.checked = true
      freeRadio.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const btn = document.getElementById('free-isbn-confirm-button') as HTMLElement | null
    if (btn) {
      btn.scrollIntoView({ block: 'center' })
      btn.click()
    }
  })

  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000)
    const isbn = await page.evaluate(
      () => (document.getElementById('print-isbn-free-isbn') as HTMLInputElement | null)?.value || null,
    )
    if (isbn) return isbn
  }
  return null
}

async function waitForUploadSuccess(page: Page, fileName: string): Promise<void> {
  const base = fileName.replace(/\.[^.]+$/, '')
  await page
    .waitForFunction(
      (wanted) => {
        const text = document.body.innerText || ''
        return (
          new RegExp(`${wanted}.*uploaded successfully`, 'i').test(text) ||
          /uploaded successfully/i.test(text)
        )
      },
      base,
      { timeout: 600_000 },
    )
    .catch(() => {})
  await page.waitForTimeout(3000)
}

export type CompletePrintContentSpec = {
  interiorPath: string
  coverPath: string
  printSettings?: KdpPrintContentSettings
}

export async function completePrintContentOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
  spec: CompletePrintContentSpec,
): Promise<{ interiorUploaded: boolean; coverUploaded: boolean; isbn: string | null; errors: string[] }> {
  const errors: string[] = []

  if (format !== 'paperback') {
    throw new KdpClientError('completePrintContentOnPage supports paperback only.')
  }

  await openContentPage(page, format, titleId)

  const settings = { ...spec.printSettings, assignFreeIsbn: true }
  await fillPrintContentOnPage(page, settings)
  await page.waitForTimeout(2000)

  const isbn = await assignFreeKdpIsbn(page)
  if (!isbn) errors.push('Could not assign free KDP ISBN.')

  if (spec.interiorPath) {
    if (!fs.existsSync(spec.interiorPath)) {
      throw new KdpClientError(`Interior file not found: ${spec.interiorPath}`)
    }
    await revealContentUpload(page, 'interior')
    await page.locator('#data-print-book-publisher-interior-file-upload-AjaxInput').setInputFiles(spec.interiorPath)
    await waitForUploadSuccess(page, path.basename(spec.interiorPath))
  }

  if (spec.coverPath) {
    if (!fs.existsSync(spec.coverPath)) {
      throw new KdpClientError(`Cover file not found: ${spec.coverPath}`)
    }
    await revealContentUpload(page, 'cover')
    const coverInput = page.locator(
      '#data-print-book-publisher-cover-pdf-only-file-upload-AjaxInput, #data-print-book-publisher-cover-file-upload-AjaxInput',
    ).first()
    await coverInput.setInputFiles(spec.coverPath)
    await waitForUploadSuccess(page, path.basename(spec.coverPath))
  }

  await clickSaveOnContentPage(page)

  const parsePage = await page.context().newPage()
  let refreshed: KdpBookMetadata | null = null
  try {
    refreshed = await fetchBookMetadata(page, parsePage, { titleId, format })
  } finally {
    await parsePage.close().catch(() => {})
  }
  if (refreshed) await patchBookInCache(refreshed)

  const interiorName = path.basename(spec.interiorPath).replace(/\.[^.]+$/, '')
  const coverName = path.basename(spec.coverPath).replace(/\.[^.]+$/, '')

  return {
    interiorUploaded: Boolean(refreshed?.interiorFileName.includes(interiorName)),
    coverUploaded: Boolean(refreshed?.coverFileName.includes(coverName)),
    isbn: refreshed?.isbn || isbn,
    errors,
  }
}

export async function fillPrintContentOnPage(
  page: Page,
  settings: KdpPrintContentSettings,
): Promise<{ filled: string[]; skipped: string[] }> {
  return page.evaluate(
    `(${FILL_CONTENT_FN})(${JSON.stringify(settings)})`,
  ) as Promise<{ filled: string[]; skipped: string[] }>
}

export async function uploadBookContentOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
  fileType: 'interior' | 'cover',
  filePath: string,
  options: KdpContentUploadOptions & { skipOpen?: boolean } = {},
): Promise<KdpContentUploadResult> {
  const dryRun = options.dryRun ?? false

  if (!dryRun && !fs.existsSync(filePath)) {
    throw new KdpClientError(`File not found: ${filePath}`)
  }

  if (!options.skipOpen) {
    await openContentPage(page, format, titleId)
  }

  if (options.printSettings && Object.keys(options.printSettings).length > 0) {
    await fillPrintContentOnPage(page, options.printSettings)
    await page.waitForTimeout(2000)
  }

  if (!dryRun) {
    await revealContentUpload(page, fileType)
  }

  const selector = contentInputSelector(fileType)
  const input = page.locator(selector).first()
  const attached = await input.count().then((n) => n > 0).catch(() => false)

  if (!attached) {
    throw new KdpClientError(`Could not find ${fileType} file input on content page.`)
  }

  if (dryRun) {
    return {
      titleId,
      format,
      fileType,
      dryRun: true,
      uploaded: false,
      errors: [],
      book: null,
    }
  }

  await input.setInputFiles(filePath)
  await page.waitForTimeout(3000)

  await page
    .waitForFunction(
      `() => {
        const text = document.body.innerText || ''
        return /success|uploaded|processing|completed/i.test(text)
      }`,
      { timeout: 300_000 },
    )
    .catch(() => {})

  await clickSaveOnContentPage(page)

  const parsePage = await page.context().newPage()
  let refreshed: KdpBookMetadata | null = null
  try {
    refreshed = await fetchBookMetadata(page, parsePage, { titleId, format })
  } finally {
    await parsePage.close().catch(() => {})
  }

  if (refreshed) await patchBookInCache(refreshed)

  const fileName = path.basename(filePath)
  const uploaded =
    refreshed &&
    (fileType === 'interior'
      ? refreshed.interiorFileName.includes(fileName.replace(/\.[^.]+$/, ''))
      : refreshed.coverFileName.includes(fileName.replace(/\.[^.]+$/, '')))

  return {
    titleId,
    format,
    fileType,
    dryRun: false,
    uploaded: Boolean(uploaded),
    errors: uploaded ? [] : ['Upload could not be verified from refreshed metadata.'],
    book: refreshed,
  }
}

export async function uploadBookContent(
  titleId: string,
  format: KdpBookFormat,
  fileType: 'interior' | 'cover',
  filePath: string,
  options: KdpContentUploadOptions = {},
): Promise<KdpContentUploadResult> {
  return withKdpPage(async (page) =>
    uploadBookContentOnPage(page, titleId, format, fileType, filePath, options),
  )
}

export async function uploadBookContentBatch(
  uploads: Array<{
    titleId: string
    format: KdpBookFormat
    fileType: 'interior' | 'cover'
    filePath: string
  }>,
  options: KdpContentUploadOptions = {},
): Promise<{ results: KdpContentUploadResult[]; succeeded: number; failed: number }> {
  const results: KdpContentUploadResult[] = []
  for (let i = 0; i < uploads.length; i++) {
    if (i > 0) await kdpThrottle()
    try {
      results.push(
        await uploadBookContent(
          uploads[i].titleId,
          uploads[i].format,
          uploads[i].fileType,
          uploads[i].filePath,
          options,
        ),
      )
    } catch (e) {
      results.push({
        titleId: uploads[i].titleId,
        format: uploads[i].format,
        fileType: uploads[i].fileType,
        dryRun: options.dryRun ?? false,
        uploaded: false,
        errors: [e instanceof Error ? e.message : 'Upload failed.'],
        book: null,
      })
    }
  }
  return {
    results,
    succeeded: results.filter((r) => r.uploaded || (r.dryRun && r.errors.length === 0)).length,
    failed: results.filter((r) => !r.uploaded && !r.dryRun).length,
  }
}
