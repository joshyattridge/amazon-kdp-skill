import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

export const PORT = Number(process.env.KDP_SERVER_PORT || 3001)

/** Minimum gap between KDP page loads and API calls. Supports legacy KDP_UPDATE_DELAY_MS. */
export const KDP_REQUEST_DELAY_MS = Number(
  process.env.KDP_REQUEST_DELAY_MS ||
    process.env.KDP_UPDATE_DELAY_MS ||
    4000,
)

/** Directory for Playwright storage state (Amazon session cookies). */
export const SESSION_DIR =
  process.env.KDP_SESSION_DIR || path.join(repoRoot, '.kdp-session')

export const SESSION_FILE = path.join(SESSION_DIR, 'amazon-kdp.json')

export const KDP_REPORTS_ORIGIN = 'https://kdpreports.amazon.com'

export const KDP_ROYALTIES_PAGE = `${KDP_REPORTS_ORIGIN}/reports/royalties`

export const KDP_PMR_PAGE = `${KDP_REPORTS_ORIGIN}/reports/pmr`

export const KDP_API = {
  accountInfo: `${KDP_REPORTS_ORIGIN}/metadata/customer/accountInfo`,
  /** Full catalog: titles, ASINs, authors (no titleId — use Bookshelf for that). */
  reportsMetadata: `${KDP_REPORTS_ORIGIN}/metadata/reports/reportsMetadata`,
  customerMetadata: `${KDP_REPORTS_ORIGIN}/api/v2/reports/customerMetadata`,
  booksMetadata: `${KDP_REPORTS_ORIGIN}/api/v2/reports/booksMetadata`,
  pagesReadByAsin: `${KDP_REPORTS_ORIGIN}/api/v2/reports/pagesReadByAsin`,
  /** Amazon’s URL uses `.xslx` (typo) — keep as-is. */
  generateReport: `${KDP_REPORTS_ORIGIN}/download/report/royaltiesestimator/en_US/royaltiesEstimatorReport.xslx`,
  pmrReport: `${KDP_REPORTS_ORIGIN}/download/report/pmr/en_US/pmrReport.xslx`,
} as const
