import cors from 'cors'
import express from 'express'
import { fetchAccountInfo, fetchReportsCatalog } from './kdpAccount.js'
import { analyzeBookMetadata } from './kdpAnalyze.js'
import { type KdpCategorySpec } from './kdpCategories.js'
import { uploadBookContent, uploadBookContentBatch } from './kdpContentUpdate.js'
import {
  createTitle,
  publishBook,
  type PublishBookRequest,
  updateCategories,
} from './kdpPublish.js'
import {
  archiveTitle,
  deleteTitle,
  unpublishTitle,
} from './kdpTitleActions.js'
import {
  checkSession,
  downloadLifetimeRoyaltiesReport,
  downloadRoyaltiesReport,
  KdpAuthError,
  KdpClientError,
} from './kdpClient.js'
import {
  listBookshelf,
  syncAllBookMetadata,
  syncBookMetadata,
} from './kdpMetadata.js'
import {
  type KdpMetadataChanges,
  updateBookMetadata,
  updateBookMetadataBatch,
} from './kdpMetadataUpdate.js'
import {
  type KdpPricingChanges,
  updateBookPricing,
  updateBookPricingBatch,
} from './kdpPricingUpdate.js'
import { getLoginState, startInteractiveLogin } from './login.js'
import {
  METADATA_CACHE_VERSION,
  readMetadataCache,
  removeMetadataCache,
  type KdpBookFormat,
} from './metadataStore.js'
import { readSessionMeta, removeSession } from './session.js'
import { PORT } from './config.js'

const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

app.get('/api/kdp/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/kdp/status', async (_req, res) => {
  try {
    const [{ connected, accountCreationDate }, meta, login] = await Promise.all([
      checkSession(),
      readSessionMeta(),
      Promise.resolve(getLoginState()),
    ])
    res.json({
      connected,
      accountCreationDate: accountCreationDate ?? null,
      sessionSavedAt: meta.savedAt,
      loginInProgress: login.loginInProgress,
      loginError: login.loginError,
    })
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : 'Failed to read KDP status.',
    })
  }
})

app.post('/api/kdp/login/start', async (_req, res) => {
  try {
    const login = getLoginState()
    if (login.loginInProgress) {
      res.status(409).json({ error: 'Login already in progress.' })
      return
    }
    await startInteractiveLogin()
    res.json({ started: true })
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : 'Could not start login.',
    })
  }
})

app.delete('/api/kdp/session', async (_req, res) => {
  await removeSession()
  await removeMetadataCache()
  res.json({ disconnected: true })
})

app.get('/api/kdp/account', async (_req, res) => {
  try {
    res.json(await fetchAccountInfo())
  } catch (e) {
    handleKdpError(res, e, 'Could not fetch account info.')
  }
})

app.get('/api/kdp/catalog', async (_req, res) => {
  try {
    const books = await fetchReportsCatalog()
    res.json({ count: books.length, books })
  } catch (e) {
    handleKdpError(res, e, 'Could not fetch reports catalog.')
  }
})

app.get('/api/kdp/bookshelf', async (_req, res) => {
  try {
    res.json(await listBookshelf())
  } catch (e) {
    handleKdpError(res, e, 'Could not list bookshelf.')
  }
})

app.get('/api/kdp/metadata', async (_req, res) => {
  const cache = await readMetadataCache()
  const cacheVersion = cache?.cacheVersion ?? 1
  res.json({
    syncedAt: cache?.syncedAt ?? null,
    cacheVersion,
    cacheStale: cacheVersion < METADATA_CACHE_VERSION,
    books: cache?.books ?? [],
    count: cache?.books.length ?? 0,
    stats: cache?.stats ?? null,
  })
})

app.get('/api/kdp/metadata/analyze', async (_req, res) => {
  const cache = await readMetadataCache()
  if (!cache?.books.length) {
    res.status(400).json({ error: 'No metadata cache. Run sync first.', code: 'validation' })
    return
  }
  res.json(analyzeBookMetadata(cache.books))
})

app.post('/api/kdp/metadata/sync', async (_req, res) => {
  try {
    const cache = await syncAllBookMetadata()
    res.json(formatCacheResponse(cache))
  } catch (e) {
    handleKdpError(res, e, 'Metadata sync failed.')
  }
})

