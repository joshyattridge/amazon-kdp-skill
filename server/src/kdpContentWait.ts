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

export async function approveManuscriptIfNeeded(page: Page): Promise<boolean> {
  await dismissKdpOverlays(page)

  const previewBtn = page.locator('#print-preview-noconfirm-announce, #print-preview-announce').first()
  if (await previewBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await previewBtn.click({ timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(2000)
    await dismissKdpOverlays(page)
  }

  const approved = await page.evaluate(`(() => {
    const patterns = [/approve/i, /accept/i, /looks good/i, /confirm/i]
    for (const el of document.querySelectorAll('button, a.a-button-text, input[type="submit"]')) {
      const text = (el.value || el.textContent || '').trim()
      if (patterns.some((p) => p.test(text)) && !/preview/i.test(text)) {
        el.click()
        return text
      }
    }
    return null
  })()`)

  if (approved) {
    await page.waitForTimeout(2000)
    return true
  }
  return false
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
