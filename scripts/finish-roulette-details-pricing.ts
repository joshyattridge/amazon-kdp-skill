import fs from 'node:fs'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow } from '../server/src/kdpCreateTitle.js'
import { saveDetailsOnPage, type KdpMetadataChanges } from '../server/src/kdpMetadataUpdate.js'
import { updateBookPricingOnPage } from '../server/src/kdpPricingUpdate.js'
import { updateCategoriesOnPage } from '../server/src/kdpCategories.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'

const titleId = 'WA2HX4P3E60'
const spec = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8'))

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', titleId, 'details')
    await setReleaseNow(page)

    await updateCategoriesOnPage(page, titleId, 'paperback', spec.categories, {
      language: 'English',
      isAdultContent: false,
      persist: false,
    })

    const details = await saveDetailsOnPage(page, titleId, 'paperback', spec.details as KdpMetadataChanges)
    console.log('Details:', details.saved, details.filled, details.errors?.slice(0, 3))

    await openSetupStep(page, 'paperback', titleId, 'details')
    const meta = await page.evaluate(`(() => ({
      descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
      releaseEvent: document.getElementById('data-release-event-type')?.value,
    }))()`)
    console.log('Details after reload:', meta)

    await openSetupStep(page, 'paperback', titleId, 'pricing')
    const pricing = await updateBookPricingOnPage(page, titleId, 'paperback', spec.pricing, false, {
      skipOpen: true,
    })
    console.log('Pricing:', pricing.saved, pricing.book?.listPriceUsd)
    await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
    await page.waitForTimeout(5000)

    await openSetupStep(page, 'paperback', titleId, 'pricing')
    const price = await page.evaluate(`(() => document.getElementById('price-input-usd')?.value || '')()`)
    console.log('Price after reload:', price)
  },
  { headless: false },
)
