---
name: amazon-kdp-update-pricing
description: Updates Amazon KDP book pricing — list price, territory prices, KDP Select enrollment, royalty plan. Use when changing book prices or Kindle Unlimited enrollment.
disable-model-invocation: true
---

# KDP Update Pricing

Edits the **pricing** page and saves. Always dry-run first.

## Single book (dry run)

```bash
curl -X POST http://localhost:3001/api/kdp/pricing/update \
  -H 'Content-Type: application/json' \
  -d '{
    "titleId": "YOUR_TITLE_ID",
    "format": "paperback",
    "dryRun": true,
    "changes": {
      "listPriceUsd": "9.99",
      "prices": { "GBP": "7.99", "EUR": "8.99" },
      "territory": "worldwide",
      "kdpSelect": true,
      "royaltyPlan": "70"
    }
  }'
```

Set `"dryRun": false` to save.

## Supported fields

| Field | Formats |
|-------|---------|
| `listPriceUsd` | all |
| `prices` (currency code → value) | all |
| `territory` (`worldwide` / `individual`) | all |
| `kdpSelect` | kindle only |
| `royaltyPlan` (`35` / `70`) | kindle only |

## API

| Method | Path |
|--------|------|
| POST | `/api/kdp/pricing/update` |
| POST | `/api/kdp/pricing/update/batch` |

**Agents:** Update one title per request. Wait for each save to finish before starting the next book. Do not use the batch endpoint for multi-book agent work.

## Rate limiting

Same as metadata updates — `KDP_REQUEST_DELAY_MS` (default 4s) between every KDP request.
