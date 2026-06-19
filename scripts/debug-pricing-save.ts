import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep } from '../server/src/kdpCreateTitle.js'
import { updateBookPricingOnPage } from '../server/src/kdpPricingUpdate.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'
import { gatherBlockers } from '../server/src/kdpRecovery.js'

const titleId = 'WA2HX4P3E60'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', titleId, 'pricing')
    console.log('Blockers:', await gatherBlockers(page))

    const before = await page.evaluate(`(() => ({
      usd: document.getElementById('price-input-usd')?.value || document.querySelector('input[name="data[print_book][list_price][USD][amount]"]')?.value || '',
      territory: document.querySelector('input[name="territory-selection-type"]:checked')?.value || '',
      disabled: document.getElementById('price-input-usd')?.disabled,
      buttons: [...document.querySelectorAll('#save-announce, #save-and-continue-announce')].map(el => ({ id: el.id, visible: el.offsetParent !== null })),
    }))()`)
    console.log('Before:', before)

    const result = await updateBookPricingOnPage(page, titleId, 'paperback', {
      listPriceUsd: '8.99',
      territory: 'worldwide',
    }, false, { skipOpen: true })
    console.log('Update result:', result)

    const onPage = await page.evaluate(`(() => document.getElementById('price-input-usd')?.value || '')()`)
    console.log('On page after fill:', onPage)

    await clickKdpActionButton(page, { buttonIds: ['save-announce'], labels: ['Save as Draft'] })
    await page.waitForTimeout(8000)

    await openSetupStep(page, 'paperback', titleId, 'pricing')
    const after = await page.evaluate(`(() => ({
      usd: document.getElementById('price-input-usd')?.value || '',
      blockers: [...document.querySelectorAll('.a-alert-error, .a-alert-warning')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean),
    }))()`)
    console.log('After reload:', after)
  },
  { headless: false },
)
