import type { Page } from 'playwright'
import { KdpAuthError, KdpClientError } from './kdpClient.js'
import { kdpGoto } from './kdpHttp.js'
import { setupPageUrl } from './kdpMetadata.js'
import type { KdpBookFormat } from './metadataStore.js'
import { bypassServerBusy, titleIdFromUrl } from './kdpWizard.js'
import { dismissKdpOverlays } from './kdpUiHelpers.js'

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
  await dismissKdpOverlays(page)

  await page.evaluate(`(() => {
    for (const a of document.querySelectorAll('a')) {
      if (/clear date/i.test(a.textContent || '')) a.click()
    }
  })()`)
  await page.waitForTimeout(800)

  const clicked = (await page.evaluate(`(() => {
    for (const label of [/release my book for sale now/i, /schedule my book'?s? release/i]) {
      for (const a of document.querySelectorAll('a')) {
        const text = (a.textContent || '').replace(/\\s+/g, ' ').trim()
        if (label.test(text)) {
          a.click()
          return text
        }
      }
    }
    return null
  })()`)) as string | null

  if (clicked && /release my book for sale now/i.test(clicked)) {
    await page.waitForTimeout(1500)
    return
  }

  if (clicked) {
    await page.waitForTimeout(1500)
  }

  const future = new Date()
  future.setDate(future.getDate() + 14)
  const targetDay = String(future.getDate())
  const targetMonth = future.getMonth()
  const now = new Date()

  const picker = page.locator('#release-date-picker-input')
  if (await picker.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.evaluate(`(() => {
      const input = document.getElementById('release-date-picker-input')
      if (input) input.click()
    })()`)
    await page.waitForTimeout(1000)

    if (targetMonth !== now.getMonth()) {
      await page.evaluate(`(() => {
        const next = document.querySelector('.ui-datepicker-next')
        if (next) next.click()
      })()`)
      await page.waitForTimeout(500)
    }

    await page.evaluate(`((day) => {
      for (const a of document.querySelectorAll('.ui-datepicker-calendar td:not(.ui-datepicker-unselectable) a.ui-state-default')) {
        if ((a.textContent || '').trim() === day) {
          a.click()
          return
        }
      }
    })(${JSON.stringify(targetDay)})`)
    await page.waitForTimeout(1500)
  }
}

export async function ensureReleaseDateScheduled(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await setReleaseNow(page)
    const ok = (await page.evaluate(`(() => {
      const enabledInputs = [...document.querySelectorAll('input[name="data[print_book][future_release][enabled]"]')]
      if (enabledInputs.some((el) => el.value === 'false')) return true
      const enabled = enabledInputs.some((el) => el.value === 'true')
      const date =
        document.querySelector('input[name="data[print_book][future_release][release_date]"]')?.value ||
        document.getElementById('release-date-picker-input')?.value
      return enabled && !!date
    })()`)) as boolean
    if (ok) return true
    await page.waitForTimeout(1000)
  }
  return false
}
