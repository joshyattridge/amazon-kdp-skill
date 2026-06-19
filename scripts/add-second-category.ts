import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'
import { updateCategoriesOnPage } from '../server/src/kdpCategories.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    console.log('Before:', await page.evaluate(`(() => [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean))()`))

    await updateCategoriesOnPage(
      page,
      'WA2HX4P3E60',
      'paperback',
      [{ path: ["Children's Books", 'Fairy Tales, Folk Tales & Myths'] }],
      { language: 'English', isAdultContent: false, persist: false },
    )

    const mid = await page.evaluate(`(() => [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean))()`)
    console.log('After modal:', mid)

    await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
    await page.waitForTimeout(8000)

    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    const after = await page.evaluate(`(() => [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean))()`)
    console.log('After reload:', after)
  },
  { headless: false },
)
