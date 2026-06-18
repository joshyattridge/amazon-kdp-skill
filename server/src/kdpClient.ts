import { chromium, type Page } from 'playwright'
import { KDP_API, KDP_PMR_PAGE, KDP_ROYALTIES_PAGE } from './config.js'
import { kdpFetchJson, kdpFetchText, kdpGoto, kdpRequestGet } from './kdpHttp.js'
import { mergeWorkbookBuffers } from './mergeWorkbooks.js'
import { sessionExists, sessionFilePath } from './session.js'

export class KdpAuthError extends Error {
  constructor(message = 'Amazon KDP session expired or not connected.') {
    super(message)
    this.name = 'KdpAuthError'
  }
}

export class KdpClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KdpClientError'
  }
}

type PmrGenerateResponse = {
  url?: string
  status?: string
  available?: boolean
}

type AccountInfoResponse = {
  customerAccountInfoModel?: {
    accountCreationDate?: string
  }
}

function monthKeysFromAccountCreation(accountCreationIso: string): string[] {
  const created = new Date(accountCreationIso)
  const now = new Date()
  const months: string[] = []
  const cursor = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  while (cursor <= end) {
    months.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
    )
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

function filterMonthsInRange(
  months: string[],
  startMonth?: string,
  endMonth?: string,
): string[] {
  let filtered = months
  if (startMonth) {
    filtered = filtered.filter((m) => m >= startMonth.slice(0, 7))
  }
  if (endMonth) {
    filtered = filtered.filter((m) => m <= endMonth.slice(0, 7))
  }
  return filtered
}

async function withKdpPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  if (!(await sessionExists())) {
    throw new KdpAuthError()
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })

  try {
    const context = await browser.newContext({ storageState: sessionFilePath() })
    const page = await context.newPage()
    await kdpGoto(page, KDP_ROYALTIES_PAGE, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    })

    if (page.url().toLowerCase().includes('signin')) {
      throw new KdpAuthError()
    }

    return await fn(page)
  } finally {
    await browser.close()
  }
}

async function getAccountCreationDate(page: Page): Promise<string> {
  const data = await kdpFetchJson<AccountInfoResponse>(page, KDP_API.accountInfo)
  const date = data?.customerAccountInfoModel?.accountCreationDate ?? null

  if (!date) {
    throw new KdpClientError('Could not read your KDP account creation date.')
  }
  return date
}

async function requestPmrReportUrl(
  page: Page,
  selectedMonth: string,
): Promise<string> {
  const pmrUrl = `${KDP_API.pmrReport}?selectedMonth=${encodeURIComponent(selectedMonth)}&reportType=KDP_PMR`

  for (let attempt = 0; attempt < 45; attempt++) {
    const res = await kdpFetchText(page, pmrUrl)
    if (!res.ok) {
      throw new KdpClientError(`PMR request failed (${res.status}) for ${selectedMonth}`)
    }

    let data: PmrGenerateResponse
    try {
      data = JSON.parse(res.text) as PmrGenerateResponse
    } catch {
      throw new KdpClientError(`Unexpected PMR response for ${selectedMonth}`)
    }

    if (data.url) {
      return data.url
    }
    if (data.status === 'ERROR') {
      throw new KdpClientError(`KDP could not generate the ${selectedMonth} report.`)
    }

    await new Promise((r) => setTimeout(r, 1000))
  }

  throw new KdpClientError(`Timed out waiting for ${selectedMonth} report.`)
}

/** Verify saved session can load the KDP reports dashboard. */
export async function checkSession(): Promise<{
  connected: boolean
  accountCreationDate?: string
}> {
  if (!(await sessionExists())) {
    return { connected: false }
  }

  try {
    return await withKdpPage(async (page) => {
      const accountCreationDate = await getAccountCreationDate(page)
      return { connected: true, accountCreationDate }
    })
  } catch (e) {
    if (e instanceof KdpAuthError || e instanceof KdpClientError) {
      return { connected: false }
    }
    throw e
  }
}

/** Download Prior Months' Royalties reports and merge into one .xlsx. */
export async function downloadRoyaltiesReport(options: {
  startMonth?: string
  endMonth?: string
} = {}): Promise<{
  buffer: Buffer
  startDate: string
  endDate: string
  monthsDownloaded: number
}> {
  return withKdpPage(async (page) => {
    await kdpGoto(page, KDP_PMR_PAGE, { waitUntil: 'networkidle', timeout: 120_000 })
    if (page.url().toLowerCase().includes('signin')) {
      throw new KdpAuthError()
    }

    const accountCreationDate = await getAccountCreationDate(page)
    const allMonths = monthKeysFromAccountCreation(accountCreationDate)
    const months = filterMonthsInRange(allMonths, options.startMonth, options.endMonth)
    if (months.length === 0) {
      throw new KdpClientError('No report months in the requested date range.')
    }

    const buffers: Buffer[] = []
    for (const month of months) {
      const reportUrl = await requestPmrReportUrl(page, month)
      const downloadRes = await kdpRequestGet(page, reportUrl)
      if (!downloadRes.ok()) {
        throw new KdpClientError(
          `Failed to download ${month} report (${downloadRes.status()}).`,
        )
      }
      const buffer = Buffer.from(await downloadRes.body())
      if (buffer.length > 100) {
        buffers.push(buffer)
      }
    }

    if (buffers.length === 0) {
      throw new KdpClientError('Amazon returned no report data for the requested range.')
    }

    const merged = mergeWorkbookBuffers(buffers)
    const startDate = `${months[0]}-01T00:00:00Z`
    const endParts = months[months.length - 1].split('-').map(Number)
    const end = new Date(Date.UTC(endParts[0], endParts[1], 0, 23, 59, 59))

    return {
      buffer: merged,
      startDate,
      endDate: end.toISOString().slice(0, 19) + 'Z',
      monthsDownloaded: buffers.length,
    }
  })
}

/** Download all PMR months from account creation through today. */
export async function downloadLifetimeRoyaltiesReport(): Promise<{
  buffer: Buffer
  startDate: string
  endDate: string
  monthsDownloaded: number
}> {
  return downloadRoyaltiesReport()
}
