#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseKdpUploaderFile } from '../lib/parseKdpUploaderWorkbook.js'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import {
  createTitleOnPage,
  ensureReleaseDateScheduled,
  openSetupStep,
  resolveTitleIdAfterSave,
  setReleaseNow,
} from '../server/src/kdpCreateTitle.js'
import { updateCategoriesOnPage } from '../server/src/kdpCategories.js'
import { completePrintContentOnPage } from '../server/src/kdpContentUpdate.js'
import { ensureLanguageSelected, sanitizeDescriptionHtml } from '../server/src/kdpMetadataUpdate.js'
import { updateBookPricingOnPage } from '../server/src/kdpPricingUpdate.js'
import { clickKdpActionButton, dismissKdpOverlays } from '../server/src/kdpUiHelpers.js'
import { titleIdFromUrl } from '../server/src/kdpWizard.js'
import type { KdpBookFormat } from '../server/src/metadataStore.js'

const STAGING = '/Users/joshuaattridge/Documents/Personal/Picture_Book_Generator/kdp_staging'
const XLSX = `${STAGING}/KDPUploader.xlsx`
const FILL_DETAILS_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/browser/fillBookDetails.js'),
  'utf8',
)

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx >= 0 ? args[idx + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const titleMatch = argValue(args, '--title')
  const titleIdArg = argValue(args, '--titleId')
  const pricingOnly = args.includes('--pricing-only')
  if (!titleMatch) {
    console.error('Usage: upload-one-staging-book --title "Book Title" [--titleId ID]')
    process.exit(1)
  }

  const spec = parseKdpUploaderFile(XLSX, {
    assetsDir: STAGING,
    format: 'paperback',
    titleMatch,
    dryRun: false,
    publish: false,
  })
  if (spec.details?.descriptionHtml) {
    spec.details.descriptionHtml = sanitizeDescriptionHtml(spec.details.descriptionHtml)
  }

  const payload = { ...spec.details }
  let titleId = titleIdArg?.trim() || ''
  const format: KdpBookFormat = 'paperback'

  const result = await withKdpPage(
    async (page) => {
      if (!titleId) {
        titleId = await createTitleOnPage(page, format)
        console.log('Created draft:', titleId, page.url())
      } else if (!pricingOnly) {
        await openSetupStep(page, format, titleId, 'details')
      }

      if (pricingOnly && titleId) {
        if (spec.pricing) {
          await openSetupStep(page, format, titleId, 'pricing')
          const pricing = await updateBookPricingOnPage(page, titleId, format, spec.pricing, false, {
            skipOpen: true,
          })
          console.log('Pricing:', pricing.saved, pricing.book?.listPriceUsd)
          await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
          await page.waitForTimeout(5000)
        }
        return { titleId, pricing: spec.pricing?.listPriceUsd }
      }

      await setReleaseNow(page)
      if (spec.details?.language) {
        await ensureLanguageSelected(page, format, spec.details.language)
      }

      await page.waitForFunction(
        `() => window.CKEDITOR?.instances && Object.keys(window.CKEDITOR.instances).length > 0`,
        { timeout: 20000 },
      )
      await page.evaluate(`(${FILL_DETAILS_FN})('paperback', ${JSON.stringify(payload)})`)
      await page.waitForTimeout(1500)
      if (spec.details?.language) {
        await ensureLanguageSelected(page, format, spec.details.language)
      }
      await ensureReleaseDateScheduled(page)
      await dismissKdpOverlays(page)
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(500)
      await clickKdpActionButton(page, {
        buttonIds: ['save-announce', 'save-and-continue-announce'],
        labels: ['Save as Draft', 'Save and Continue'],
      })
      await page.waitForTimeout(10000)

      const resolvedFromPage = (await page.evaluate(`(() => {
        for (const name of ['data[print_book][title_id]', 'data[title_id]']) {
          const el = document.querySelector('input[name="' + name + '"]')
          if (el?.value && /^[A-Z0-9]{10,14}$/.test(el.value)) return el.value
        }
        return null
      })()`)) as string | null
      if (resolvedFromPage) titleId = resolvedFromPage

      try {
        const resolved = await resolveTitleIdAfterSave(page, format)
        if (resolved && resolved !== 'new') titleId = resolved
      } catch {}
      const fromUrl = titleIdFromUrl(page.url())
      if (fromUrl && fromUrl !== 'new') titleId = fromUrl

      if (!titleId || titleId === 'new') {
        const { syncAllBookMetadata } = await import('../server/src/kdpMetadata.js')
        const cache = await syncAllBookMetadata()
        const match = cache.books.find(
          (b) =>
            b.format === format &&
            b.title.trim().toLowerCase() === (spec.details?.title ?? '').trim().toLowerCase(),
        )
        if (match?.titleId) titleId = match.titleId
      }

      if (!titleId || titleId === 'new') {
        const pageErrors = await page.evaluate(`(() => [...document.querySelectorAll('.a-alert-error, .a-box-error, .a-alert-inline-error')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean))()`)
        console.error('Save errors:', pageErrors)
        throw new Error('Could not resolve KDP titleId after saving details.')
      }

      const details = await page.evaluate(`(() => ({
        descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
        categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
        releaseEvent: document.getElementById('data-release-event-type')?.value,
      }))()`)
      console.log('Details:', details, 'titleId:', titleId)

      const browseIds: string[] = []
      for (const cat of spec.categories ?? []) {
        try {
          await openSetupStep(page, format, titleId, 'details')
          const catResult = await updateCategoriesOnPage(page, titleId, format, [cat], {
            language: spec.details?.language ?? 'English',
            isAdultContent: spec.details?.isAdultContent ?? false,
            persist: false,
          })
          browseIds.push(...catResult.browseNodeIds)
          if (catResult.errors.length > 0) {
            console.log('Category warning:', cat.path ?? cat, catResult.errors.slice(0, 2))
          }
        } catch (e) {
          console.log('Category skipped:', 'path' in cat ? cat.path : cat, e instanceof Error ? e.message : e)
        }
      }

      const content = await completePrintContentOnPage(page, titleId, format, {
        interiorPath: spec.content?.interiorPath || '',
        coverPath: spec.content?.coverPath || '',
        printSettings: spec.content?.printSettings,
      })
      console.log('Content:', content)

      if (spec.pricing) {
        await openSetupStep(page, format, titleId, 'pricing')
        const pricing = await updateBookPricingOnPage(page, titleId, format, spec.pricing, false, {
          skipOpen: true,
        })
        console.log('Pricing:', pricing.saved, pricing.book?.listPriceUsd)
        await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
        await page.waitForTimeout(5000)
      }

      return { titleId, details, content, pricing: spec.pricing?.listPriceUsd }
    },
    { headless: false },
  )

  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
