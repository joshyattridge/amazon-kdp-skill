import type { Page } from 'playwright'
import { KdpClientError } from './kdpClient.js'

const DEFAULT_SAVE_LABELS = [
  'Save and Continue',
  'Save as Draft',
  'Save and Publish',
  'Save Changes',
  'Save',
  'Continue',
]

export async function dismissKdpOverlays(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(200)

  const interruptIds = [
    'uploading-interrupt-ack-announce',
    'unsaved-changes-cancel-announce',
  ]
  for (const id of interruptIds) {
    const btn = page.locator(`#${id}`)
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(300)
    }
  }

  await page.evaluate(`(() => {
    for (const el of document.querySelectorAll('.a-modal-scroller, .a-popover')) {
      el.click && el.click()
    }
    for (const el of document.querySelectorAll('[data-action="a-popover-floating-close"]')) {
      el.click && el.click()
    }
  })()`)
  await page.waitForTimeout(300)
}

export async function clickKdpActionButton(
  page: Page,
  options: {
    buttonIds?: string[]
    labels?: string[]
  } = {},
): Promise<string> {
  await dismissKdpOverlays(page)

  const buttonIds = options.buttonIds ?? []
  const labels = options.labels ?? DEFAULT_SAVE_LABELS

  for (const id of buttonIds) {
    const clicked = (await page.evaluate(
      `(buttonId) => {
        const btn = document.getElementById(buttonId)
        if (!btn) return null
        btn.scrollIntoView({ block: 'center' })
        btn.click()
        return (btn.textContent || '').replace(/\\s+/g, ' ').trim() || buttonId
      }`,
      id,
    )) as string | null
    if (clicked) {
      await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
      await page.waitForTimeout(1000)
      return clicked
    }
  }

  const clicked = (await page.evaluate(
    `(wantedLabels) => {
      for (const label of wantedLabels) {
        for (const el of document.querySelectorAll('button, input[type="submit"], a.a-button-text')) {
          const text = (el.value || el.textContent || '').replace(/\\s+/g, ' ').trim()
          if (text.toLowerCase() === label.toLowerCase()) {
            el.scrollIntoView({ block: 'center' })
            el.click()
            return text
          }
        }
      }
      return null
    }`,
    labels,
  )) as string | null

  if (clicked) {
    await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
    await page.waitForTimeout(1000)
    return clicked
  }

  throw new KdpClientError(
    `Could not click KDP button (tried ids: ${buttonIds.join(', ') || 'none'}).`,
  )
}

export async function clickKdpSaveAndContinue(page: Page): Promise<string> {
  return clickKdpActionButton(page, {
    buttonIds: ['save-and-continue-announce', 'unsaved-changes-save-announce', 'save-announce'],
    labels: ['Save and Continue', 'Save as Draft', 'Save'],
  })
}