app.post('/api/kdp/metadata/sync/:titleId/:format', async (req, res) => {
  try {
    const format = parseFormat(req.params.format)
    if (!format) {
      res.status(400).json({ error: 'Invalid format.', code: 'validation' })
      return
    }
    const book = await syncBookMetadata(req.params.titleId, format)
    res.json({ book })
  } catch (e) {
    handleKdpError(res, e, 'Single book sync failed.')
  }
})

app.post('/api/kdp/metadata/update', async (req, res) => {
  try {
    const parsed = parseUpdateBody(req.body)
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, code: 'validation' })
      return
    }
    const result = await updateBookMetadata(
      parsed.titleId,
      parsed.format,
      parsed.changes,
      { dryRun: parsed.dryRun },
    )
    res.json(result)
  } catch (e) {
    handleKdpError(res, e, 'Metadata update failed.')
  }
})

app.post('/api/kdp/metadata/update/batch', async (req, res) => {
  try {
    const { updates, dryRun } = req.body as {
      updates?: Array<Record<string, unknown>>
      dryRun?: boolean
    }
    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({ error: 'updates array is required.', code: 'validation' })
      return
    }
    const parsed = []
    for (const item of updates) {
      const result = parseUpdateBody({ ...item, dryRun })
      if ('error' in result) {
        res.status(400).json({ error: result.error, code: 'validation' })
        return
      }
      parsed.push(result)
    }
    res.json(await updateBookMetadataBatch(parsed, { dryRun: dryRun === true }))
  } catch (e) {
    handleKdpError(res, e, 'Batch metadata update failed.')
  }
})

app.post('/api/kdp/pricing/update', async (req, res) => {
  try {
    const parsed = parsePricingUpdateBody(req.body)
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, code: 'validation' })
      return
    }
    res.json(
      await updateBookPricing(parsed.titleId, parsed.format, parsed.changes, {
        dryRun: parsed.dryRun,
      }),
    )
  } catch (e) {
    handleKdpError(res, e, 'Pricing update failed.')
  }
})

app.post('/api/kdp/pricing/update/batch', async (req, res) => {
  try {
    const { updates, dryRun } = req.body as {
      updates?: Array<Record<string, unknown>>
      dryRun?: boolean
    }
    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({ error: 'updates array is required.', code: 'validation' })
      return
    }
    const parsed = []
    for (const item of updates) {
      const result = parsePricingUpdateBody({ ...item, dryRun })
      if ('error' in result) {
        res.status(400).json({ error: result.error, code: 'validation' })
        return
      }
      parsed.push(result)
    }
    res.json(await updateBookPricingBatch(parsed, { dryRun: dryRun === true }))
  } catch (e) {
    handleKdpError(res, e, 'Batch pricing update failed.')
  }
})

app.post('/api/kdp/content/upload', async (req, res) => {
  try {
    const { titleId, format, fileType, filePath, dryRun } = req.body as {
      titleId?: string
      format?: unknown
      fileType?: string
      filePath?: string
      dryRun?: boolean
    }
    const fmt = parseFormat(format)
    if (!titleId || !fmt) {
      res.status(400).json({ error: 'titleId and format are required.', code: 'validation' })
      return
    }
    if (fileType !== 'interior' && fileType !== 'cover') {
      res.status(400).json({ error: 'fileType must be interior or cover.', code: 'validation' })
      return
    }
    if (!filePath) {
      res.status(400).json({ error: 'filePath is required.', code: 'validation' })
      return
    }
    res.json(
      await uploadBookContent(titleId, fmt, fileType, filePath, {
        dryRun: dryRun === true,
      }),
    )
  } catch (e) {
    handleKdpError(res, e, 'Content upload failed.')
  }
})

app.post('/api/kdp/content/upload/batch', async (req, res) => {
  try {
    const { uploads, dryRun } = req.body as {
      uploads?: Array<{
        titleId?: string
        format?: unknown
        fileType?: string
        filePath?: string
      }>
      dryRun?: boolean
    }
    if (!Array.isArray(uploads) || uploads.length === 0) {
      res.status(400).json({ error: 'uploads array is required.', code: 'validation' })
      return
    }
    const parsed = []
    for (const item of uploads) {
      const fmt = parseFormat(item.format)
      if (!item.titleId || !fmt) {
        res.status(400).json({ error: 'Each upload needs titleId and format.', code: 'validation' })
        return
      }
      if (item.fileType !== 'interior' && item.fileType !== 'cover') {
        res.status(400).json({ error: 'fileType must be interior or cover.', code: 'validation' })
        return
      }
      if (!item.filePath) {
        res.status(400).json({ error: 'filePath is required.', code: 'validation' })
        return
      }
      parsed.push({
        titleId: item.titleId,
        format: fmt,
        fileType: item.fileType as 'interior' | 'cover',
        filePath: item.filePath,
      })
    }
    res.json(await uploadBookContentBatch(parsed, { dryRun: dryRun === true }))
  } catch (e) {
    handleKdpError(res, e, 'Batch content upload failed.')
  }
})

