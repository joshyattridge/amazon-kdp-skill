import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openContentPage } from '../server/src/kdpContentUpdate.js'

await withKdpPage(
  async (page) => {
    await openContentPage(page, 'paperback', 'WA2HX4P3E60')
    const inks = await page.evaluate(`(() => {
      return [...document.querySelectorAll('input[name="data[print_book][ink_and_paper]"]')].map((el) => ({
        value: el.value,
        checked: el.checked,
        label: (el.closest('label')?.textContent || el.parentElement?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      }))
    })()`)
    console.log(JSON.stringify(inks, null, 2))
  },
  { headless: false },
)
