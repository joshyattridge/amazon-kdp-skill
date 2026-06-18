import { createTitleOnPage, openSetupStep } from '../server/src/kdpCreateTitle.js'
import { assignFreeKdpIsbn } from '../server/src/kdpContentUpdate.js'
import { withKdpPage } from '../server/src/kdpMetadata.js'
import { clickSaveAsDraft } from '../server/src/kdpWizard.js'
import fs from 'node:fs'

const FILL = fs.readFileSync('server/browser/fillBookDetails.js', 'utf8')

await withKdpPage(async (page) => {
  await createTitleOnPage(page, 'paperback')
  await page.evaluate(`(${FILL})('paperback', ${JSON.stringify({
    title: 'ISBN Probe',
    primaryAuthor: { firstName: 'Jane', lastName: 'Author' },
    isAdultContent: false,
  })})`)
  await clickSaveAsDraft(page)
  await page.waitForTimeout(3000)
  const titleId = page.url().match(/paperback\/([A-Z0-9]{10,14})/)?.[1]
  if (!titleId) throw new Error('No titleId')
  console.log('titleId', titleId)
  await openSetupStep(page, 'paperback', titleId, 'content')
  const isbn = await assignFreeKdpIsbn(page)
  console.log('ISBN:', isbn)
})