app.post('/api/kdp/titles/create', async (req, res) => {
  try {
    const format = parseFormat(req.body?.format)
    if (!format) {
      res.status(400).json({ error: 'format is required (kindle|paperback|hardcover).', code: 'validation' })
      return
    }
    res.json(await createTitle(format))
  } catch (e) {
    handleKdpError(res, e, 'Create title failed.')
  }
})

app.post('/api/kdp/categories/update', async (req, res) => {
  try {
    const parsed = parseCategoriesBody(req.body)
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, code: 'validation' })
      return
    }
    res.json(
      await updateCategories(parsed.titleId, parsed.format, parsed.categories, {
        isAdultContent: parsed.isAdultContent,
      }),
    )
  } catch (e) {
    handleKdpError(res, e, 'Category update failed.')
  }
})

app.post('/api/kdp/publish', async (req, res) => {
  req.setTimeout(1_200_000)
  res.setTimeout(1_200_000)
  try {
    const parsed = parsePublishBody(req.body)
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, code: 'validation' })
      return
    }
    res.json(await publishBook(parsed))
  } catch (e) {
    handleKdpError(res, e, 'Publish flow failed.')
  }
})

app.post('/api/kdp/titles/unpublish', async (req, res) => {
  try {
    const { titleId, format } = req.body as { titleId?: string; format?: unknown }
    const fmt = parseFormat(format)
    if (!titleId || !fmt) {
      res.status(400).json({ error: 'titleId and format are required.', code: 'validation' })
      return
    }
    res.json(await unpublishTitle(titleId, fmt))
  } catch (e) {
    handleKdpError(res, e, 'Unpublish failed.')
  }
})

app.post('/api/kdp/titles/delete', async (req, res) => {
  try {
    const { titleId, format } = req.body as { titleId?: string; format?: unknown }
    const fmt = parseFormat(format)
    if (!titleId || !fmt) {
      res.status(400).json({ error: 'titleId and format are required.', code: 'validation' })
      return
    }
    res.json(await deleteTitle(titleId, fmt))
  } catch (e) {
    handleKdpError(res, e, 'Delete failed.')
  }
})

app.post('/api/kdp/titles/archive', async (req, res) => {
  try {
    const { titleId, format } = req.body as { titleId?: string; format?: unknown }
    const fmt = parseFormat(format)
    if (!titleId || !fmt) {
      res.status(400).json({ error: 'titleId and format are required.', code: 'validation' })
      return
    }
    res.json(await archiveTitle(titleId, fmt))
  } catch (e) {
    handleKdpError(res, e, 'Archive failed.')
  }
})

app.post('/api/kdp/sync', async (_req, res) => {
  try {
    const { buffer, startDate, endDate, monthsDownloaded } =
      await downloadLifetimeRoyaltiesReport()
    sendReportXlsx(res, buffer, startDate, endDate, monthsDownloaded)
  } catch (e) {
    handleKdpError(res, e, 'Sync failed.')
  }
})

app.post('/api/kdp/reports/download', async (req, res) => {
  try {
    const { startMonth, endMonth } = req.body as {
      startMonth?: string
      endMonth?: string
    }
    const { buffer, startDate, endDate, monthsDownloaded } =
      await downloadRoyaltiesReport({ startMonth, endMonth })
    sendReportXlsx(res, buffer, startDate, endDate, monthsDownloaded)
  } catch (e) {
    handleKdpError(res, e, 'Report download failed.')
  }
})

