import type { Page } from 'playwright'
import { ensureReleaseDateScheduled, setReleaseNow } from './kdpCreateTitle.js'
import {
  approveManuscriptIfNeeded,
  saveContentPage,
  selectPdfCoverUploadOption,
} from './kdpContentWait.js'
import { clickKdpActionButton, dismissKdpOverlays } from './kdpUiHelpers.js'
import { bypassServerBusy, collectPageErrors } from './kdpWizard.js'
import {
  readRecoveryLearnings,
  recordRecoveryOutcome,
  type RecoveryActionId,
  type RecoveryContext,
  type RecoveryLearning,
} from './kdpRecoveryStore.js'

export type { RecoveryActionId, RecoveryContext, RecoveryLearning }

export type RecoveryRunContext = {
  step: RecoveryContext
  language?: string
}

export type RecoveryAttempt = {
  attempt: number
  errors: string[]
  actions: RecoveryActionId[]
  fromLearnings: boolean
}

type PlaybookRule = {
  pattern: RegExp
  actions: RecoveryActionId[]
  contexts?: RecoveryContext[]
}

const DEFAULT_PLAYBOOK: PlaybookRule[] = [
  {
    pattern: /intercepts pointer|a-modal-scroller|popover|modal-scroller/i,
    actions: ['dismiss_overlays', 'ack_upload_interrupt'],
  },
  {
    pattern: /release date.*(?:past|too soon)|schedule my book/i,
    actions: ['schedule_release_date'],
    contexts: ['details', 'publish', 'any'],
  },
  {
    pattern: /preview and approve|approve these changes|launch previewer|approved your manuscript/i,
    actions: ['approve_manuscript_preview'],
    contexts: ['content', 'pricing', 'publish', 'any'],
  },
  {
    pattern: /pricing will be available|not available until/i,
    actions: ['approve_manuscript_preview', 'wait_processing'],
    contexts: ['pricing', 'publish', 'any'],
  },
  {
    pattern: /server busy/i,
    actions: ['bypass_server_busy', 'wait_processing', 'reload_page'],
  },
  {
    pattern: /language that was entered|primary marketplace changed/i,
    actions: ['schedule_release_date', 'dismiss_overlays'],
    contexts: ['details', 'publish', 'any'],
  },
  {
    pattern: /please provide a pdf|upload your cover|cover file/i,
    actions: ['select_pdf_cover_upload', 'dismiss_overlays'],
    contexts: ['content', 'publish', 'any'],
  },
  {
    pattern: /minimum of 72|only has \d+ page\(s\) but must have a minimum of 72/i,
    actions: ['select_premium_color'],
    contexts: ['content', 'publish', 'any'],
  },
  {
    pattern: /timeout.*exceeded|timed out waiting/i,
    actions: ['dismiss_overlays', 'reload_page', 'wait_processing'],
  },
  {
    pattern: /changes were not applied|could not save|could not click/i,
    actions: ['dismiss_overlays', 'schedule_release_date', 'save_as_draft'],
    contexts: ['details', 'content', 'pricing', 'publish', 'any'],
  },
]

function contextMatches(rule: PlaybookRule, step: RecoveryContext): boolean {
  if (!rule.contexts || rule.contexts.length === 0) return true
  return rule.contexts.includes(step) || rule.contexts.includes('any')
}

function learningScore(entry: RecoveryLearning): number {
  const total = entry.successCount + entry.failureCount
  if (total === 0) return 0
  return entry.successCount / total + Math.min(entry.successCount, 10) * 0.05
}

export function planRecoveryActions(
  errors: string[],
  step: RecoveryContext,
  learnings: RecoveryLearning[],
): { actions: RecoveryActionId[]; matchedPatterns: string[]; fromLearnings: boolean } {
  const haystack = errors.join('\n').toLowerCase()
  if (!haystack.trim()) return { actions: [], matchedPatterns: [], fromLearnings: false }

  const matchedPatterns = new Set<string>()
  const actionScores = new Map<RecoveryActionId, number>()
  let usedLearnings = false

  for (const entry of learnings) {
    if (entry.context !== step && entry.context !== 'any') continue
    try {
      const re = new RegExp(entry.errorPattern, 'i')
      if (!re.test(haystack)) continue
      matchedPatterns.add(entry.errorPattern)
      const score = learningScore(entry)
      if (score <= 0) continue
      usedLearnings = true
      actionScores.set(entry.action, Math.max(actionScores.get(entry.action) ?? 0, score + 1))
    } catch {
      /* invalid stored pattern */
    }
  }

  for (const rule of DEFAULT_PLAYBOOK) {
    if (!contextMatches(rule, step)) continue
    if (!rule.pattern.test(haystack)) continue
    matchedPatterns.add(rule.pattern.source)
    for (const action of rule.actions) {
      actionScores.set(action, Math.max(actionScores.get(action) ?? 0, 1))
    }
  }

  const actions = [...actionScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([action]) => action)

  return {
    actions: dedupeActions(actions),
    matchedPatterns: [...matchedPatterns],
    fromLearnings: usedLearnings,
  }
}

function dedupeActions(actions: RecoveryActionId[]): RecoveryActionId[] {
  const seen = new Set<RecoveryActionId>()
  const out: RecoveryActionId[] = []
  for (const action of actions) {
    if (seen.has(action)) continue
    seen.add(action)
    out.push(action)
  }
  return out
}

