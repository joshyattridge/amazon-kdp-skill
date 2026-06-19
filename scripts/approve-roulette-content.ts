import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openContentPage } from '../server/src/kdpContentUpdate.js'
import { dismissKdpOverlays, clickKdpActionButton } from '../server/src/kdpUiHelpers.js'
import { readContentFileStatus } from '../server/src/kdpContentWait.js'

const titleId = 'WA2HX4P3E60'

await withKdpPage(
  async (page) => {
    await openContentPage(page, 'paperback', titleId)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await dismissKdpOverlays(page)

    console.log('Before:', await readContentFileStatus(page))

    const previewId = await page.evaluate(`(() => {
      const ids = ['print-preview-noconfirm-announce', 'print-preview-announce']
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.offsetParent !== null) return id
      }
      return null
    })()`)
    console.log('Preview button:', previewId)
    if (!previewId) {
      console.log('No preview button visible')
      return
    }

    const urlBefore = page.url()
    await clickKdpActionButton(page, { buttonIds: [previewId] })
    await page.waitForFunction(
      `(before) => window.location.href !== before || /printpreview|previewer/i.test(window.location.href)`,
      urlBefore,
      { timeout: 900_000 },
    )
    console.log('After preview nav:', page.url())
    await page.waitForTimeout(5000)

    const approved = await page.evaluate(`(() => {
      const link = document.querySelector('#printpreview_approve_button_enabled a')
      if (link) {
        link.click()
        return 'approve-link'
      }
      return null
    })()`)
    console.log('Approved via:', approved)

    await page.waitForSelector('#save-announce, #save-and-continue-announce', { timeout: 120_000 })
    await page.waitForTimeout(2000)
    console.log('Back on:', page.url())

    await clickKdpActionButton(page, {
      buttonIds: ['save-and-continue-announce', 'save-announce'],
      labels: ['Save and Continue', 'Save as Draft'],
    })
    await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {})
    console.log('Final URL:', page.url())
    console.log('Final status:', await readContentFileStatus(page))
  },
  { headless: false },
)
