import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow } from '../server/src/kdpCreateTitle.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'

const FILL_DETAILS_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/browser/fillBookDetails.js'),
  'utf8',
)

const spec = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8'))
const html = spec.details.descriptionHtml.replace(/<\/?h1>/gi, (tag) =>
  tag.toLowerCase() === '<h1>' ? '<p><b>' : '</b></p>',
)

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    await setReleaseNow(page)
    await page.evaluate(`(() => {
      for (const [i, id] of ['3003', '2977'].entries()) {
        const el = document.querySelector('input[name="data[print_book][selected_browse_nodes][' + i + '][id]"]')
        if (el) { el.value = id; el.dispatchEvent(new Event('change', { bubbles: true })) }
      }
    })()`)
    await page.waitForFunction(`() => window.CKEDITOR?.instances && Object.keys(window.CKEDITOR.instances).length > 0`)
    await page.evaluate(`(${FILL_DETAILS_FN})('paperback', ${JSON.stringify({ descriptionHtml: html })})`)
    await page.waitForTimeout(1000)
    const before = await page.evaluate(`(() => document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0)()`)
    console.log('Before len:', before)
    await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
    await page.waitForTimeout(10000)
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    const after = await page.evaluate(`(() => document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0)()`)
    console.log('After reload len:', after)
  },
  { headless: false },
)
