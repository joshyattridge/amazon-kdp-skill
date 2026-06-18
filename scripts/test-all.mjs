#!/usr/bin/env node
/**
 * End-to-end test of all KDP skill operations (sequential — server throttles KDP calls).
 * Write ops use dryRun only.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API = (process.env.KDP_API_URL || 'http://localhost:3001').replace(/\/$/, '')
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// Override with env vars for local e2e runs against your own KDP account.
const PAPERBACK = {
  titleId: process.env.KDP_TEST_PAPERBACK_TITLE_ID ?? 'EXAMPLE_TITLE_ID',
  format: 'paperback',
  title: 'Example Paperback Title',
}
const KINDLE = {
  titleId: process.env.KDP_TEST_KINDLE_TITLE_ID ?? 'EXAMPLE_KINDLE_ID',
  format: 'kindle',
  title: 'Example Kindle Title',
}
const EXAMPLE_AUTHOR = { firstName: 'Jane', lastName: 'Author' }

const results = []

async function test(name, fn) {
  const start = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - start, detail })
    console.log(`✓ ${name} (${Date.now() - start}ms)`)
    if (detail && typeof detail === 'object') {
      console.log(`  ${JSON.stringify(detail).slice(0, 120)}`)
    } else if (detail) {
      console.log(`  ${String(detail).slice(0, 120)}`)
    }
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) })
    console.log(`✗ ${name}: ${e instanceof Error ? e.message : e}`)
  }
}

async function json(pathname, options = {}) {
  const res = await fetch(`${API}${pathname}`, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

async function main() {
  console.log(`Testing KDP skill at ${API}\n`)

  const status = await json('/api/kdp/status').catch(() => ({ connected: false }))
  const live = status.connected === true
  if (!live) {
    console.log('⚠ Session not connected — skipping live KDP tests (run npm run login)\n')
  } else {
    console.log(`✓ Session connected (account since ${status.accountCreationDate?.slice(0, 10)})\n`)
  }

  await test('health', () => json('/api/kdp/health'))

  await test('status', async () => {
    const d = await json('/api/kdp/status')
    return { connected: d.connected, sessionSavedAt: d.sessionSavedAt }
  })

  if (live) {
    await test('account', async () => {
      const d = await json('/api/kdp/account')
      return { catalogSize: d.catalogSize, vendorCode: d.vendorCode }
    })

    await test('catalog', async () => {
      const d = await json('/api/kdp/catalog')
      return { count: d.count, sample: d.books[0]?.title }
    })

    await test('bookshelf', async () => {
      const d = await json('/api/kdp/bookshelf')
      return { refs: d.refs.length, uniqueTitleIds: d.uniqueTitleIds }
    })
  }

  await test('metadata cache', async () => {
    const d = await json('/api/kdp/metadata')
    return { count: d.count, syncedAt: d.syncedAt }
  })

  await test('metadata analyze', async () => {
    const d = await json('/api/kdp/metadata/analyze')
    return { bookCount: d.bookCount, issueCount: d.issueCount }
  })

  if (live) {
    await test('sync single book (paperback)', async () => {
      const d = await json(`/api/kdp/metadata/sync/${PAPERBACK.titleId}/${PAPERBACK.format}`, { method: 'POST' })
      return { title: d.book?.title, keywords: d.book?.keywords?.length }
    })

    await test('sync single book (kindle)', async () => {
      const d = await json(`/api/kdp/metadata/sync/${KINDLE.titleId}/${KINDLE.format}`, { method: 'POST' })
      return { title: d.book?.title, kdpSelect: d.book?.kdpSelect }
    })

    await test('metadata update dry-run (details)', async () => {
      const d = await json('/api/kdp/metadata/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleId: PAPERBACK.titleId,
          format: PAPERBACK.format,
          dryRun: true,
          changes: {
            language: 'English',
            primaryAuthor: EXAMPLE_AUTHOR,
          },
        }),
      })
      return { filled: d.filled, skipped: d.skipped }
    })

    await test('pricing update dry-run (paperback)', async () => {
      const d = await json('/api/kdp/pricing/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleId: PAPERBACK.titleId,
          format: 'paperback',
          dryRun: true,
          changes: { listPriceUsd: '8.99' },
        }),
      })
      return { filled: d.filled }
    })

    await test('pricing update dry-run (kindle KDP Select)', async () => {
      const d = await json('/api/kdp/pricing/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleId: KINDLE.titleId,
          format: 'kindle',
          dryRun: true,
          changes: { royaltyPlan: '70', kdpSelect: true },
        }),
      })
      return { filled: d.filled, skipped: d.skipped }
    })

    await test('content upload dry-run (interior)', async () => {
      const d = await json('/api/kdp/content/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleId: PAPERBACK.titleId,
          format: 'paperback',
          fileType: 'interior',
          filePath: '/tmp/test-manuscript.pdf',
          dryRun: true,
        }),
      })
      return { dryRun: d.dryRun }
    })

    await test('content upload dry-run (cover)', async () => {
      const d = await json('/api/kdp/content/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleId: PAPERBACK.titleId,
          format: 'paperback',
          fileType: 'cover',
          filePath: '/tmp/test-cover.pdf',
          dryRun: true,
        }),
      })
      return { dryRun: d.dryRun }
    })

    await test('categories update dry-run (browse nodes)', async () => {
      const d = await json('/api/kdp/categories/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleId: PAPERBACK.titleId,
          format: 'paperback',
          isAdultContent: false,
          categories: [{ browseNodeId: '3398' }, { browseNodeId: '3049' }],
        }),
      })
      return { applied: d.applied, browseNodeIds: d.browseNodeIds?.length }
    })

    await test('publish wizard dry-run (existing title)', async () => {
      const d = await json('/api/kdp/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'paperback',
          titleId: PAPERBACK.titleId,
          dryRun: true,
          details: {
            language: 'English',
            isAdultContent: false,
            primaryAuthor: EXAMPLE_AUTHOR,
          },
          categories: [{ browseNodeId: '3398' }],
          pricing: { listPriceUsd: '8.99' },
        }),
      })
      return { steps: d.steps?.map((s) => s.step), titleId: d.titleId }
    })

    await test('download date-range report', async () => {
      const res = await fetch(`${API}/api/kdp/reports/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startMonth: '2026-05', endMonth: '2026-06' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      const outPath = path.join(repoRoot, 'output', 'test-e2e-range.xlsx')
      await fs.mkdir(path.dirname(outPath), { recursive: true })
      await fs.writeFile(outPath, buf)
      return { bytes: buf.length, months: res.headers.get('x-kdp-months-downloaded') }
    })
  }

  await test('parse report', async () => {
    const { execSync } = await import('node:child_process')
    const reportPath = path.join(repoRoot, 'output', 'test-e2e-range.xlsx')
    const fallback = path.join(repoRoot, 'output', 'test-range.xlsx')
    let usePath = reportPath
    try {
      await fs.access(reportPath)
    } catch {
      usePath = fallback
    }
    const out = execSync(`npx tsx scripts/parse-report.ts "${usePath}"`, {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    const parsed = JSON.parse(out)
    return {
      totalRoyalty: parsed.totalRoyalty,
      totalUnits: parsed.totalUnits,
      totalKenpPages: parsed.totalKenpPages,
    }
  })

  await test('metadata export xlsx', async () => {
    const { execSync } = await import('node:child_process')
    const outPath = path.join(repoRoot, 'output', 'test-e2e-metadata.xlsx')
    execSync(`node scripts/export-metadata-xlsx.mjs "${outPath}"`, { cwd: repoRoot, encoding: 'utf8' })
    const stat = await fs.stat(outPath)
    return { bytes: stat.size }
  })

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  const skipped = live ? 0 : 12
  const totalMs = results.reduce((s, r) => s + r.ms, 0)

  console.log(`\n${'='.repeat(50)}`)
  console.log(`Results: ${passed}/${results.length} passed (${Math.round(totalMs / 1000)}s total)`)
  if (!live) console.log(`Live KDP tests skipped: ${skipped} (session expired — run npm run login)`)
  if (failed.length) {
    console.log('\nFailed:')
    for (const f of failed) console.log(`  - ${f.name}: ${f.error}`)
    process.exit(1)
  }
  if (!live) process.exit(2)
  console.log('All tests passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
