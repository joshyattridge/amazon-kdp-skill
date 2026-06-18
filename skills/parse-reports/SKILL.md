---
name: amazon-kdp-parse-reports
description: Parses KDP royalty Excel reports into JSON summaries — total royalties, units, KENP pages, top titles. Use after downloading PMR reports or analyzing sales performance.
disable-model-invocation: true
---

# KDP Parse Reports

Parse a downloaded `.xlsx` royalty report into a JSON summary.

```bash
npm run download:report
npm run parse:report -- output/kdp-royalties-2026-06-18.xlsx
```

## Date-range download + parse

```bash
node scripts/kdp-cli.mjs download-report ./output/may-jun.xlsx --from 2026-05 --to 2026-06
npm run parse:report -- output/may-jun.xlsx
```

## API (download)

```bash
curl -X POST http://localhost:3001/api/kdp/reports/download \
  -H 'Content-Type: application/json' \
  -d '{"startMonth":"2026-05","endMonth":"2026-06"}' \
  -o report.xlsx
```

## Output fields

- `totalRoyalty`, `totalUnits`, `totalKenpPages`
- `topTitles` — top 20 by royalty
- `warnings` — parser notes

Uses `lib/parseKdpWorkbook.ts` under the hood.
