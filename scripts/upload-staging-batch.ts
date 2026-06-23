#!/usr/bin/env tsx
/**
 * Upload all pending books from Picture_Book_Generator/kdp_staging sequentially.
 */
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseKdpUploaderFile } from '../lib/parseKdpUploaderWorkbook.js'
import { sanitizeDescriptionHtml } from '../server/src/kdpMetadataUpdate.js'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAGING = '/Users/joshuaattridge/Documents/Personal/Picture_Book_Generator/kdp_staging'
const XLSX = `${STAGING}/KDPUploader.xlsx`
const API_BASE = (process.env.KDP_API_URL || 'http://localhost:3001').replace(/\/$/, '')
const PUBLISH_TIMEOUT_MS = 1_200_000

type BookJob = {
  title: string
  create: boolean
  titleId?: string
}

const BOOKS: BookJob[] = [
  { title: 'Basketball For Babies', create: true },
  { title: 'Lawyer For Babies', create: true },
  { title: 'Stock Market For Babies', create: true },
  { title: 'Day Trading For Babies', create: false, titleId: '60VQHE1RHSW' },
  { title: 'Football For Babies', create: false, titleId: 'C1PY35QSWHE' },
  { title: 'Lottery For Babies', create: false, titleId: 'TJANS9C34C6' },
]

function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const target = new URL(url)
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
          try {
            resolve({
              ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
              status: res.statusCode ?? 500,
              data: JSON.parse(data || '{}'),
            })
          } catch {
            resolve({ ok: false, status: res.statusCode ?? 500, data: data })
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Publish request timed out.'))
    })
    req.write(payload)
    req.end()
  })
}

async function buildSpec(job: BookJob) {
  const spec = parseKdpUploaderFile(XLSX, {
    assetsDir: STAGING,
    format: 'paperback',
    titleMatch: job.title,
    dryRun: false,
    publish: false,
  })
  if (spec.details?.descriptionHtml) {
    spec.details.descriptionHtml = sanitizeDescriptionHtml(spec.details.descriptionHtml)
  }
  spec.create = job.create
  spec.dryRun = false
  spec.publish = false
  if (!job.create && job.titleId) {
    spec.titleId = job.titleId
  }
  return spec
}

async function main() {
  await fs.mkdir(path.join(repoRoot, 'output'), { recursive: true })
  const summary: Array<{ title: string; ok: boolean; titleId?: string | null; errors: string[] }> = []

  for (const job of BOOKS) {
    console.log(`\n========== ${job.title} ==========`)
    const spec = await buildSpec(job)
    const specPath = path.join(
      repoRoot,
      'output',
      `${job.title.replace(/[^\w]+/g, '_')}.publish.json`,
    )
    await fs.writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`)
    console.log('Spec:', specPath)

    try {
      const res = await postJson(`${API_BASE}/api/kdp/publish`, spec)
      const data = res.data as {
        titleId?: string | null
        errors?: string[]
        steps?: Array<{ step: string; success: boolean; errors: string[] }>
      }
      console.log(JSON.stringify(data, null, 2))

      const stepOk = (name: string) => data.steps?.find((s) => s.step === name)?.success === true
      const ok =
        res.ok &&
        !!data.titleId &&
        stepOk('content') &&
        (stepOk('pricing') || !spec.pricing) &&
        (stepOk('save-details') || stepOk('details'))

      summary.push({
        title: job.title,
        ok,
        titleId: data.titleId,
        errors: data.errors ?? [],
      })
      console.log(ok ? `✓ ${job.title} (${data.titleId})` : `✗ ${job.title} — see errors above`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('FAILED:', msg)
      summary.push({ title: job.title, ok: false, errors: [msg] })
    }
  }

  console.log('\n========== SUMMARY ==========')
  for (const row of summary) {
    console.log(`${row.ok ? 'OK' : 'FAIL'} | ${row.title} | ${row.titleId ?? '-'} | ${row.errors.join('; ')}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