function sendReportXlsx(
  res: express.Response,
  buffer: Buffer,
  startDate: string,
  endDate: string,
  monthsDownloaded: number,
): void {
  const filename = `kdp-royalties-${startDate.slice(0, 10)}_${endDate.slice(0, 10)}.xlsx`
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('X-KDP-Report-Start', startDate)
  res.setHeader('X-KDP-Report-End', endDate)
  res.setHeader('X-KDP-Months-Downloaded', String(monthsDownloaded))
  res.send(buffer)
}

function formatCacheResponse(cache: Awaited<ReturnType<typeof syncAllBookMetadata>>) {
  return {
    syncedAt: cache.syncedAt,
    cacheVersion: cache.cacheVersion ?? METADATA_CACHE_VERSION,
    cacheStale: false,
    books: cache.books,
    count: cache.books.length,
    stats: cache.stats ?? null,
  }
}

function parseFormat(value: unknown): KdpBookFormat | null {
  if (value === 'kindle' || value === 'paperback' || value === 'hardcover') return value
  return null
}

function parseMetadataChanges(body: unknown): KdpMetadataChanges | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as Record<string, unknown>
  const changes: KdpMetadataChanges = {}
  if (typeof raw.title === 'string') changes.title = raw.title
  if (typeof raw.subtitle === 'string') changes.subtitle = raw.subtitle
  if (typeof raw.description === 'string') changes.description = raw.description
  if (typeof raw.descriptionHtml === 'string') changes.descriptionHtml = raw.descriptionHtml
  if (typeof raw.seriesTitle === 'string') changes.seriesTitle = raw.seriesTitle
  if (typeof raw.seriesNumber === 'string') changes.seriesNumber = raw.seriesNumber
  if (typeof raw.language === 'string') changes.language = raw.language
  if (typeof raw.publisherLabel === 'string') changes.publisherLabel = raw.publisherLabel
  if (typeof raw.editionNumber === 'string') changes.editionNumber = raw.editionNumber
  if (typeof raw.readingInterestAgeMin === 'string') {
    changes.readingInterestAgeMin = raw.readingInterestAgeMin
  }
  if (typeof raw.readingInterestAgeMax === 'string') {
    changes.readingInterestAgeMax = raw.readingInterestAgeMax
  }
  if (typeof raw.isPublicDomain === 'boolean') changes.isPublicDomain = raw.isPublicDomain
  if (typeof raw.isAdultContent === 'boolean') changes.isAdultContent = raw.isAdultContent
  if (typeof raw.largePrint === 'boolean') changes.largePrint = raw.largePrint
  if (Array.isArray(raw.keywords)) {
    changes.keywords = raw.keywords.filter((k): k is string => typeof k === 'string')
  }
  if (raw.primaryAuthor && typeof raw.primaryAuthor === 'object') {
    const pa = raw.primaryAuthor as Record<string, unknown>
    changes.primaryAuthor = {}
    if (typeof pa.firstName === 'string') changes.primaryAuthor.firstName = pa.firstName
    if (typeof pa.lastName === 'string') changes.primaryAuthor.lastName = pa.lastName
  }
  if (Array.isArray(raw.contributors)) {
    changes.contributors = raw.contributors.filter(
      (c): c is { role: string; firstName: string; lastName: string } =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as Record<string, unknown>).role === 'string' &&
        typeof (c as Record<string, unknown>).firstName === 'string' &&
        typeof (c as Record<string, unknown>).lastName === 'string',
    )
  }
  return Object.keys(changes).length > 0 ? changes : null
}

