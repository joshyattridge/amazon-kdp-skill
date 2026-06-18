import fs from 'node:fs/promises'
import path from 'node:path'
import { SESSION_DIR, SESSION_FILE } from './config.js'

export async function sessionExists(): Promise<boolean> {
  try {
    await fs.access(SESSION_FILE)
    return true
  } catch {
    return false
  }
}

export async function ensureSessionDir(): Promise<void> {
  await fs.mkdir(SESSION_DIR, { recursive: true })
}

export async function removeSession(): Promise<void> {
  try {
    await fs.unlink(SESSION_FILE)
  } catch {
    /* no session file */
  }
}

export async function readSessionMeta(): Promise<{
  savedAt: string | null
}> {
  if (!(await sessionExists())) {
    return { savedAt: null }
  }
  try {
    const stat = await fs.stat(SESSION_FILE)
    return { savedAt: stat.mtime.toISOString() }
  } catch {
    return { savedAt: null }
  }
}

export function sessionFilePath(): string {
  return SESSION_FILE
}

/** Best-effort wipe of session dir contents except keeping the folder. */
export async function clearSessionDir(): Promise<void> {
  await ensureSessionDir()
  const entries = await fs.readdir(SESSION_DIR)
  await Promise.all(
    entries.map((name) => fs.unlink(path.join(SESSION_DIR, name)).catch(() => {})),
  )
}
