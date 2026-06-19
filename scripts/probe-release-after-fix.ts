import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow, ensureReleaseDateScheduled } from '../server/src/kdpCreateTitle.js'
import { gatherBlockers } from '../server/src/kdpRecovery.js'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    console.log('BEFORE:', JSON.stringify(await readReleaseState(page), null, 2))
    console.log('Blockers before:', await gatherBlockers(page))

    await setReleaseNow(page)
    console.log('AFTER setReleaseNow:', JSON.stringify(await readReleaseState(page), null, 2))
    console.log('ensureReleaseDateScheduled:', await ensureReleaseDateScheduled(page))
    console.log('AFTER ensure:', JSON.stringify(await readReleaseState(page), null, 2))
    console.log('Blockers after:', await gatherBlockers(page))
  },
  { headless: false },
)

async function readReleaseState(page: import('playwright').Page) {
  return page.evaluate(`(() => ({
    futureEnabled: [...document.querySelectorAll('input[name="data[print_book][future_release][enabled]"]')].map(e => ({ value: e.value, id: e.id })),
    releaseDate: document.querySelector('input[name="data[print_book][future_release][release_date]"]')?.value || '',
    picker: document.getElementById('release-date-picker-input')?.value || '',
    releaseEventType: document.getElementById('data-release-event-type')?.value || '',
    visibleLinks: [...document.querySelectorAll('a')].filter(a => /release|schedule|clear date|publication date/i.test(a.textContent||'')).map(a => (a.textContent||'').replace(/\\s+/g,' ').trim()).slice(0, 15),
    alerts: [...document.querySelectorAll('.a-alert-error, .a-alert-warning')].map(el => (el.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean),
  }))()`)
}
