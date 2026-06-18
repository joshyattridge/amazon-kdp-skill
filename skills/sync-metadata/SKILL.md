---
name: amazon-kdp-sync-metadata
description: Syncs Amazon KDP book metadata from Bookshelf — title, subtitle, description, keywords, categories, pricing, ASIN. Use when pulling all book listings, reading backend keywords, caching metadata, or fetching one book's details.
disable-model-invocation: true
---

# KDP Sync Metadata

**Agent runs all commands** — ensure server is up and session connected first.

Scrapes **title-setup** pages for each editable format on Bookshelf (kindle, paperback, hardcover).

**Request-first sync order:**
1. `kdpreports` `booksMetadata` JSON API (if available)
2. Bookshelf HTML fetch + parse (single GET, no pagination JS)
3. Full browser Bookshelf pagination (fallback only)

Per book, metadata is fetched via **HTTP GET** of title-setup HTML (not full page navigation), then parsed locally.

## Full sync

```bash
npm run sync:metadata
```

Writes `.kdp-session/book-metadata.json` with all synced books + stats.

## Read cache

```bash
npm run metadata:get
npm run metadata:get -- --title "Coffee" --format paperback
```

## One book refresh

```bash
npm run sync:book -- TITLE_ID paperback
curl -X POST http://localhost:3001/api/kdp/metadata/sync/TITLE_ID/paperback
```

## Fast bookshelf list (no per-book scrape)

```bash
npm run bookshelf:list
curl http://localhost:3001/api/kdp/bookshelf
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/kdp/metadata` | Read cache |
| GET | `/api/kdp/bookshelf` | Fast title/format list |
| POST | `/api/kdp/metadata/sync` | Full Bookshelf scan + scrape |
| POST | `/api/kdp/metadata/sync/:titleId/:format` | Refresh one book |

## One book from cache

Filter by `titleId` + `format` in the JSON response. To refresh a single book after an update, the update flow re-reads and patches cache automatically.

## Coverage limits

- Only formats with an **Edit** link on Bookshelf (not "Create Kindle eBook" placeholders)
- Paginates all Bookshelf pages
- Per book: details + content + pricing pages merged

## Book record shape

See [references/metadata-fields.md](../../references/metadata-fields.md).

## Typical workflow

1. `npm run sync:metadata`
2. Use cached JSON in your own project for analysis or updates
3. Apply changes via [update-metadata/SKILL.md](../update-metadata/SKILL.md)
