import { withKdpPage } from '../server/src/kdpMetadata.js'
import { createTitleOnPage, setReleaseNow } from '../server/src/kdpCreateTitle.js'
import { updateCategoriesOnPage } from '../server/src/kdpCategories.js'
import { clickKdpActionButton } from '../server/src/kdpUiHelpers.js'
import { titleIdFromUrl } from '../server/src/kdpWizard.js'

await withKdpPage(
  async (page) => {
    await createTitleOnPage(page, 'paperback')
    await setReleaseNow(page)
    const cats = await updateCategoriesOnPage(
      page,
      'new',
      'paperback',
      [{ path: ["Children's Books", 'Humor'] }],
      { language: 'English', persist: false },
    )
    console.log('Cat result:', cats)
    await page.evaluate(`((ids) => {
      for (let i = 0; i < 3; i++) {
        const el = document.querySelector('input[name="data[print_book][selected_browse_nodes][' + i + '][id]"]')
        if (el) { el.value = ids[i] ?? ''; el.dispatchEvent(new Event('change', { bubbles: true })) }
      }
    })(${JSON.stringify(cats.browseNodeIds.slice(0, 3))})`)
    await page.evaluate(`(() => {
      const t = document.getElementById('data-print-book-title')
      if (t) { t.value = 'Test Title'; t.dispatchEvent(new Event('input', { bubbles: true })) }
      const fn = document.getElementById('data-print-book-primary-author-first-name')
      const ln = document.getElementById('data-print-book-primary-author-last-name')
      if (fn) { fn.value = 'Pickle'; fn.dispatchEvent(new Event('input', { bubbles: true })) }
      if (ln) { ln.value = 'Books'; ln.dispatchEvent(new Event('input', { bubbles: true })) }
    })()`)
    console.log('Before save URL:', page.url())
    const clicked = await clickKdpActionButton(page, {
      buttonIds: ['save-and-continue-announce', 'save-announce'],
      labels: ['Save and Continue', 'Save as Draft'],
    })
    console.log('Clicked:', clicked)
    await page.waitForTimeout(8000)
    console.log('After save URL:', page.url())
    console.log('Title ID field:', await page.evaluate(`(() => document.querySelector('input[name="data[print_book][title_id]"]')?.value)`))
    console.log('Categories:', await page.evaluate(`(() => [...document.querySelectorAll('input[name^="data[print_book][selected_browse_nodes]"]')].map(e => e.value).filter(Boolean))()`))
    console.log('Errors:', await page.evaluate(`(() => [...document.querySelectorAll('.a-alert-error')].map(e => (e.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean))()`))
  },
  { headless: false },
)
