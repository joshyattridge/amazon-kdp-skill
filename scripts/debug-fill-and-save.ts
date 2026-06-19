import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow } from '../server/src/kdpCreateTitle.js'
import { updateCategoriesOnPage } from '../server/src/kdpCategories.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'

const FILL_DETAILS_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/browser/fillBookDetails.js'),
  'utf8',
)

const titleId = 'WA2HX4P3E60'
const spec = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8'))
const payload = { ...spec.details, descriptionHtml: spec.details.descriptionHtml }

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', titleId, 'details')
    await setReleaseNow(page)

    await updateCategoriesOnPage(page, titleId, 'paperback', spec.categories, {
      language: 'English',
      isAdultContent: false,
      persist: false,
    })

    await page.waitForFunction(`() => window.CKEDITOR?.instances && Object.keys(window.CKEDITOR.instances).length > 0`, {
      timeout: 20000,
    })
    const fill = await page.evaluate(
      `(${FILL_DETAILS_FN})(${JSON.stringify('paperback')}, ${JSON.stringify(payload)})`,
    )
    console.log('Fill:', fill)
    await page.waitForTimeout(1500)

    const before = await page.evaluate(`(() => ({
      descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
    }))()`)
    console.log('Before save:', before)

    await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
    await page.waitForTimeout(10000)

    const samePage = await page.evaluate(`(() => ({
      descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
    }))()`)
    console.log('After save same page:', samePage)

    await openSetupStep(page, 'paperback', titleId, 'details')
    const reload = await page.evaluate(`(() => ({
      descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
    }))()`)
    console.log('After reload:', reload)
  },
  { headless: false },
)
