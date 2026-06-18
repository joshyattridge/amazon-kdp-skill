import type { Page } from 'playwright'
import { KdpAuthError, KdpClientError } from './kdpClient.js'
import { kdpGoto } from './kdpHttp.js'
import { withKdpPage } from './kdpMetadata.js'
import type { KdpBookFormat } from './metadataStore.js'

const BOOKSHELF_URL = 'https://kdp.amazon.com/en_US/bookshelf'

export type KdpTitleActionResult = {
  titleId: string
  format: KdpBookFormat
  action: 'unpublish' | 'delete' | 'archive'
  success: boolean
  errors: string[]
}

async function findTitleRow(page: Page, titleId: string) {
  return page.locator(`tr[id="${titleId}"], tr:has(a[href*="${titleId}"])`).first()
}

export async function unpublishTitleOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  await kdpGoto(page, BOOKSHELF_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()

  const label =
    format === 'kindle'
      ? 'Unpublish eBook'
      : format === 'hardcover'
        ? 'Unpublish hardcover'
        : 'Unpublish paperback'

  const row = await findTitleRow(page, titleId)
  const link = row.getByText(label, { exact: true })
  const clicked = await link.click({ timeout: 10_000, force: true }).then(() => true).catch(() => false)

  if (!clicked) {
    return {
      titleId,
      format,
      action: 'unpublish',
      success: false,
      errors: [`Could not find "${label}" on Bookshelf.`],
    }
  }

  await page.waitForTimeout(2000)
  const confirm = page.getByRole('button', { name: /confirm|unpublish|yes/i }).first()
  if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirm.click({ timeout: 10_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  }

  return { titleId, format, action: 'unpublish', success: true, errors: [] }
}

async function expandTitleRow(page: Page, titleId: string): Promise<void> {
  const manage = page.locator(
    `#zme-indie-bookshelf-dual-itemset-itemset-actions-column-itemset-actions-${titleId}`,
  )
  if (await manage.isVisible({ timeout: 3000 }).catch(() => false)) {
    await manage.click({ timeout: 10_000 })
    await page.waitForTimeout(1500)
  }
}

function formatDeletePrefix(format: KdpBookFormat): string {
  return format === 'kindle' ? 'kindle_delete' : format === 'hardcover' ? 'hardcover_delete' : 'print_delete'
}

export async function deleteTitleOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  await kdpGoto(page, BOOKSHELF_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()

  const row = await findTitleRow(page, titleId)
  if ((await row.count()) === 0) {
    return {
      titleId,
      format,
      action: 'delete',
      success: false,
      errors: [`Title ${titleId} not found on Bookshelf.`],
    }
  }

  await expandTitleRow(page, titleId)

  const prefix = formatDeletePrefix(format)
  const deleteLink = row.locator(`a[id^="${prefix}-"]`).first()
  let clicked = await deleteLink
    .click({ timeout: 10_000, force: true })
    .then(() => true)
    .catch(() => false)

  if (!clicked) {
    clicked = await page
      .evaluate(
        ({ id, pfx }) => {
          const rows = document.querySelectorAll(`tr#${id}`)
          for (const rowEl of rows) {
            const link = rowEl.querySelector(`a[id^="${pfx}-"]`) as HTMLElement | null
            if (link) {
              link.click()
              return true
            }
          }
          return false
        },
        { id: titleId, pfx: prefix },
      )
      .catch(() => false)
  }

  if (!clicked) {
    return {
      titleId,
      format,
      action: 'delete',
      success: false,
      errors: ['Could not find delete action on Bookshelf.'],
    }
  }

  await page.waitForTimeout(2000)
  const confirm = page.getByRole('button', { name: /delete|confirm|yes/i }).first()
  if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirm.click({ timeout: 10_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  }

  return { titleId, format, action: 'delete', success: true, errors: [] }
}

export async function archiveTitleOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  await kdpGoto(page, BOOKSHELF_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  const row = await findTitleRow(page, titleId)
  const clicked = await row
    .getByText('Archive title', { exact: true })
    .click({ timeout: 10_000, force: true })
    .then(() => true)
    .catch(() => false)

  if (!clicked) {
    return {
      titleId,
      format,
      action: 'archive',
      success: false,
      errors: ['Could not find Archive title on Bookshelf.'],
    }
  }

  await page.waitForTimeout(2000)
  const confirm = page.getByRole('button', { name: /archive|confirm|yes/i }).first()
  if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirm.click({ timeout: 10_000 })
  }

  return { titleId, format, action: 'archive', success: true, errors: [] }
}

export async function unpublishTitle(
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  return withKdpPage((page) => unpublishTitleOnPage(page, titleId, format))
}

export async function deleteTitle(
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  return withKdpPage((page) => deleteTitleOnPage(page, titleId, format))
}

export async function archiveTitle(
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  return withKdpPage((page) => archiveTitleOnPage(page, titleId, format))
}
