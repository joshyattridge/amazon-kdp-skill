import fs from 'node:fs'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow, ensureReleaseDateScheduled } from '../server/src/kdpCreateTitle.js'
import { saveDetailsOnPage, type KdpMetadataChanges } from '../server/src/kdpMetadataUpdate.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'

const spec = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8'))

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    await setReleaseNow(page)
    console.log('Release:', await ensureReleaseDateScheduled(page))

    await page.evaluate(`(() => {
      const src = document.getElementById('cke_18')
      if (src) src.click()
    })()`)
    await page.waitForTimeout(500)

    const html = spec.details.descriptionHtml
    await page.evaluate(
      `(html) => {
        const ta = document.querySelector('#cke_1_contents > textarea')
        if (ta) {
          ta.value = html
          ta.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const hidden = document.querySelector('input[name="data[print_book][description]"]')
        if (hidden) {
          hidden.value = html
          hidden.dispatchEvent(new Event('input', { bubbles: true }))
        }
        if (window.CKEDITOR?.instances) {
          for (const k of Object.keys(window.CKEDITOR.instances)) {
            window.CKEDITOR.instances[k].setData(html)
            window.CKEDITOR.instances[k].updateElement()
          }
        }
      }`,
      html,
    )
    await page.waitForTimeout(2000)

    const descLen = await page.evaluate(
      `() => document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0`,
    )
    console.log('On-page desc len before save:', descLen)

    await clickKdpActionButton(page, {
      buttonIds: ['save-announce', 'save-and-continue-announce'],
      labels: ['Save as Draft', 'Save and Continue'],
    })
    await page.waitForTimeout(5000)

    const afterLen = await page.evaluate(
      `() => document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0`,
    )
    console.log('On-page desc len after save:', afterLen)
  },
  { headless: false },
)
