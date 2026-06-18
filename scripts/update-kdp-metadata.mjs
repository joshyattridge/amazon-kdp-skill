#!/usr/bin/env node
/**
 * Batch-update KDP book metadata via the local sync server.
 *
 * Usage:
 *   node scripts/update-kdp-metadata.mjs updates.json
 *   node scripts/update-kdp-metadata.mjs updates.json --dry-run
 *
 * Example updates.json:
 * {
 *   "dryRun": false,
 *   "updates": [
 *     {
 *       "titleId": "B012345678",
 *       "format": "paperback",
 *       "changes": {
 *         "keywords": ["ai for babies", "funny baby book"],
 *         "description": "New hook paragraph.\n\nSecond paragraph."
 *       }
 *     }
 *   ]
 * }
 */
import fs from 'node:fs/promises'

const API_BASE = (process.env.KDP_API_URL || 'http://localhost:3001').replace(/\/$/, '')

async function main() {
  const args = process.argv.slice(2)
  const dryRunFlag = args.includes('--dry-run')
  const fileArg = args.find((a) => !a.startsWith('--'))

  if (!fileArg) {
    console.error('Usage: node scripts/update-kdp-metadata.mjs <updates.json> [--dry-run]')
    process.exit(1)
  }

  const raw = JSON.parse(await fs.readFile(fileArg, 'utf8'))
  const updates = raw.updates ?? raw
  const dryRun = dryRunFlag || raw.dryRun === true

  if (!Array.isArray(updates) || updates.length === 0) {
    console.error('JSON must contain an "updates" array with at least one entry.')
    process.exit(1)
  }

  const endpoint =
    updates.length === 1 && !raw.forceBatch
      ? '/api/kdp/metadata/update'
      : '/api/kdp/metadata/update/batch'

  const body =
    endpoint.endsWith('/batch')
      ? { updates, dryRun }
      : {
          titleId: updates[0].titleId,
          format: updates[0].format,
          changes: updates[0].changes,
          dryRun,
        }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) {
    console.error(`Error (${res.status}):`, data.error || data)
    process.exit(1)
  }

  console.log(JSON.stringify(data, null, 2))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
