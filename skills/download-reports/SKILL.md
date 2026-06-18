---
name: amazon-kdp-download-reports
description: Downloads Amazon KDP royalty reports (lifetime merged PMR workbooks) via the local sync server. Use when pulling sales data, royalty Excel files, lifetime earnings, or PMR reports from KDP.
disable-model-invocation: true
---

# KDP Download Reports

**Agent runs all commands** — ensure server is up and session connected first.

Requires connected session — see [connect-session/SKILL.md](../connect-session/SKILL.md).

## Lifetime royalties (all months merged)

Downloads every Prior Month Royalties (PMR) report from account creation through today and merges into one `.xlsx`.

```bash
npm run download:report
# default: output/kdp-royalties-YYYY-MM-DD.xlsx

node scripts/kdp-cli.mjs download-report ./my-report.xlsx
```

## Date-range download

```bash
node scripts/kdp-cli.mjs download-report ./may-jun.xlsx --from 2026-05 --to 2026-06
```

```bash
curl -X POST http://localhost:3001/api/kdp/reports/download \
  -H 'Content-Type: application/json' \
  -d '{"startMonth":"2026-05","endMonth":"2026-06"}' \
  -o royalties.xlsx
```

## API

```bash
curl -X POST http://localhost:3001/api/kdp/sync -o royalties.xlsx
```

Response headers: `X-KDP-Report-Start`, `X-KDP-Report-End`.

## Parse in code

```typescript
import { readFileSync } from 'node:fs'
import { parseKdpWorkbook } from '../lib/parseKdpWorkbook.ts'

const parsed = parseKdpWorkbook(readFileSync('output/kdp-royalties-2026-06-18.xlsx'))
// parsed.rows → { title, royalty, units, asin, marketplace, ... }
```

## Notes

- Uses `kdpreports.amazon.com` internal APIs (not Selling Partner API)
- Report generation can take minutes for accounts with many months
- No keywords or metadata in royalty files — use sync-metadata sub-skill for that
