#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process'

const BOOKS: Array<{ title: string; titleId?: string }> = [
  { title: 'Basketball For Babies' },
  { title: 'Lawyer For Babies' },
  { title: 'Stock Market For Babies' },
  { title: 'Day Trading For Babies', titleId: '60VQHE1RHSW' },
  { title: 'Football For Babies', titleId: 'C1PY35QSWHE' },
  { title: 'Lottery For Babies', titleId: 'TJANS9C34C6' },
]

for (const book of BOOKS) {
  console.log(`\n========== ${book.title} ==========\n`)
  const args = ['tsx', 'scripts/upload-one-staging-book.ts', '--title', book.title]
  if (book.titleId) args.push('--titleId', book.titleId)
  const res = spawnSync('npx', args, { stdio: 'inherit', cwd: process.cwd() })
  if (res.status !== 0) {
    console.error(`FAILED: ${book.title}`)
  }
}
