---
name: amazon-kdp-publish-book
description: Creates a new KDP title or completes the full publish wizard — details, categories, content upload, pricing, optional publish. Use when publishing a book start-to-finish on KDP.
disable-model-invocation: true
---

# KDP Publish Book (full wizard)

Orchestrates the KDP title-setup flow in **one browser session**:

1. Create title (optional) or open existing draft
2. Fill details (title, author, description, keywords, flags)
3. Set categories (browse node IDs or modal path)
4. Upload interior/cover PDFs
5. Set pricing
6. Optionally click **Publish** (requires explicit opt-in)

## Safety

- **Default is dry-run** — fills forms without saving.
- Live saves require `"dryRun": false` in the JSON **and** `--live` on the CLI.
- **Never set `"publish": true`** unless the user explicitly asks to go live.

## Full paperback upload from KDPUploader.xlsx

```bash
npm run uploader:to-publish -- /path/KDPUploader.xlsx --title "Book Title" --assets /path/pdfs
npm run publish:book -- output/Book_Title.publish.json --live
```

The wizard waits for KDP to process manuscript/cover (up to 10 min) before opening pricing. It does **not** click Publish unless `"publish": true` in the JSON.

**Error recovery:** If KDP shows blockers (modals, release date, preview required, etc.), the server retries with automatic recoveries and saves what worked to `.kdp-session/recovery-learnings.json`. Check `recoveryLog` in the publish API response.

## Dry run (new paperback draft)

```bash
npm run publish:book -- examples/publish-book.example.json
```

## Live save (draft only, no publish)

```bash
npm run publish:book -- my-book.json --live
```

Set in JSON: `"dryRun": false`, `"publish": false`.

## Category formats

```json
{ "browseNodeId": "3398" }
```

```json
{ "path": ["Children's Books", "Humor"] }
```

Up to 3 categories. Set `"isAdultContent": false` in `details` before categories.

## Existing title (skip create)

```json
{
  "format": "paperback",
  "titleId": "YOUR_TITLE_ID",
  "dryRun": true,
  "details": { "keywords": ["new keyword"] },
  "pricing": { "listPriceUsd": "8.99" }
}
```

## API

| Method | Path | Body |
|--------|------|------|
| POST | `/api/kdp/publish` | Full wizard spec (see example JSON) |
| POST | `/api/kdp/titles/create` | `{ "format": "paperback" }` |
| POST | `/api/kdp/categories/update` | `{ titleId, format, categories, isAdultContent? }` |
| POST | `/api/kdp/titles/unpublish` | `{ titleId, format }` |
| POST | `/api/kdp/titles/delete` | `{ titleId, format }` — drafts only |
| POST | `/api/kdp/titles/archive` | `{ titleId, format }` |

## CLI helpers

```bash
npm run publish:book -- spec.json          # dry-run
npm run title:create -- paperback         # open create flow only
npm run title:delete -- TITLE_ID paperback
```
