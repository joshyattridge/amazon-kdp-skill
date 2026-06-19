import fs from 'node:fs'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow, ensureReleaseDateScheduled } from '../server/src/kdpCreateTitle.js'
import {
  approveManuscriptIfNeeded,
  readContentFileStatus,
  saveContentPage,
} from '../server/src/kdpContentWait.js'
import { openContentPage } from '../server/src/kdpContentUpdate.js'
import { clickKdpSaveAndContinue } from '../server/src/kdpUiHelpers.js'
import { saveDetailsOnPage, type KdpMetadataChanges } from '../server/src/kdpMetadataUpdate.js'
import { updateBookPricingOnPage } from '../server/src/kdpPricingUpdate.js'
import { updateCategoriesOnPage } from '../server/src/kdpCategories.js'

const titleId = 'WA2HX4P3E60'
const spec = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8'))

await withKdpPage(
  async (page) => {
    await openContentPage(page, 'paperback', titleId)
    const approved = await approveManuscriptIfNeeded(page)
    console.log('Approved:', approved)
    await saveContentPage(page)
    await clickKdpSaveAndContinue(page).catch(() => saveContentPage(page))
    await page.waitForTimeout(5000)
    console.log('After content save URL:', page.url())
    console.log('Content status:', await readContentFileStatus(page))

    if (!page.url().includes('/pricing')) {
      await openSetupStep(page, 'paperback', titleId, 'pricing')
    }

    const pricing = await updateBookPricingOnPage(
      page,
      titleId,
      'paperback',
      spec.pricing,
      false,
      { skipOpen: true },
    )
    console.log('Pricing:', pricing.saved, pricing.book?.listPriceUsd, pricing.errors)

    await openSetupStep(page, 'paperback', titleId, 'details')
    await setReleaseNow(page)
    console.log('Release ok:', await ensureReleaseDateScheduled(page))
    const details = await saveDetailsOnPage(page, titleId, 'paperback', spec.details as KdpMetadataChanges, {
      categories: spec.categories,
    })
    console.log('Details:', details.saved, details.errors)
  },
  { headless: false },
)
