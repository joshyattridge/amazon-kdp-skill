import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow } from '../server/src/kdpCreateTitle.js'
import { updateCategoriesOnPage } from '../server/src/kdpCategories.js'
import { updateBookPricingOnPage } from '../server/src/kdpPricingUpdate.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'

const FILL_DETAILS_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/browser/fillBookDetails.js'),
  'utf8',
)

function sanitizeDescriptionHtml(html: string): string {
  return html.replace(/<\/?h1\b[^>]*>/gi, (tag) =>
    /^<h1/i.test(tag) ? '<p><b>' : '</b></p>',
  )
}

const titleId = 'WA2HX4P3E60'
const spec = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8'))
const payload = {
  ...spec.details,
  descriptionHtml: sanitizeDescriptionHtml(spec.details.descriptionHtml),
}

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', titleId, 'details')
    await setReleaseNow(page)

    for (const cat of spec.categories) {
      await updateCategoriesOnPage(page, titleId, 'paperback', [cat], {
        language: 'English',
        isAdultContent: false,
        persist: false,
      })
    }
    await page.evaluate(`(() => {
      const ids = ['3003', '2977']
      for (let i = 0; i < ids.length; i++) {
        const el = document.querySelector('input[name="data[print_book][selected_browse_nodes][' + i + '][id]"]')
        if (el) {
          el.value = ids[i]
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }
    })()`)

    await page.waitForFunction(`() => window.CKEDITOR?.instances && Object.keys(window.CKEDITOR.instances).length > 0`)
    await page.evaluate(`(${FILL_DETAILS_FN})('paperback', ${JSON.stringify(payload)})`)
    await page.waitForTimeout(1500)

    console.log('Saving details...')
    await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
    await page.waitForTimeout(10000)

    await openSetupStep(page, 'paperback', titleId, 'details')
    const details = await page.evaluate(`(() => ({
      descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
      releaseEvent: document.getElementById('data-release-event-type')?.value,
    }))()`)
    console.log('Details persisted:', details)

    await openSetupStep(page, 'paperback', titleId, 'pricing')
    const pricing = await updateBookPricingOnPage(page, titleId, 'paperback', spec.pricing, false, {
      skipOpen: true,
    })
    console.log('Pricing saved:', pricing.saved, pricing.book?.listPriceUsd)
    await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
    await page.waitForTimeout(5000)

    await openSetupStep(page, 'paperback', titleId, 'pricing')
    const price = await page.evaluate(`(() => document.getElementById('price-input-usd')?.value || '')()`)
    console.log('Price persisted:', price)
  },
  { headless: false },
)
