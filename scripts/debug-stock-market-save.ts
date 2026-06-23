#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseKdpUploaderFile } from '../lib/parseKdpUploaderWorkbook.js'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { createTitleOnPage, setReleaseNow } from '../server/src/kdpCreateTitle.js'
import { updateCategoriesOnPage } from '../server/src/kdpCategories.js'
import { sanitizeDescriptionHtml } from '../server/src/kdpMetadataUpdate.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'
import { titleIdFromUrl } from '../server/src/kdpWizard.js'

const STAGING = '/Users/joshuaattridge/Documents/Personal/Picture_Book_Generator/kdp_staging'
const FILL_DETAILS_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/browser/fillBookDetails.js'),
  'utf8',
)

const spec = parseKdpUploaderFile(`${STAGING}/KDPUploader.xlsx`, {
  assetsDir: STAGING,
  format: 'paperback',
  titleMatch: 'Stock Market For Babies',
  dryRun: false,
  publish: false,
})
if (spec.details?.descriptionHtml) {
  spec.details.descriptionHtml = sanitizeDescriptionHtml(spec.details.descriptionHtml)
}

await withKdpPage(
  async (page) => {
    await createTitleOnPage(page, 'paperback')
    await setReleaseNow(page)

    for (const cat of spec.categories ?? []) {
      const catResult = await updateCategoriesOnPage(page, 'new', 'paperback', [cat], {
        language: spec.details?.language ?? 'English',
        isAdultContent: spec.details?.isAdultContent ?? false,
        persist: false,
      })
      console.log('Category result:', catResult)
    }

    await page.waitForFunction(
      `() => window.CKEDITOR?.instances && Object.keys(window.CKEDITOR.instances).length > 0`,
      { timeout: 20000 },
    )
    await page.evaluate(`(${FILL_DETAILS_FN})('paperback', ${JSON.stringify(spec.details)})`)
    await page.waitForTimeout(1500)

    const before = await page.evaluate(`(() => ({
      title: document.getElementById('data-print-book-title')?.value,
      author: [
        document.getElementById('data-print-book-primary-author-first-name')?.value,
        document.getElementById('data-print-book-primary-author-last-name')?.value,
      ],
      descHiddenLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      releaseEvent: document.getElementById('data-release-event-type')?.value,
      errors: [...document.querySelectorAll('.a-alert-error, .a-box-error')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean),
    }))()`)
    console.log('Before save:', before)

    const clicked = await clickKdpActionButton(page, {
      buttonIds: ['save-and-continue-announce', 'save-announce'],
      labels: ['Save and Continue', 'Save as Draft'],
    })
    console.log('Save clicked:', clicked)
    await page.waitForTimeout(12000)

    const after = await page.evaluate(`(() => ({
      url: location.href,
      titleId: document.querySelector('input[name="data[print_book][title_id]"]')?.value,
      errors: [...document.querySelectorAll('.a-alert-error, .a-box-error, .error-message')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean),
      fieldErrors: [...document.querySelectorAll('.a-alert-inline-error, .field-error')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean),
    }))()`)
    console.log('After save:', after)
    console.log('URL titleId:', titleIdFromUrl(page.url()))
  },
  { headless: false },
)
