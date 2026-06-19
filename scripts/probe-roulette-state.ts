import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openContentPage } from '../server/src/kdpContentUpdate.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'
import { gatherBlockers } from '../server/src/kdpRecovery.js'
import { readContentFileStatus } from '../server/src/kdpContentWait.js'

const titleId = 'WA2HX4P3E60'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', titleId, 'details')
    const detailsBlockers = await gatherBlockers(page)
    const descLen = await page.evaluate(`(() => {
      const el = document.querySelector('input[name="data[print_book][description]"]')
      return el?.value?.length || 0
    })()`)
    const releaseInfo = await page.evaluate(`(() => ({
      futureEnabled: [...document.querySelectorAll('input[name="data[print_book][future_release][enabled]"]')].map(e => e.value),
      releaseDate: document.querySelector('input[name="data[print_book][future_release][release_date]"]')?.value || '',
      picker: document.getElementById('release-date-picker-input')?.value || '',
      categories: [...document.querySelectorAll('#section-categories ul li input[type="hidden"]')].map(e => e.value).filter(Boolean),
    }))()`)

    await openContentPage(page, 'paperback', titleId)
    const trimInfo = await page.evaluate(`(() => ({
      trimW: document.querySelector('input[name="data[print_book][trim_size][width]"]')?.value,
      trimH: document.querySelector('input[name="data[print_book][trim_size][height]"]')?.value,
      ink: document.querySelector('input[name="data[print_book][ink_and_paper]"]:checked')?.value,
      bleed: document.querySelector('input[name="data[print_book][interior_has_bleed]"]:checked')?.value,
      minPages: (document.body.innerText || '').match(/minimum of \\d+/i)?.[0],
    }))()`)
    const status = await readContentFileStatus(page)
    const contentBlockers = await gatherBlockers(page)
    const contentErrors = await page.evaluate(`(() => {
      const out = []
      for (const el of document.querySelectorAll('.a-alert-error, .field-error, [data-field-error="true"]')) {
        const t = (el.textContent || '').replace(/\\s+/g, ' ').trim()
        if (t) out.push(t)
      }
      return out
    })()`)

    await openSetupStep(page, 'paperback', titleId, 'pricing')
    const price = await page.evaluate(`(() => ({
      usd: document.getElementById('price-input-usd')?.value || '',
      territory: document.querySelector('input[name="territory-selection-type"]:checked')?.value || '',
    }))()`)

    console.log(JSON.stringify({ detailsBlockers, descLen, releaseInfo, trimInfo, status, contentBlockers, contentErrors, price }, null, 2))
  },
  { headless: false },
)
