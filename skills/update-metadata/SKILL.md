---
name: amazon-kdp-update-metadata
description: Updates Amazon KDP book listing metadata — keywords, description, title, subtitle, series. Use when pushing metadata changes to KDP, batch updating keywords, or dry-run testing edits.
disable-model-invocation: true
---

# KDP Update Metadata

Edits the **title-setup details** page and saves. Verifies by re-reading metadata (ignores noisy KDP warning banners).

## Single book (dry run first)

```bash
curl -X POST http://localhost:3001/api/kdp/metadata/update \
  -H 'Content-Type: application/json' \
  -d '{
    "titleId": "YOUR_TITLE_ID",
    "format": "paperback",
    "dryRun": true,
    "changes": {
      "keywords": ["kw1","kw2","kw3","kw4","kw5","kw6","kw7"],
      "description": "Plain text description. Use double newlines for paragraphs."
    }
  }'
```

Set `"dryRun": false` to save.

## Batch from JSON

**Agents:** Do not use batch mode for multiple books. Loop single-book updates instead (see main skill: Sequential operations).

For manual CLI use only:

```bash
npm run update:metadata -- scripts/update-kdp-metadata.example.json --dry-run
npm run update:metadata -- scripts/update-kdp-metadata.example.json
```

JSON shape:

```json
{
  "updates": [
    {
      "titleId": "ABC123",
      "format": "paperback",
      "changes": { "keywords": ["..."], "description": "..." }
    }
  ]
}
```

## Updatable fields

| Field | Supported |
|-------|-----------|
| keywords (7 slots) | Yes |
| description | Yes (plain text → HTML) |
| title, subtitle | Yes |
| series title/number | Yes |
| categories | No (KDP picker UI) |
| pricing, files | See update-pricing / upload-content sub-skills |
| primaryAuthor, language, flags | Yes |
| contributors | Partial (existing slots) |

## Rate limiting

The server spaces **every** KDP page load and API call by `KDP_REQUEST_DELAY_MS` (default 4 seconds). Batch updates also wait between books. Increase in `.env` if Amazon returns "Server Busy".

## API

| Method | Path |
|--------|------|
| POST | `/api/kdp/metadata/update` |
| POST | `/api/kdp/metadata/update/batch` |

**Agents:** Use `/api/kdp/metadata/update` once per book, sequentially. Do not use the batch endpoint for multi-book agent tasks — it times out and triggers Amazon rate limits.
