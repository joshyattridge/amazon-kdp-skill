import fs from 'node:fs'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow } from '../server/src/kdpCreateTitle.js'

const spec = JSON.parse(fs.readFileSync('output/Roulette_For_Babies.finish.json', 'utf8'))
const html = spec.details.descriptionHtml

await withKdpPage(
  async (page) => {
    page.on('response', async (resp) => {
      if (resp.request().method() !== 'POST') return
      const url = resp.url()
      if (!/amazon|kdp/i.test(url)) return
      if (!/save|title|details|validate/i.test(url)) return
      console.log('POST', resp.status(), url.split('?')[0])
      try {
        const body = await resp.text()
        if (/error|invalid|fail|not supported|category|description|release/i.test(body)) {
          console.log('  snippet:', body.replace(/\s+/g, ' ').slice(0, 400))
        }
      } catch {}
    })

    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    await setReleaseNow(page)

    await page.waitForFunction(`() => window.CKEDITOR?.instances && Object.keys(window.CKEDITOR.instances).length > 0`, {
      timeout: 20000,
    })

    const fill = await page.evaluate(`(descriptionHtml) => new Promise((resolve) => {
      const syncHidden = () => {
        const el = document.querySelector('input[name="data[print_book][description]"]')
        if (!el) return 0
        const keys = Object.keys(window.CKEDITOR?.instances || {})
        const data = keys.length ? window.CKEDITOR.instances[keys[0]].getData() : descriptionHtml
        el.value = data || descriptionHtml
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return el.value.length
      }

      const sourceBtn = document.getElementById('cke_18')
      if (sourceBtn) sourceBtn.click()

      setTimeout(() => {
        const sourceTa = document.querySelector('#cke_1_contents > textarea')
        if (sourceTa) {
          sourceTa.value = descriptionHtml
          sourceTa.dispatchEvent(new Event('input', { bubbles: true }))
        }

        const keys = Object.keys(window.CKEDITOR?.instances || {})
        const done = () => {
          if (sourceBtn) sourceBtn.click()
          setTimeout(() => {
            resolve({
              hiddenLen: syncHidden(),
              ckeLen: keys.length ? window.CKEDITOR.instances[keys[0]].getData().length : 0,
              sourceTaLen: sourceTa?.value?.length || 0,
            })
          }, 300)
        }

        if (keys.length) {
          window.CKEDITOR.instances[keys[0]].setData(descriptionHtml, () => {
            window.CKEDITOR.instances[keys[0]].updateElement()
            done()
          })
        } else {
          done()
        }
      }, 500)
    })`, html)
    console.log('Fill:', fill)

    const { updateCategoriesOnPage } = await import('../server/src/kdpCategories.js')
    await updateCategoriesOnPage(page, 'WA2HX4P3E60', 'paperback', spec.categories, {
      language: 'English',
      persist: false,
    })
    const cats = await page.evaluate(`(() => [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean))()`)
    console.log('Categories:', cats)

    const { clickKdpActionButton } = await import('../server/src/kdpUiHelpers.js')
    console.log('Clicking Save as Draft...')
    await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
    await page.waitForTimeout(10000)

    const postSave = await page.evaluate(`(() => ({
      descLen: document.querySelector('input[name="data[print_book][description]"]')?.value?.length || 0,
      categories: [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean),
      releaseEvent: document.getElementById('data-release-event-type')?.value,
      futureEnabled: [...document.querySelectorAll('input[name="data[print_book][future_release][enabled]"]')].map(e => e.value),
      alerts: [...document.querySelectorAll('.a-alert-error, .a-alert-warning')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean),
    }))()`)
    console.log('Post save:', postSave)
  },
  { headless: false },
)
