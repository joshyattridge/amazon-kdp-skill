import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'pricing')

    for (const [id, val] of [
      ['price-input-usd', '8.99'],
      ['price-input-gbp', '7.99'],
      ['price-input-eur', '8.99'],
    ]) {
      const el = page.locator(`#${id}`).first()
      if (await el.isVisible().catch(() => false)) {
        await el.fill(val)
      }
    }

    const worldwide = page.locator('#worldwide-rights')
    if (await worldwide.isVisible().catch(() => false)) {
      await worldwide.check()
    }

    console.log('Before save alerts:', await page.evaluate(`(() => [...document.querySelectorAll('.a-alert-error, .a-alert-warning')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean))()`))

    await clickKdpActionButton(page, { labels: ['Save as Draft'] })
    await page.waitForTimeout(8000)

    console.log('After save alerts:', await page.evaluate(`(() => [...document.querySelectorAll('.a-alert-error, .a-alert-warning')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean))()`))
    console.log('USD on page:', await page.locator('#price-input-usd').first().inputValue())

    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'pricing')
    console.log('After reload USD:', await page.locator('#price-input-usd').first().inputValue())
  },
  { headless: false },
)