function parsePricingChanges(body: unknown): KdpPricingChanges | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as Record<string, unknown>
  const changes: KdpPricingChanges = {}
  if (typeof raw.listPriceUsd === 'string') changes.listPriceUsd = raw.listPriceUsd
  if (raw.prices && typeof raw.prices === 'object') {
    changes.prices = Object.fromEntries(
      Object.entries(raw.prices as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  }
  if (raw.territory === 'worldwide' || raw.territory === 'individual') {
    changes.territory = raw.territory
  }
  if (typeof raw.royaltyPlan === 'string') changes.royaltyPlan = raw.royaltyPlan
  if (typeof raw.kdpSelect === 'boolean') changes.kdpSelect = raw.kdpSelect
  return Object.keys(changes).length > 0 ? changes : null
}

function parseUpdateBody(body: unknown):
  | { titleId: string; format: KdpBookFormat; changes: KdpMetadataChanges; dryRun: boolean }
  | { error: string } {
  const raw = body as Record<string, unknown>
  const titleId = raw.titleId
  const format = parseFormat(raw.format)
  if (typeof titleId !== 'string' || !format) {
    return { error: 'titleId and format (kindle|paperback|hardcover) are required.' }
  }
  const changes = parseMetadataChanges(raw.changes ?? raw)
  if (!changes) return { error: 'At least one metadata change is required.' }
  return { titleId, format, changes, dryRun: raw.dryRun === true }
}

function parsePricingUpdateBody(body: unknown):
  | { titleId: string; format: KdpBookFormat; changes: KdpPricingChanges; dryRun: boolean }
  | { error: string } {
  const raw = body as Record<string, unknown>
  const titleId = raw.titleId
  const format = parseFormat(raw.format)
  if (typeof titleId !== 'string' || !format) {
    return { error: 'titleId and format are required.' }
  }
  const changes = parsePricingChanges(raw.changes ?? raw)
  if (!changes) return { error: 'At least one pricing change is required.' }
  return { titleId, format, changes, dryRun: raw.dryRun === true }
}

function parseCategorySpec(raw: unknown): KdpCategorySpec | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (Array.isArray(item.path) && item.path.every((p) => typeof p === 'string')) {
    return { path: item.path as string[] }
  }
  if (typeof item.browseNodeId === 'string') {
    return { browseNodeId: item.browseNodeId }
  }
  return null
}

function parseCategoriesBody(body: unknown):
  | {
      titleId: string
      format: KdpBookFormat
      categories: KdpCategorySpec[]
      isAdultContent?: boolean
    }
  | { error: string } {
  const raw = body as Record<string, unknown>
  const titleId = raw.titleId
  const format = parseFormat(raw.format)
  if (typeof titleId !== 'string' || !format) {
    return { error: 'titleId and format are required.' }
  }
  if (!Array.isArray(raw.categories) || raw.categories.length === 0) {
    return { error: 'categories array is required.' }
  }
  const categories: KdpCategorySpec[] = []
  for (const item of raw.categories) {
    const spec = parseCategorySpec(item)
    if (!spec) return { error: 'Each category needs path[] or browseNodeId.' }
    categories.push(spec)
  }
  return {
    titleId,
    format,
    categories,
    isAdultContent:
      typeof raw.isAdultContent === 'boolean' ? raw.isAdultContent : undefined,
  }
}

function parsePublishBody(body: unknown): PublishBookRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body is required.' }
  const raw = body as Record<string, unknown>
  const format = parseFormat(raw.format)
  if (!format) return { error: 'format is required.' }

  const request: PublishBookRequest = {
    format,
    dryRun: raw.dryRun === true,
    publish: raw.publish === true,
    create: raw.create === true,
  }

  if (typeof raw.titleId === 'string') request.titleId = raw.titleId

  if (raw.details && typeof raw.details === 'object') {
    const details = parseMetadataChanges(raw.details)
    if (details) request.details = details
  }

  if (Array.isArray(raw.categories)) {
    const categories: KdpCategorySpec[] = []
    for (const item of raw.categories) {
      const spec = parseCategorySpec(item)
      if (!spec) return { error: 'Invalid category entry.' }
      categories.push(spec)
    }
    request.categories = categories
  }

  if (raw.content && typeof raw.content === 'object') {
    const c = raw.content as Record<string, unknown>
    request.content = {}
    if (typeof c.interiorPath === 'string') request.content.interiorPath = c.interiorPath
    if (typeof c.coverPath === 'string') request.content.coverPath = c.coverPath
  }

  if (raw.pricing && typeof raw.pricing === 'object') {
    const pricing = parsePricingChanges(raw.pricing)
    if (pricing) request.pricing = pricing
  }

  if (!request.create && !request.titleId) {
    return { error: 'Provide titleId or set create=true.' }
  }

  return request
}

function handleKdpError(res: express.Response, e: unknown, fallback: string): void {
  if (e instanceof KdpAuthError) {
    res.status(401).json({ error: e.message, code: 'auth' })
    return
  }
  if (e instanceof KdpClientError) {
    res.status(502).json({ error: e.message, code: 'kdp' })
    return
  }
  res.status(500).json({
    error: e instanceof Error ? e.message : fallback,
    code: 'unknown',
  })
}

app.listen(PORT, () => {
  console.log(`KDP sync server listening on http://localhost:${PORT}`)
})
