#!/usr/bin/env tsx
/**
 * Convert a KDP Uploader .xlsx row into a publish wizard JSON spec.
 *
 * Usage:
 *   npm run uploader:to-publish -- KDPUploader.xlsx --title "Roulette For Babies" --assets /path/to/pdfs [--live]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseKdpUploaderFile } from '../lib/parseKdpUploaderWorkbook.js'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx >= 0 ? args[idx + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const live = args.includes('--live')
  const titleArg = argValue(args, '--title')
  const assetsArg = argValue(args, '--assets')
  const formatArg = argValue(args, '--format') as 'paperback' | 'hardcover' | 'ebook' | undefined
  const positional = args.filter(
    (a) =>
      !a.startsWith('--') &&
      a !== titleArg &&
      a !== assetsArg &&
      a !== formatArg,
  )
  const xlsxPath = path.resolve(positional[0] ?? '')
  const titleMatch = titleArg
  const assetsDir = path.resolve(assetsArg ?? path.dirname(xlsxPath))
  const format = formatArg ?? 'paperback'

  if (!xlsxPath) {
    console.error(
      'Usage: uploader:to-publish <KDPUploader.xlsx> --title "Book Title" [--assets /dir] [--format paperback|hardcover|ebook] [--live]',
    )
    process.exit(1)
  }

  const spec = parseKdpUploaderFile(xlsxPath, {
    assetsDir,
    format,
    titleMatch,
    dryRun: !live,
    publish: false,
  })

  const outName = `${spec.details?.title?.replace(/[^\w]+/g, '_') || 'book'}.publish.json`
  const outPath = path.join(repoRoot, 'output', outName)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(spec, null, 2)}\n`)
  console.log(outPath)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
