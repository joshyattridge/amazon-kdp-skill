import type { Page } from 'playwright'
import { KdpClientError } from './kdpClient.js'
import { setupPageUrl } from './kdpMetadata.js'
import { kdpGoto } from './kdpHttp.js'
import type { KdpBookFormat } from './metadataStore.js'
import { bypassServerBusy, collectPageErrors } from './kdpWizard.js'

/** Category path segments, e.g. ["Children's Books", "Humor"] or browse node IDs. */
export type KdpCategorySpec =
  | { path: string[] }
  | { browseNodeId: string }

export type KdpCategoryUpdateResult = {
  titleId: string
  format: KdpBookFormat
  applied: number
  browseNodeIds: string[]
  errors: string[]
}

function browseNodeFieldName(format: KdpBookFormat, index: number): string {
  const prefix =
    format === 'paperback'
      ? 'data[print_book]'
      : format === 'hardcover'
        ? 'data[hardcover_book]'
        : 'data'
  return `${prefix}[selected_browse_nodes][${index}][id]`
}

async function ensureAdultContentAnswered(page: Page, isAdult: boolean): Promise<void> {
  await page.evaluate((adult) => {
    const val = adult ? 'true' : 'false'
    const radio = document.querySelector(
      `input[name="data[print_book][is_adult_content]-radio"][value="${val}"], input[name="data[is_adult_content]-radio"][value="${val}"], input[name="data[hardcover_book][is_adult_content]-radio"][value="${val}"]`,
    ) as HTMLInputElement | null
    if (radio) {
      radio.checked = true
      radio.dispatchEvent(new Event('change', { bubbles: true }))
    }
    for (const name of [
      'data[print_book][is_adult_content]',
      'data[is_adult_content]',
      'data[hardcover_book][is_adult_content]',
    ]) {
      const hidden = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null
      if (hidden) {
        hidden.value = val
        hidden.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
  }, isAdult)
  await page.waitForTimeout(1000)
}

async function dismissOpenPopovers(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.a-popover, .a-modal-scroller')) {
      ;(el as HTMLElement).click?.()
    }
  })
  await page.waitForTimeout(500)
}

async function openCategoryModal(page: Page): Promise<void> {
  await dismissOpenPopovers(page)
  const button = page.locator('#categories-modal-button')
  await button.waitFor({ state: 'attached', timeout: 15_000 })
  const enabled = await button.isEnabled().catch(() => false)
  if (!enabled) {
    throw new KdpClientError(
      'Category picker is disabled. Fill title, author, language, and adult-content question first.',
    )
  }
  await button.click({ timeout: 15_000 })
  await page
    .locator('[role=dialog]:visible')
    .filter({ has: page.locator('select').first() })
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
}

async function selectCategoryPathInModal(page: Page, path: string[]): Promise<string | null> {
  const dialog = page.locator('[role=dialog]:visible').filter({ has: page.locator('select').first() }).last()
  const segments = path.filter(Boolean)
  if (segments.length === 0) return null

  let nodeId: string | null = null
  for (let level = 0; level < segments.length; level++) {
    const label = segments[level]
    const select = dialog.locator('select').nth(level)
    if ((await select.count()) === 0) break

    const matched = await select.evaluate((el, wanted) => {
      const selectEl = el as HTMLSelectElement
      const wantedLower = String(wanted).toLowerCase()
      let best: HTMLOptionElement | null = null
      let bestScore = 0
      for (const opt of selectEl.options) {
        const text = opt.text.trim().toLowerCase()
        let score = 0
        if (text === wantedLower) score = 3
        else if (text.startsWith(wantedLower)) score = 2
        else if (text.includes(wantedLower)) score = 1
        if (score > bestScore) {
          bestScore = score
          best = opt
        }
      }
      if (!best || bestScore === 0) return null
      selectEl.value = best.value
      selectEl.dispatchEvent(new Event('change', { bubbles: true }))
      try {
        const parsed = JSON.parse(best.value) as { nodeId?: string }
        return parsed.nodeId ?? best.value
      } catch {
        return best.value
      }
    }, label)

    if (!matched) {
      throw new KdpClientError(`Category segment not found in picker: "${label}"`)
    }
    nodeId = matched
    await page.waitForTimeout(1500)
  }

  return nodeId
}

async function saveCategoryModal(page: Page): Promise<void> {
  const dialog = page.locator('[role=dialog]:visible').filter({ has: page.locator('select').first() }).last()
  await dialog.getByRole('button', { name: /^Save categories$/i }).click({ timeout: 15_000 })
  await page.waitForTimeout(2000)
}

function readBrowseNodeIds(page: Page, format: KdpBookFormat): Promise<string[]> {
  return page.evaluate((fmt) => {
    const prefix =
      fmt === 'paperback'
        ? 'data[print_book][selected_browse_nodes]'
        : fmt === 'hardcover'
          ? 'data[hardcover_book][selected_browse_nodes]'
          : 'data[selected_browse_nodes]'
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const el = document.querySelector(
        `input[name="${prefix}[${i}][id]"]`,
      ) as HTMLInputElement | null
      if (el?.value) ids.push(el.value)
    }
    return ids
  }, format)
}

async function setBrowseNodeIdsDirect(
  page: Page,
  format: KdpBookFormat,
  ids: string[],
): Promise<void> {
  await page.evaluate(
    ({ fmt, nodeIds }) => {
      const prefix =
        fmt === 'paperback'
          ? 'data[print_book][selected_browse_nodes]'
          : fmt === 'hardcover'
            ? 'data[hardcover_book][selected_browse_nodes]'
            : 'data[selected_browse_nodes]'
      for (let i = 0; i < 3; i++) {
        const el = document.querySelector(
          `input[name="${prefix}[${i}][id]"]`,
        ) as HTMLInputElement | null
        if (el) {
          el.value = nodeIds[i] ?? ''
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }
    },
    { fmt: format, nodeIds: ids },
  )
}

export async function updateCategoriesOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
  categories: KdpCategorySpec[],
  options: { isAdultContent?: boolean } = {},
): Promise<KdpCategoryUpdateResult> {
  const detailsUrl = setupPageUrl(format, titleId, 'details')
  if (!page.url().includes(`/title-setup/${format}/`)) {
    await kdpGoto(page, detailsUrl, { waitUntil: 'networkidle', timeout: 120_000 })
  }
  await bypassServerBusy(page)

  await ensureAdultContentAnswered(page, options.isAdultContent ?? false)

  const browseIds: string[] = []
  const errors: string[] = []
  const pathCategories = categories.filter((c): c is { path: string[] } => 'path' in c)
  const idCategories = categories.filter((c): c is { browseNodeId: string } => 'browseNodeId' in c)

  if (idCategories.length > 0) {
    await setBrowseNodeIdsDirect(
      page,
      format,
      idCategories.map((c) => c.browseNodeId),
    )
  }

  for (const cat of pathCategories) {
    try {
      await openCategoryModal(page)
      const nodeId = await selectCategoryPathInModal(page, cat.path)
      if (nodeId) browseIds.push(nodeId)
      await saveCategoryModal(page)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(msg)
    }
  }

  const finalIds = await readBrowseNodeIds(page, format)
  const pageErrors = await collectPageErrors(page)

  return {
    titleId,
    format,
    applied: finalIds.length,
    browseNodeIds: finalIds.length > 0 ? finalIds : browseIds,
    errors: [...errors, ...pageErrors],
  }
}
