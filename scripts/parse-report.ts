#!/usr/bin/env tsx
/**
 * Parse a KDP royalty .xlsx and print summary JSON.
 *
 * Usage:
 *   tsx scripts/parse-report.ts [report.xlsx]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseKdpXlsxBuffer } from '../lib/parseKdpWorkbook.js'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const arg = process.argv[2]
  const filePath = path.resolve(
    arg || path.join(repoRoot, 'output', `kdp-royalties-${new Date().toISOString().slice(0, 10)}.xlsx`),
  )

  const buf = await fs.readFile(filePath)
  const parsed = parseKdpXlsxBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

  const totalRoyalty = parsed.rows.reduce((s, r) => s + r.royalty, 0)
  const totalUnits = parsed.rows.reduce((s, r) => s + r.units, 0)
  const totalKenp = parsed.kenpRows.reduce((s, r) => s + r.kenpPages, 0)

  const byTitle = new Map<
    string,
    { title: string; royalty: number; units: number; kenpPages: number }
  >()
  for (const row of parsed.rows) {
    const key = row.asin || row.title
    const cur = byTitle.get(key) ?? { title: row.title, royalty: 0, units: 0, kenpPages: 0 }
    cur.royalty += row.royalty
    cur.units += row.units
    byTitle.set(key, cur)
  }
  for (const row of parsed.kenpRows) {
    const key = row.asin || row.title
    const cur = byTitle.get(key) ?? { title: row.title, royalty: 0, units: 0, kenpPages: 0 }
    cur.kenpPages += row.kenpPages
    byTitle.set(key, cur)
  }

  const topTitles = [...byTitle.values()]
    .sort((a, b) => b.royalty - a.royalty)
    .slice(0, 20)

  console.log(
    JSON.stringify(
      {
        file: filePath,
        sheetName: parsed.sheetName,
        sheetsUsed: parsed.sheetsUsed,
        kenpSheetName: parsed.kenpSheetName,
        rowCount: parsed.rows.length,
        kenpRowCount: parsed.kenpRows.length,
        totalRoyalty: Math.round(totalRoyalty * 100) / 100,
        totalUnits,
        totalKenpPages: totalKenp,
        topTitles,
        warnings: parsed.warnings,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
