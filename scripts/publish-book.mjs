#!/usr/bin/env node
/**
 * Run the full KDP publish wizard from a JSON spec file.
 * Always dry-run by default — pass --live to save (never auto-publishes unless publish:true in JSON).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_BASE = (process.env.KDP_API_URL || 'http://localhost:3001').replace(/\/$/, '')
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const args = process.argv.slice(2)
  const live = args.includes('--live')
  const fileArg = args.find((a) => !a.startsWith('--'))
  if (!fileArg) {
    console.error('Usage: publish-book [--live] spec.json')
    console.error('Example: npm run publish:book -- examples/publish-book.example.json')
    process.exit(1)
  }

  const specPath = path.resolve(fileArg)
  const raw = JSON.parse(await fs.readFile(specPath, 'utf8'))
  const body = { ...raw, dryRun: live ? raw.dryRun === true : true }

  if (body.publish && !live) {
    console.error('Refusing publish:true without --live flag.')
    process.exit(1)
  }

  const res = await fetch(`${API_BASE}/api/kdp/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  console.log(JSON.stringify(data, null, 2))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
