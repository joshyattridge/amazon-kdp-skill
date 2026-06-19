import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow } from '../server/src/kdpCreateTitle.js'

await withKdpPage(
  async (page) => {
    page.on('response', async (resp) => {
      if (resp.request().method() !== 'POST') return
      const url = resp.url()
      if (!url.includes('client-side-error')) return
      console.log('client-side-error POST')
      try {
        const req = resp.request().postDataJSON?.() ?? resp.request().postData()
        console.log('  request:', typeof req === 'string' ? req.slice(0, 500) : JSON.stringify(req).slice(0, 500))
      } catch {}
    })

    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    await setReleaseNow(page)

    const btnState = await page.evaluate(`(() => {
      const btn = document.getElementById('categories-modal-button')
      return btn ? { disabled: btn.disabled, ariaDisabled: btn.getAttribute('aria-disabled'), text: btn.textContent?.trim() } : null
    })()`)
    console.log('Category button:', btnState)

    const { updateCategoriesOnPage } = await import('../server/src/kdpCategories.js')
    try {
      const result = await updateCategoriesOnPage(
        page,
        'WA2HX4P3E60',
        'paperback',
        [{ path: ["Children's Books", 'Humor'] }],
        { language: 'English', isAdultContent: false, persist: false },
      )
      console.log('Result:', result)
    } catch (e) {
      console.error('Error:', e)
    }

    const cats = await page.evaluate(`(() => [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean))()`)
    console.log('Categories after:', cats)
  },
  { headless: false },
)