export async function executeRecoveryAction(
  page: Page,
  action: RecoveryActionId,
  runCtx: RecoveryRunContext,
): Promise<void> {
  switch (action) {
    case 'dismiss_overlays':
      await dismissKdpOverlays(page)
      break
    case 'ack_upload_interrupt': {
      const ack = page.locator('#uploading-interrupt-ack-announce')
      if (await ack.isVisible({ timeout: 1000 }).catch(() => false)) {
        await ack.click({ timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(500)
      }
      break
    }
    case 'schedule_release_date':
      await setReleaseNow(page)
      await ensureReleaseDateScheduled(page)
      break
    case 'approve_manuscript_preview':
      await approveManuscriptIfNeeded(page)
      break
    case 'select_pdf_cover_upload':
      await selectPdfCoverUploadOption(page)
      break
    case 'select_premium_color':
      await page.evaluate(`(() => {
        const el = document.querySelector('input[name="data[print_book][ink_and_paper]"][value="COLOR_COLOR"]')
        if (el) {
          el.checked = true
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })()`)
      await page.waitForTimeout(1500)
      break
    case 'bypass_server_busy':
      await bypassServerBusy(page)
      break
    case 'wait_processing':
      await page.waitForTimeout(8000)
      break
    case 'reload_page':
      await page.reload({ waitUntil: 'networkidle', timeout: 120_000 }).catch(() => {})
      await page.waitForTimeout(2000)
      break
    case 'save_as_draft':
      if (runCtx.step === 'content') {
        await saveContentPage(page).catch(() => {})
      } else {
        await clickKdpActionButton(page, {
          buttonIds: ['save-announce', 'save-and-continue-announce'],
          labels: ['Save as Draft', 'Save and Continue', 'Save'],
        }).catch(() => {})
      }
      break
  }
}

export async function gatherBlockers(page: Page, extraErrors: string[] = []): Promise<string[]> {
  const pageErrors = await collectPageErrors(page).catch(() => [])
  const bodyHints = (await page
    .evaluate(`(() => {
      const text = (document.body?.innerText || '').replace(/\\s+/g, ' ')
      const hints = []
      const patterns = [
        /preview and approve[^.]{0,120}/i,
        /release date[^.]{0,120}/i,
        /Server Busy/i,
        /pricing will be available[^.]{0,120}/i,
        /Please provide a PDF[^.]{0,80}/i,
        /intercepts pointer events/i,
      ]
      for (const p of patterns) {
        const m = text.match(p)
        if (m) hints.push(m[0].trim())
      }
      return hints
    })()`)
    .catch(() => [])) as string[]

  return [...new Set([...extraErrors, ...pageErrors, ...bodyHints].filter(Boolean))]
}

export async function recoverFromBlockers(
  page: Page,
  errors: string[],
  runCtx: RecoveryRunContext,
): Promise<RecoveryAttempt> {
  const learnings = (await readRecoveryLearnings()).entries
  const { actions, fromLearnings } = planRecoveryActions(errors, runCtx.step, learnings)

  for (const action of actions) {
    await executeRecoveryAction(page, action, runCtx).catch(() => {})
  }

  return {
    attempt: 0,
    errors,
    actions,
    fromLearnings,
  }
}

export type RunWithRecoveryOptions<T> = {
  maxAttempts?: number
  collectErrors?: (page: Page, err?: unknown) => Promise<string[]>
  verify?: (result: T, page: Page) => Promise<boolean>
}

export async function runWithRecovery<T>(
  page: Page,
  runCtx: RecoveryRunContext,
  fn: () => Promise<T>,
  options: RunWithRecoveryOptions<T> = {},
): Promise<{ result: T; recoveryLog: RecoveryAttempt[] }> {
  const maxAttempts = options.maxAttempts ?? 4
  const collectErrors =
    options.collectErrors ??
    (async (p, err) =>
      gatherBlockers(
        p,
        err instanceof Error ? [err.message] : err ? [String(err)] : [],
      ))

  const recoveryLog: RecoveryAttempt[] = []
  let lastResult: T | undefined
  let lastErrors: string[] = []

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let threw: unknown = null
    try {
      lastResult = await fn()
    } catch (e) {
      threw = e
      lastResult = undefined
    }

    const errors =
      threw !== null
        ? await collectErrors(page, threw)
        : options.verify && lastResult !== undefined
          ? (await options.verify(lastResult, page))
            ? []
            : await collectErrors(page, 'Verification failed after step.')
          : []

    if (errors.length === 0 && lastResult !== undefined) {
      if (recoveryLog.length > 0) {
        const last = recoveryLog[recoveryLog.length - 1]
        await recordRecoveryOutcome(last.errors, last.actions, runCtx.step, true)
      }
      return { result: lastResult, recoveryLog }
    }

    lastErrors = errors
    if (attempt >= maxAttempts) break

    const recovery = await recoverFromBlockers(page, errors, runCtx)
    recovery.attempt = attempt
    recoveryLog.push(recovery)

    await page.waitForTimeout(1500)
  }

  if (recoveryLog.length > 0) {
    const last = recoveryLog[recoveryLog.length - 1]
    await recordRecoveryOutcome(last.errors, last.actions, runCtx.step, false)
  }

  if (lastResult !== undefined) {
    return { result: lastResult, recoveryLog }
  }

  throw new Error(
    lastErrors.length > 0
      ? `KDP step failed after ${maxAttempts} attempts: ${lastErrors[0]}`
      : `KDP step failed after ${maxAttempts} attempts.`,
  )
}
