import fs from 'node:fs'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow, ensureReleaseDateScheduled } from '../server/src/kdpCreateTitle.js'
import {
  ensureLanguageSelected,
  saveDetailsOnPage,
  type KdpMetadataChanges,
} from '../server/src/kdpMetadataUpdate.js'
import { updateCategoriesOnPage } from '../server/src/kdpCategories.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'
import { gatherBlockers } from '../server/src/kdpRecovery.js'

const spec = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8'))
const titleId = 'WA2HX4P3E60'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', titleId, 'details')
    await setReleaseNow(page)
    console.log('Release configured:', await ensureReleaseDateScheduled(page))

    await ensureLanguageSelected(page, 'paperback', 'English')
    const lang = await page.evaluate(`(() => {
      const sel = document.getElementById('data-print-book-language-native')
      return sel ? { value: sel.value, text: sel.options[sel.selectedIndex]?.text } : null
    })()`)
    console.log('Language select:', lang)

    const details = await saveDetailsOnPage(page, titleId, 'paperback', spec.details as KdpMetadataChanges)
    console.log('Details save:', details.saved, details.filled, details.skipped, details.errors)

    await openSetupStep(page, 'paperback', titleId, 'details')
    const descLen = await page.evaluate(`(() => document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0)()`)
    console.log('Desc len after save:', descLen)

    if (spec.categories?.length) {
      const cats = await updateCategoriesOnPage(page, titleId, 'paperback', spec.categories, {
        isAdultContent: false,
        language: 'English',
        persist: true,
      })
      console.log('Categories:', cats)
    }

    console.log('Blockers:', await gatherBlockers(page))
  },
  { headless: false },
)
