#!/usr/bin/env node
/**
 * Run the full KDP publish wizard from a JSON spec file.
 * Always dry-run by default — pass --live to save (never auto-publishes unless publish:true in JSON).
 */
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_BASE = (process.env.KDP_API_URL || 'http://localhost:3001').replace(/\/$/, '')
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLISH_TIMEOUT_MS = 1_200_000

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: PUBLISH_TIMEOUT_MS,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve({
            ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
            status: res.statusCode ?? 500,
            json: async () => JSON.parse(data || '{}'),
          })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Publish request timed out after 20 minutes.'))
    })
    req.write(payload)
    req.end()
  })
}

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
  const body = { ...raw, dryRun: !live }

  if (body.publish && !live) {
    console.error('Refusing publish:true without --live flag.')
    process.exit(1)
  }

  const res = await postJson(`${API_BASE}/api/kdp/publish`, body)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  console.log(JSON.stringify(data, null, 2))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
