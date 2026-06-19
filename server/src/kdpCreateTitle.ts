import type { Page } from 'playwright'
import { KdpAuthError, KdpClientError } from './kdpClient.js'
import { kdpGoto } from './kdpHttp.js'
import { setupPageUrl } from './kdpMetadata.js'
import type { KdpBookFormat } from './metadataStore.js'
import { bypassServerBusy, titleIdFromUrl } from './kdpWizard.js'

const CREATE_URL = 'https://kdp.amazon.com/en_US/create'

const FORMAT_BUTTON: Record<KdpBookFormat, RegExp> = {
  kindle: /^Create eBook$/i,
  paperback: /^Create paperback$/i,
  hardcover: /^Create hardcover$/i,
}

export async function createTitleOnPage(
  page: Page,
  format: KdpBookFormat,
): Promise<string> {
  await kdpGoto(page, CREATE_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()

  const pattern = FORMAT_BUTTON[format]
  await page.getByRole('button', { name: pattern }).click({ timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 120_000 })

  const url = page.url()
  if (!url.includes(`/title-setup/${format}/`)) {
    throw new KdpClientError(`Expected ${format} setup page after create, got ${url}`)
  }

  const existing = titleIdFromUrl(url)
  return existing ?? 'new'
}

export async function resolveTitleIdAfterSave(page: Page, format: KdpBookFormat): Promise<string> {
  const id = titleIdFromUrl(page.url())
  if (id && id !== 'new') return id

  const fromHidden = await page.evaluate((fmt) => {
    const names =
      fmt === 'paperback'
        ? ['data[print_book][title_id]', 'data[title_id]']
        : fmt === 'hardcover'
          ? ['data[hardcover_book][title_id]', 'data[title_id]']
          : ['data[title_id]', 'data[digital][title_id]']
    for (const name of names) {
      const el = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null
      if (el?.value && /^[A-Z0-9]{10,14}$/.test(el.value)) return el.value
    }
    return null
  }, format)

  if (fromHidden) return fromHidden
  throw new KdpClientError('Could not resolve KDP titleId after save.')
}

export async function openSetupStep(
  page: Page,
  format: KdpBookFormat,
  titleId: string,
  step: 'details' | 'content' | 'pricing',
): Promise<void> {
  const url = setupPageUrl(format, titleId, step)
  const response = await kdpGoto(page, url, { waitUntil: 'networkidle', timeout: 120_000 })
  if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()
  if (!response?.ok()) {
    throw new KdpClientError(`Could not open ${step} page for ${titleId} (${format}).`)
  }
  await bypassServerBusy(page)
}

export async function setReleaseNow(page: Page): Promise<void> {
  const clearDate = page.getByRole('link', { name: /Clear Date/i }).first()
  if (await clearDate.isVisible({ timeout: 2000 }).catch(() => false)) {
    await clearDate.click({ timeout: 10_000 })
    await page.waitForTimeout(1000)
  }

  const scheduleLink = page.locator('a').filter({ hasText: /Schedule my book/i }).first()
  if (await scheduleLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await scheduleLink.click({ timeout: 10_000 })
    await page.waitForTimeout(1500)
  }

  const future = new Date()
  future.setDate(future.getDate() + 14)
  const targetDay = String(future.getDate())
  const targetMonth = future.getMonth()
  const now = new Date()

  const picker = page.locator('#release-date-picker-input')
  if (await picker.isVisible({ timeout: 3000 }).catch(() => false)) {
    await picker.click({ timeout: 10_000 })
    await page.waitForTimeout(1000)

    if (targetMonth !== now.getMonth()) {
      const nextBtn = page.locator('.ui-datepicker-next').first()
      if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn.click()
        await page.waitForTimeout(500)
      }
    }

    const dayLink = page
      .locator('.ui-datepicker-calendar td:not(.ui-datepicker-unselectable) a.ui-state-default')
      .filter({ hasText: new RegExp(`^${targetDay}$`) })
      .first()
    if (await dayLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dayLink.click({ timeout: 10_000 })
      await page.waitForTimeout(1500)
    }
  }
}
