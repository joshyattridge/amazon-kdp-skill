import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    const lang = await page.evaluate(`(() => {
      const out = []
      for (const el of document.querySelectorAll('select, input')) {
        const n = el.name || el.id || ''
        if (/language/i.test(n)) {
          out.push({
            tag: el.tagName,
            id: el.id,
            name: el.name,
            value: el.value,
            options: el.tagName === 'SELECT' ? [...el.options].slice(0, 10).map(o => ({ v: o.value, t: o.text.trim() })) : undefined,
          })
        }
      }
      return out
    })()`)
    console.log(JSON.stringify(lang, null, 2))
  },
  { headless: false },
)
