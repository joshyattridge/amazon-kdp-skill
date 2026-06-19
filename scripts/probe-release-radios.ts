import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    const info = await page.evaluate(`(() => {
      const radios = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')].filter(el => {
        const n = el.name || ''
        return /release|future|previously|publish/i.test(n + (el.id||'') + (el.closest('label')?.textContent||''))
      }).map(el => ({
        name: el.name,
        id: el.id,
        value: el.value,
        checked: el.checked,
        label: (el.closest('label')?.textContent || el.parentElement?.textContent || '').replace(/\\s+/g,' ').trim().slice(0,100),
      }))
      const links = [...document.querySelectorAll('a')].filter(a => /schedule|release|clear date|choose when/i.test(a.textContent||'')).map(a => ({
        text: (a.textContent||'').replace(/\\s+/g,' ').trim(),
        href: a.getAttribute('href'),
      }))
      return { radios, links }
    })()`)
    console.log(JSON.stringify(info, null, 2))
  },
  { headless: false },
)
