#!/usr/bin/env node
/**
 * Thin CLI for the local KDP sync server.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_BASE = (process.env.KDP_API_URL || 'http://localhost:3001').replace(/\/$/, '')
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

async function api(pathname, options = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, options)
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const COMMANDS = [
  'status',
  'login',
  'account',
  'catalog',
  'bookshelf',
  'download-report',
  'sync-metadata',
  'sync-book',
  'metadata-get',
  'metadata-analyze',
  'title-create',
  'title-delete',
  'title-unpublish',
  'publish',
].join(' | ')

async function main() {
  const cmd = process.argv[2]
  if (!cmd) {
    console.error(`Commands: ${COMMANDS}`)
    process.exit(1)
  }

  if (cmd === 'status') {
    console.log(JSON.stringify(await api('/api/kdp/status'), null, 2))
    return
  }

  if (cmd === 'login') {
    console.log(JSON.stringify(await api('/api/kdp/login/start', { method: 'POST' }), null, 2))
    console.log('Complete sign-in in the Chromium window, then run: npm run status')
    return
  }

  if (cmd === 'account') {
    console.log(JSON.stringify(await api('/api/kdp/account'), null, 2))
    return
  }

  if (cmd === 'catalog') {
    const data = await api('/api/kdp/catalog')
    console.log(JSON.stringify({ count: data.count, books: data.books.slice(0, 5), truncated: data.count > 5 }, null, 2))
    return
  }

  if (cmd === 'bookshelf') {
    console.log(JSON.stringify(await api('/api/kdp/bookshelf'), null, 2))
    return
  }

  if (cmd === 'download-report') {
    const outArg = process.argv[3]
    const startMonth = argValue('--from')
    const endMonth = argValue('--to')
    const outPath = path.resolve(
      outArg || path.join(repoRoot, 'output', `kdp-royalties-${new Date().toISOString().slice(0, 10)}.xlsx`),
    )
    await fs.mkdir(path.dirname(outPath), { recursive: true })

    const endpoint = startMonth || endMonth ? '/api/kdp/reports/download' : '/api/kdp/sync'
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: startMonth || endMonth ? JSON.stringify({ startMonth, endMonth }) : undefined,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(outPath, buffer)
    console.log(`Saved ${buffer.length} bytes → ${outPath}`)
    return
  }

  if (cmd === 'sync-metadata') {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60 * 60 * 1000)
    try {
      const res = await fetch(`${API_BASE}/api/kdp/metadata/sync`, {
        method: 'POST',
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      console.log(JSON.stringify({ syncedAt: data.syncedAt, count: data.count, stats: data.stats }, null, 2))
    } finally {
      clearTimeout(timeout)
    }
    return
  }

  if (cmd === 'sync-book') {
    const titleId = process.argv[3]
    const format = process.argv[4]
    if (!titleId || !format) {
      console.error('Usage: sync-book TITLE_ID FORMAT')
      process.exit(1)
    }
    const data = await api(`/api/kdp/metadata/sync/${titleId}/${format}`, { method: 'POST' })
    console.log(JSON.stringify(data.book, null, 2))
    return
  }

  if (cmd === 'metadata-get') {
    const data = await api('/api/kdp/metadata')
    const titleFilter = argValue('--title')?.toLowerCase()
    const formatFilter = argValue('--format')
    let books = data.books || []
    if (titleFilter) books = books.filter((b) => b.title.toLowerCase().includes(titleFilter))
    if (formatFilter) books = books.filter((b) => b.format === formatFilter)
    console.log(JSON.stringify({ syncedAt: data.syncedAt, count: books.length, books }, null, 2))
    return
  }

  if (cmd === 'metadata-analyze') {
    console.log(JSON.stringify(await api('/api/kdp/metadata/analyze'), null, 2))
    return
  }

  if (cmd === 'title-create') {
    const format = process.argv[3]
    if (!format) {
      console.error('Usage: title-create FORMAT')
      process.exit(1)
    }
    console.log(
      JSON.stringify(
        await api('/api/kdp/titles/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ format }),
        }),
        null,
        2,
      ),
    )
    return
  }

  if (cmd === 'title-delete') {
    const titleId = process.argv[3]
    const format = process.argv[4]
    if (!titleId || !format) {
      console.error('Usage: title-delete TITLE_ID FORMAT')
      process.exit(1)
    }
    console.log(
      JSON.stringify(
        await api('/api/kdp/titles/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titleId, format }),
        }),
        null,
        2,
      ),
    )
    return
  }

  if (cmd === 'title-unpublish') {
    const titleId = process.argv[3]
    const format = process.argv[4]
    if (!titleId || !format) {
      console.error('Usage: title-unpublish TITLE_ID FORMAT')
      process.exit(1)
    }
    console.log(
      JSON.stringify(
        await api('/api/kdp/titles/unpublish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titleId, format }),
        }),
        null,
        2,
      ),
    )
    return
  }

  if (cmd === 'publish') {
    const file = process.argv[3]
    if (!file) {
      console.error('Usage: publish spec.json')
      process.exit(1)
    }
    const spec = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'))
    console.log(
      JSON.stringify(
        await api('/api/kdp/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec),
        }),
        null,
        2,
      ),
    )
    return
  }

  console.error(`Unknown command: ${cmd}`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
