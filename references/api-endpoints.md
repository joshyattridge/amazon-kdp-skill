# KDP Sync Server API

Base URL: `http://localhost:3001` (configurable via `KDP_API_URL`)

## Health

| GET | `/api/kdp/health` | `{ ok: true }` |

## Session

| GET | `/api/kdp/status` | `{ connected, sessionSavedAt, loginInProgress }` |
| POST | `/api/kdp/login/start` | Opens login browser |
| DELETE | `/api/kdp/session` | Clear session + metadata cache |

## Account & catalog

| GET | `/api/kdp/account` | Account creation date, catalog size, vendor code |
| GET | `/api/kdp/catalog` | All titles from kdpreports with ASINs |
| GET | `/api/kdp/bookshelf` | Fast title/format refs from Bookshelf |

## Reports

| POST | `/api/kdp/sync` | Lifetime royalties `.xlsx` (binary body) |
| POST | `/api/kdp/reports/download` | `{ startMonth?, endMonth? }` → `.xlsx` |

## Metadata read

| GET | `/api/kdp/metadata` | Cached books from last sync |
| GET | `/api/kdp/metadata/analyze` | Audit cached metadata |
| POST | `/api/kdp/metadata/sync` | Full Bookshelf scrape |
| POST | `/api/kdp/metadata/sync/:titleId/:format` | Refresh one book |

## Metadata write

| POST | `/api/kdp/metadata/update` | `{ titleId, format, changes, dryRun? }` |
| POST | `/api/kdp/metadata/update/batch` | `{ updates: [...], dryRun? }` |

### `changes` object (details page)

```json
{
  "title": "optional",
  "subtitle": "optional",
  "description": "plain text",
  "keywords": ["up to 7 strings"],
  "seriesTitle": "optional",
  "seriesNumber": "optional",
  "primaryAuthor": { "firstName": "...", "lastName": "..." },
  "contributors": [{ "role": "Editor", "firstName": "...", "lastName": "..." }],
  "language": "English",
  "publisherLabel": "optional",
  "editionNumber": "optional",
  "readingInterestAgeMin": "optional",
  "readingInterestAgeMax": "optional",
  "isPublicDomain": false,
  "isAdultContent": false,
  "largePrint": false
}
```

## Pricing write

| POST | `/api/kdp/pricing/update` | `{ titleId, format, changes, dryRun? }` |
| POST | `/api/kdp/pricing/update/batch` | `{ updates: [...], dryRun? }` |

### pricing `changes`

```json
{
  "listPriceUsd": "9.99",
  "prices": { "GBP": "7.99", "EUR": "8.99" },
  "territory": "worldwide",
  "kdpSelect": true,
  "royaltyPlan": "70"
}
```

## Content upload

| POST | `/api/kdp/content/upload` | `{ titleId, format, fileType, filePath, dryRun? }` |
| POST | `/api/kdp/content/upload/batch` | `{ uploads: [...], dryRun? }` |

`fileType`: `interior` | `cover`

## Publish lifecycle

| POST | `/api/kdp/titles/create` | `{ format }` → opens create flow, returns `{ titleId, url }` |
| POST | `/api/kdp/categories/update` | `{ titleId, format, categories, isAdultContent? }` |
| POST | `/api/kdp/publish` | Full wizard — see `examples/publish-book.example.json` |
| POST | `/api/kdp/titles/unpublish` | `{ titleId, format }` |
| POST | `/api/kdp/titles/delete` | `{ titleId, format }` — drafts |
| POST | `/api/kdp/titles/archive` | `{ titleId, format }` |

### publish body (abbreviated)

```json
{
  "format": "paperback",
  "create": true,
  "titleId": "optional-if-not-create",
  "dryRun": true,
  "publish": false,
  "details": { "title": "...", "language": "English", "isAdultContent": false },
  "categories": [{ "browseNodeId": "3398" }, { "path": ["Humor & Entertainment", "Humor"] }],
  "content": { "interiorPath": "/path/manuscript.pdf", "coverPath": "/path/cover.pdf" },
  "pricing": { "listPriceUsd": "9.99" }
}
```

### `format`

`kindle` | `paperback` | `hardcover`

## Error codes

| HTTP | code | Meaning |
|------|------|---------|
| 401 | auth | Session expired |
| 502 | kdp | KDP page/API error |
| 400 | validation | Bad request body |
