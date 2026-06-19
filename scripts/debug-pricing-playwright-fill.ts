import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'pricing')
    console.log('URL:', page.url())

    const usd = page.locator('#price-input-usd').first()
    await usd.scrollIntoViewIfNeeded()
    await usd.click()
    await usd.fill('8.99')
    await page.waitForTimeout(500)

    const val = await usd.inputValue()
    console.log('After fill:', val)

    await clickKdpActionButton(page, { labels: ['Save as Draft'] })
    await page.waitForTimeout(8000)

    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'pricing')
    const after = await page.locator('#price-input-usd').first().inputValue()
    console.log('After reload:', after)
  },
  { headless: false },
)
