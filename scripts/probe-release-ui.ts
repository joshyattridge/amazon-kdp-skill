import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    const releaseUi = await page.evaluate(`(() => {
      const items = []
      for (const el of document.querySelectorAll('input, a, button, label, span')) {
        const text = (el.textContent || el.value || '').replace(/\\s+/g, ' ').trim()
        if (/release|schedule|previously published|clear date/i.test(text) && text.length < 120) {
          items.push({
            tag: el.tagName,
            id: el.id || null,
            name: el.getAttribute('name'),
            type: el.getAttribute('type'),
            text,
          })
        }
      }
      return items.slice(0, 40)
    })()`)
    console.log(JSON.stringify(releaseUi, null, 2))
  },
  { headless: false },
)
