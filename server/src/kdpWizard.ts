import type { Page } from 'playwright'
import { KdpClientError } from './kdpClient.js'
import { clickKdpActionButton } from './kdpUiHelpers.js'

const SAVE_PATTERNS = [
  /^save and continue$/i,
  /^save and publish$/i,
  /^save as draft$/i,
  /^save changes$/i,
  /^save$/i,
  /^publish$/i,
  /^continue$/i,
]

export async function bypassServerBusy(page: Page): Promise<void> {
  if ((await page.title()) !== 'Server Busy') return
  const continueBtn = page
    .locator('input[type="submit"], button, a.a-button-text')
    .filter({ hasText: /continue/i })
    .first()
  if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await continueBtn.click({ timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(2000)
  }
}

export async function clickPageButton(page: Page, patterns: RegExp[]): Promise<string> {
  for (const pattern of patterns) {
    const button = page.getByRole('button', { name: pattern }).first()
    if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
      const name = pattern.source.replace(/^\^|\$$/g, '')
      await button.click({ timeout: 15_000 })
      await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      return name
    }
  }

  const submit = page.locator('input[type="submit"]').first()
  if (await submit.isVisible({ timeout: 1500 }).catch(() => false)) {
    const value = (await submit.getAttribute('value')) ?? 'submit'
    await submit.click({ timeout: 15_000 })
    await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
    return value
  }

  throw new KdpClientError('Could not find an expected action button on the KDP page.')
}

export async function clickSave(page: Page): Promise<string> {
  return clickPageButton(page, SAVE_PATTERNS)
}

export async function clickSaveAsDraft(page: Page): Promise<string> {
  return clickKdpActionButton(page, {
    buttonIds: ['save-announce'],
    labels: ['Save as Draft'],
  })
}

export async function clickSaveAndContinue(page: Page): Promise<string> {
  return clickKdpActionButton(page, {
    buttonIds: ['save-and-continue-announce', 'unsaved-changes-save-announce'],
    labels: ['Save and Continue', 'Continue', 'Save'],
  })
}

export async function clickPublish(page: Page): Promise<string> {
  return clickPageButton(page, [/^publish$/i, /^save and publish$/i, /^save and continue$/i])
}

export function titleIdFromUrl(url: string): string | null {
  const match = url.match(/title-setup\/(?:paperback|kindle|hardcover)\/([A-Z0-9]{10,14})/i)
  return match?.[1] ?? null
}

export async function collectPageErrors(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const messages = new Set()
    for (const el of document.querySelectorAll('.a-alert-error, .a-alert.a-alert-error')) {
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
      if (text && text.length < 500) messages.add(text)
    }
    for (const el of document.querySelectorAll('.field-error, [data-field-error="true"]')) {
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
      if (text && text.length < 300) messages.add(text)
    }
    return [...messages]
  })()`) as Promise<string[]>
}
