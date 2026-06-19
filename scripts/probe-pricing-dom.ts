import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'pricing')
    const info = await page.evaluate(`(() => {
      const inputs = [...document.querySelectorAll('input, select, button')]
        .filter(el => /price|territory|royalty|save|usd|list/i.test((el.name||'') + (el.id||'') + (el.textContent||'')))
        .map(el => ({
          tag: el.tagName,
          id: el.id,
          name: el.name,
          type: el.type,
          value: el.value,
          text: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60),
          disabled: el.disabled,
        }))
      return { url: location.href, title: document.title, inputs: inputs.slice(0, 40) }
    })()`)
    console.log(JSON.stringify(info, null, 2))
  },
  { headless: false },
)
