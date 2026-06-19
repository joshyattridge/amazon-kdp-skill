import fs from 'node:fs'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'

const html = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8')).details.descriptionHtml

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    await page.waitForFunction(`() => window.CKEDITOR?.instances && Object.keys(window.CKEDITOR.instances).length > 0`, {
      timeout: 20000,
    })

    const ckeInfo = await page.evaluate(`(() => {
      const keys = Object.keys(window.CKEDITOR?.instances || {})
      return keys.map(k => ({
        key: k,
        elementName: window.CKEDITOR.instances[k].element?.$?.name,
        elementId: window.CKEDITOR.instances[k].element?.$?.id,
        dataLen: (window.CKEDITOR.instances[k].getData() || '').length,
      }))
    })()`)
    console.log('CKE instances:', ckeInfo)

    // Try source mode
    const htmlJson = JSON.stringify(html)
    const result = await page.evaluate(`(() => {
      const descriptionHtml = ${htmlJson}
      const log = []
      const hidden = document.querySelector('input[name="data[print_book][description]"]')
      log.push('hidden before=' + (hidden?.value?.length || 0))

      const sourceBtn = document.getElementById('cke_18')
      log.push('sourceBtn=' + !!sourceBtn)
      if (sourceBtn) sourceBtn.click()

      const ta = document.querySelector('#cke_1_contents textarea, #cke_1_contents > textarea, textarea.cke_source')
      log.push('textarea=' + !!ta + ' len=' + (ta?.value?.length || 0))
      if (ta) {
        ta.value = descriptionHtml
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.dispatchEvent(new Event('change', { bubbles: true }))
        log.push('textarea after=' + ta.value.length)
      }

      const keys = Object.keys(window.CKEDITOR?.instances || {})
      if (keys.length) {
        const inst = window.CKEDITOR.instances[keys[0]]
        inst.setData(descriptionHtml)
        inst.updateElement()
        log.push('cke after=' + inst.getData().length)
      }

      if (hidden) {
        hidden.value = descriptionHtml
        hidden.dispatchEvent(new Event('input', { bubbles: true }))
        log.push('hidden after=' + hidden.value.length)
      }

      return log
    })()`)
    console.log('Result log:', result)

    await page.waitForTimeout(2000)
    const after = await page.evaluate(`(() => ({
      hiddenLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      ckeLen: Object.values(window.CKEDITOR?.instances || {}).map(i => i.getData().length),
    }))()`)
    console.log('After wait:', after)
  },
  { headless: false },
)
