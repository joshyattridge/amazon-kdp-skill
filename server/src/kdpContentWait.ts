import type { Page } from 'playwright'
import { fetchBookMetadata } from './kdpMetadata.js'
import type { KdpBookFormat } from './metadataStore.js'
import { KdpClientError } from './kdpClient.js'
import { clickKdpActionButton, dismissKdpOverlays } from './kdpUiHelpers.js'

export type ContentFileStatus = {
  manuscriptStatus: string
  coverStatus: string
  interiorFileName: string
  coverFileName: string
  isbn: string
}

const READ_CONTENT_STATUS_FN = `(() => {
  const read = (names) => {
    for (const name of names) {
      const el = document.querySelector('input[name="' + name + '"]')
      if (el && el.value && el.value.trim()) return el.value.trim()
    }
    return ''
  }
  const isbnEl = document.getElementById('print-isbn-free-isbn')
  return {
    manuscriptStatus: read(['data[print_book][publisher_interior][status]']),
    coverStatus: read(['data[print_book][publisher_cover][status]']),
    interiorFileName: read(['data[print_book][publisher_interior][source_file_name]']),
    coverFileName: read(['data[print_book][publisher_cover][source_file_name]']),
    isbn: (isbnEl && isbnEl.value ? isbnEl.value.trim() : '') || read(['data[view][free_isbn]']),
  }
})()`

export async function readContentFileStatus(page: Page): Promise<ContentFileStatus> {
  return page.evaluate(READ_CONTENT_STATUS_FN) as Promise<ContentFileStatus>
}

export function isSuccess(status: string): boolean {
  return /^success$/i.test(status.trim())
}

function isFailed(status: string): boolean {
  return /fail|error|reject/i.test(status.trim())
}

/** auto-kdp: expand "Upload a cover you already have (print-ready PDF)" before browse/upload. */
export async function selectPdfCoverUploadOption(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await dismissKdpOverlays(page)
  await page.evaluate(`(() => {
    const sel =
      '#data-print-book-publisher-cover-choice-accordion [data-a-accordion-row-name="UPLOAD"] a[data-action="a-accordion"]'
    const el = document.querySelector(sel)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.click()
    }
  })()`)
  await page.waitForTimeout(1500)
}

export async function waitForCoverUploadSuccessElement(
  page: Page,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 600_000
  await page.waitForSelector('#data-print-book-publisher-cover-file-upload-success', {
    timeout: timeoutMs,
  })
}

export async function waitForContentFileStatus(
  page: Page,
  kind: 'manuscript' | 'cover',
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<ContentFileStatus> {
  const timeoutMs = options.timeoutMs ?? 600_000
  const pollMs = options.pollMs ?? 5000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const status = await readContentFileStatus(page)
    const value = kind === 'manuscript' ? status.manuscriptStatus : status.coverStatus
    if (isSuccess(value)) return status
    if (isFailed(value)) {
      throw new Error(`KDP ${kind} processing failed with status: ${value || 'unknown'}`)
    }
    await page.waitForTimeout(pollMs)
  }

  const finalStatus = await readContentFileStatus(page)
  const value = kind === 'manuscript' ? finalStatus.manuscriptStatus : finalStatus.coverStatus
  if (!isSuccess(value)) {
    throw new Error(
      `Timed out waiting for ${kind} status SUCCESS (last: ${value || 'empty'}).`,
    )
  }
  return finalStatus
}

/** auto-kdp update-content.ts: Launch Previewer → approve on preview page → return to content. */
export async function approveManuscriptIfNeeded(page: Page): Promise<boolean> {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await dismissKdpOverlays(page)

  const previewVisible = await page
    .locator('#print-preview-noconfirm-announce, #print-preview-announce')
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false)
  if (!previewVisible) return false

  const urlBefore = page.url()
  await dismissKdpOverlays(page)
  await clickKdpActionButton(page, {
    buttonIds: ['print-preview-noconfirm-announce', 'print-preview-announce'],
    labels: ['Launch Previewer', 'Preview book', 'Preview'],
  }).catch(async () => {
    await page.evaluate(`(() => {
      const btn =
        document.getElementById('print-preview-noconfirm-announce') ||
        document.getElementById('print-preview-announce')
      if (btn) btn.click()
    })()`)
  })

  await page
    .waitForURL(/print-preview|printpreview|previewer/i, { timeout: 900_000 })
    .catch(() =>
      page.waitForFunction(
        `(before) => /print-preview|printpreview|previewer/i.test(window.location.href)`,
        urlBefore,
        { timeout: 900_000 },
      ),
    )
  await page.waitForTimeout(5000)
  await dismissKdpOverlays(page)

  const approved = (await page.evaluate(`(() => {
    const link = document.querySelector('#printpreview_approve_button_enabled a')
    if (link) {
      link.click()
      return true
    }
    for (const el of document.querySelectorAll('button, a.a-button-text, input[type="submit"]')) {
      const text = (el.value || el.textContent || '').replace(/\\s+/g, ' ').trim()
      if (/^Approve$/i.test(text)) {
        el.click()
        return true
      }
    }
    return false
  })()`)) as boolean

  if (!approved) return false

  await page
    .waitForURL(/title-setup.*content|print-preview/, { timeout: 120_000 })
    .catch(() => {})
  await page.waitForSelector('#save-announce, #save-and-continue-announce', {
    timeout: 120_000,
  }).catch(() => {})
  await page.waitForTimeout(2000)
  await dismissKdpOverlays(page)

  await page.evaluate(`(() => {
    const cb =
      document.querySelector('input[type="checkbox"][name*="generative"]') ||
      document.querySelector('#generative-ai-content-checkbox')
    if (cb && !cb.checked) cb.click()
  })()`)

  return true
}

export async function waitForContentReadyForPricing(
  page: Page,
  parsePage: Page,
  titleId: string,
  format: KdpBookFormat,
  options: { timeoutMs?: number } = {},
): Promise<{ manuscriptReady: boolean; coverReady: boolean }> {
  const timeoutMs = options.timeoutMs ?? 600_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const book = await fetchBookMetadata(page, parsePage, { titleId, format }).catch(() => null)
    const manuscriptReady = book?.manuscriptStatus === 'SUCCESS'
    const coverReady = book?.coverStatus === 'SUCCESS'
    if (manuscriptReady && coverReady) {
      return { manuscriptReady: true, coverReady: true }
    }
    await page.waitForTimeout(8000)
  }

  const book = await fetchBookMetadata(page, parsePage, { titleId, format }).catch(() => null)
  return {
    manuscriptReady: book?.manuscriptStatus === 'SUCCESS',
    coverReady: book?.coverStatus === 'SUCCESS',
  }
}

export async function saveContentPage(page: Page): Promise<void> {
  await dismissKdpOverlays(page)
  try {
    await clickKdpActionButton(page, {
      buttonIds: ['save-announce', 'save-and-continue-announce'],
      labels: ['Save as Draft', 'Save and Continue'],
    })
    return
  } catch {
    const draft = page.locator('#save-announce')
    if (await draft.count()) {
      await draft.click({ force: true, timeout: 15_000 })
      await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
      return
    }
    throw new KdpClientError('Could not save content page.')
  }
}
