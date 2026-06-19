import { withKdpPage } from '../server/src/kdpMetadata.js'
import { openSetupStep, setReleaseNow } from '../server/src/kdpCreateTitle.js'

await withKdpPage(
  async (page) => {
    await openSetupStep(page, 'paperback', 'WA2HX4P3E60', 'details')
    await setReleaseNow(page)

    const info = await page.evaluate(`(() => {
      const fields = [...document.querySelectorAll('input[type="hidden"], input[type="radio"], select')]
        .filter(el => /release|publish|publication|previously|eligib|future|event/i.test((el.name||'') + (el.id||'')))
        .map(el => ({
          tag: el.tagName,
          id: el.id,
          name: el.name,
          type: el.type,
          value: el.value,
          checked: el.checked,
        }))
      const categoryFields = [...document.querySelectorAll('input[name*="browse_node"], #section-categories input')]
        .map(el => ({ name: el.name, value: el.value, id: el.id }))
      return { fields, categoryFields }
    })()`)
    console.log(JSON.stringify(info, null, 2))
  },
  { headless: false },
)
