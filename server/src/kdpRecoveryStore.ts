import fs from 'node:fs/promises'
import path from 'node:path'
import { SESSION_DIR } from './config.js'
import { ensureSessionDir } from './session.js'

export type RecoveryActionId =
  | 'dismiss_overlays'
  | 'ack_upload_interrupt'
  | 'schedule_release_date'
  | 'approve_manuscript_preview'
  | 'select_pdf_cover_upload'
  | 'select_premium_color'
  | 'bypass_server_busy'
  | 'wait_processing'
  | 'reload_page'
  | 'save_as_draft'

export type RecoveryContext = 'details' | 'content' | 'pricing' | 'publish' | 'any'

export type RecoveryLearning = {
  errorPattern: string
  action: RecoveryActionId
  context: RecoveryContext
  successCount: number
  failureCount: number
  lastSuccessAt: string | null
  lastFailureAt: string | null
}

export const RECOVERY_LEARNINGS_FILE =
  process.env.KDP_RECOVERY_LEARNINGS_FILE ||
  path.join(SESSION_DIR, 'recovery-learnings.json')

export type RecoveryLearningsFile = {
  version: 1
  updatedAt: string
  entries: RecoveryLearning[]
}

const EMPTY: RecoveryLearningsFile = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  entries: [],
}

export async function readRecoveryLearnings(): Promise<RecoveryLearningsFile> {
  try {
    const raw = await fs.readFile(RECOVERY_LEARNINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as RecoveryLearningsFile
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return { ...EMPTY }
    return parsed
  } catch {
    return { ...EMPTY }
  }
}

export async function writeRecoveryLearnings(data: RecoveryLearningsFile): Promise<void> {
  await ensureSessionDir()
  await fs.writeFile(RECOVERY_LEARNINGS_FILE, `${JSON.stringify(data, null, 2)}\n`)
}

function entryKey(errorPattern: string, action: RecoveryActionId, context: RecoveryContext): string {
  return `${context}::${errorPattern}::${action}`
}

export async function recordRecoveryOutcome(
  errorPatterns: string[],
  actions: RecoveryActionId[],
  context: RecoveryContext,
  succeeded: boolean,
): Promise<void> {
  if (errorPatterns.length === 0 || actions.length === 0) return

  const file = await readRecoveryLearnings()
  const now = new Date().toISOString()
  const index = new Map(
    file.entries.map((e) => [entryKey(e.errorPattern, e.action, e.context), e]),
  )

  for (const errorPattern of errorPatterns) {
    for (const action of actions) {
      const key = entryKey(errorPattern, action, context)
      const existing = index.get(key) ?? {
        errorPattern,
        action,
        context,
        successCount: 0,
        failureCount: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
      }
      if (succeeded) {
        existing.successCount += 1
        existing.lastSuccessAt = now
      } else {
        existing.failureCount += 1
        existing.lastFailureAt = now
      }
      index.set(key, existing)
    }
  }

  file.entries = [...index.values()].sort(
    (a, b) => b.successCount - a.successCount || b.failureCount - a.failureCount,
  )
  file.updatedAt = now
  await writeRecoveryLearnings(file)
}
