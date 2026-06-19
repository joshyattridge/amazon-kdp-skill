import fs from 'node:fs'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow } from '../server/src/kdpCreateTitle.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'

const spec = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8'))
const html = spec.details.descriptionHtml

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    await setReleaseNow(page)

    // Set categories by known browse node IDs from prior successful modal picks
    await page.evaluate(`(() => {
      const ids = ['3003', '2977']
      for (let i = 0; i < 3; i++) {
        const el = document.querySelector('input[name="data[print_book][selected_browse_nodes][' + i + '][id]"]')
        if (el) {
          el.value = ids[i] ?? ''
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }
    })()`)

    await page.waitForFunction(`() => window.CKEDITOR?.instances && Object.keys(window.CKEDITOR.instances).length > 0`, {
      timeout: 20000,
    })

    await page.evaluate(`(descriptionHtml) => {
      const hidden = document.querySelector('input[name="data[print_book][description]"]')
      if (hidden) {
        hidden.value = descriptionHtml
        hidden.dispatchEvent(new Event('input', { bubbles: true }))
        hidden.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const keys = Object.keys(window.CKEDITOR?.instances || {})
      if (keys.length) {
        window.CKEDITOR.instances[keys[0]].setData(descriptionHtml)
        window.CKEDITOR.instances[keys[0]].updateElement()
      }
    }`, html)
    await page.waitForTimeout(2000)

    const before = await page.evaluate(`(() => ({
      descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
      releaseEvent: document.getElementById('data-release-event-type')?.value,
    }))()`)
    console.log('Before save:', before)

    await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
    await page.waitForTimeout(10000)

    const after = await page.evaluate(`(() => ({
      descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
      releaseEvent: document.getElementById('data-release-event-type')?.value,
      alerts: [...document.querySelectorAll('.a-alert-error')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean),
    }))()`)
    console.log('After save (same page):', after)

    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    const reload = await page.evaluate(`(() => ({
      descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
      releaseEvent: document.getElementById('data-release-event-type')?.value,
    }))()`)
    console.log('After reload:', reload)
  },
  { headless: false },
)
