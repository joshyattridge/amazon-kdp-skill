---
name: amazon-kdp-export-metadata
description: Exports cached KDP book metadata to Excel spreadsheet. Use when the user wants an xlsx catalog, spreadsheet of keywords, or offline metadata review.
disable-model-invocation: true
---

# KDP Export Metadata

Requires a prior metadata sync (`npm run sync:metadata`).

```bash
npm run metadata:export
npm run metadata:export -- output/my-catalog.xlsx
```

Writes one row per book/format with all scraped fields (title, keywords, pricing, content, etc.).

## Workflow

1. `npm run sync:metadata` (if cache is stale)
2. `npm run metadata:export`

Output default: `output/kdp-book-metadata-YYYY-MM-DD.xlsx`
