import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openContentPage } from '../server/src/kdpContentUpdate.js'
import { dismissKdpOverlays } from '../server/src/kdpUiHelpers.js'

const titleId = 'WA2HX4P3E60'

await withKdpPage(
  async (page) => {
    await openContentPage(page, 'paperback', titleId)
    await dismissKdpOverlays(page)

    const context = page.context()
    const popupPromise = context.waitForEvent('page', { timeout: 120_000 }).catch(() => null)

    await page.locator('#print-preview-noconfirm-announce').click({ timeout: 15000 })
    await page.waitForTimeout(8000)

    const popup = await popupPromise
    console.log('Main URL:', page.url())
    console.log('Popup:', popup?.url() ?? 'none')

    const pages = context.pages()
    console.log('All pages:', pages.map((p) => p.url()))

    for (const p of pages) {
      const approve = await p.evaluate(`(() => {
        const link = document.querySelector('#printpreview_approve_button_enabled a')
        if (link) return link.textContent?.trim()
        const btns = [...document.querySelectorAll('button, a')].map(b => (b.textContent||'').trim()).filter(t => /approve/i.test(t))
        return btns.slice(0,5)
      })()`)
      console.log('Page', p.url(), 'approve:', approve)
    }
  },
  { headless: false },
)
