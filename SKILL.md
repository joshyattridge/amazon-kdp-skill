---
name: amazon-kdp
description: Full Amazon KDP automation via Playwright — sign in, download royalty reports, sync/update book metadata, pricing, content uploads, catalog audits. Use when the user mentions KDP, Kindle Direct Publishing, royalty reports, book metadata, keywords, categories, pricing, KDP Select, or Amazon author account automation.
disable-model-invocation: true
---

# Amazon KDP Automation

Self-contained skill repo with a local Express + Playwright server. Amazon has **no public KDP metadata API** — this uses saved browser session cookies to call KDP's internal pages and report endpoints.

## Agent responsibilities

**You run everything.** Do not ask the user to run terminal commands.

1. **Ensure setup**: `npm install`, copy `.env.example` → `.env` if missing.
2. **Start the server** if not running: `npm run server:start` (background).
3. **Check session** before any sync/update/download: `npm run status`.
4. **Run all KDP tasks yourself** via npm scripts or the local REST API.
5. **Only pause for the user** during Amazon login — they must complete sign-in (incl. MFA) in the visible Chromium window. Poll `npm run status` until `connected: true`.

Session persists in `.kdp-session/` (gitignored).

## Sequential operations (required)

When the user asks for **multiple books or multiple write tasks**, process them **one at a time** — never in parallel and never in a single batch request.

**Do:**
- Complete one book (or one metadata/pricing/content update) fully before starting the next
- Use single-book endpoints: `/api/kdp/metadata/update`, `/api/kdp/pricing/update`, `/api/kdp/content/upload`, `/api/kdp/publish` — one HTTP call per book
- Run `npm run publish:book -- spec.json --live` once per title; generate a separate spec JSON per book if needed
- Wait for each call to finish (publish can take several minutes) and verify the result before continuing
- If a step fails, stop or fix that book before moving on — do not fire the rest of the queue blindly

**Do not:**
- Create batch scripts that loop inside one long-running process without user approval
- Call batch API routes (`/batch` endpoints) for multiple titles in one request
- Run multiple publish/upload commands in parallel or in background at the same time
- Open more than one Playwright browser session for KDP writes at once

This avoids HTTP timeouts, Amazon "Server Busy" rate limits, and browser/session conflicts. Batch endpoints exist for advanced use only; **agents should default to sequential single-book calls.**

## Sub-skills — read the matching file before acting

| Task | Skill file |
|------|----------------|
| Sign in / session status | [skills/connect-session/SKILL.md](skills/connect-session/SKILL.md) |
| Account info + reports catalog | [skills/account-info/SKILL.md](skills/account-info/SKILL.md) |
| Download royalty reports | [skills/download-reports/SKILL.md](skills/download-reports/SKILL.md) |
| Parse royalty Excel → JSON summary | [skills/parse-reports/SKILL.md](skills/parse-reports/SKILL.md) |
| Pull book metadata (all or one) | [skills/sync-metadata/SKILL.md](skills/sync-metadata/SKILL.md) |
| Export metadata to Excel | [skills/export-metadata/SKILL.md](skills/export-metadata/SKILL.md) |
| Audit metadata (keywords, categories) | [skills/analyze-metadata/SKILL.md](skills/analyze-metadata/SKILL.md) |
| Push listing changes (details page) | [skills/update-metadata/SKILL.md](skills/update-metadata/SKILL.md) |
| Push pricing / KDP Select | [skills/update-pricing/SKILL.md](skills/update-pricing/SKILL.md) |
| Upload interior / cover PDFs | [skills/upload-content/SKILL.md](skills/upload-content/SKILL.md) |
| Full publish wizard (create → publish) | [skills/publish-book/SKILL.md](skills/publish-book/SKILL.md) |

## Quick commands (agent runs these)

```bash
npm run status                    # session connected?
npm run account:info              # catalog size, vendor code
npm run bookshelf:list            # fast title/format refs
npm run catalog:get               # all titles + ASINs from kdpreports
npm run download:report           # lifetime royalties → output/
npm run parse:report -- file.xlsx # summarize royalties
npm run sync:metadata             # full Bookshelf scrape → cache
npm run sync:book -- ID paperback # refresh one book
npm run metadata:get              # print cached JSON
npm run metadata:export           # cache → Excel
npm run metadata:analyze          # keyword/category audit
npm run update:metadata -- file.json --dry-run
npm run publish:book -- examples/publish-book.example.json
```

## Architecture

```
Browser session (.kdp-session/amazon-kdp.json)
        ↓
Local server (server/src/index.ts) — REST API
        ↓
Playwright session cookies
        ↓
Request-first: kdpreports JSON APIs → HTML GET + parse → browser fallback
        ↓
Global rate limit (KDP_REQUEST_DELAY_MS between every request)
```

## Read operations

| Operation | Endpoint / command |
|-----------|-------------------|
| Session status | `GET /api/kdp/status` |
| Account info | `GET /api/kdp/account` |
| Reports catalog | `GET /api/kdp/catalog` |
| Bookshelf list (fast) | `GET /api/kdp/bookshelf` |
| Metadata cache | `GET /api/kdp/metadata` |
| Full metadata sync | `POST /api/kdp/metadata/sync` |
| Single book sync | `POST /api/kdp/metadata/sync/:titleId/:format` |
| Metadata audit | `GET /api/kdp/metadata/analyze` |
| Lifetime royalties | `POST /api/kdp/sync` |
| Date-range royalties | `POST /api/kdp/reports/download` |

## Write operations

| Operation | Endpoint |
|-----------|----------|
| Update details (keywords, description, author, flags) | `POST /api/kdp/metadata/update` |
| Batch metadata update | `POST /api/kdp/metadata/update/batch` |
| Update pricing / KDP Select | `POST /api/kdp/pricing/update` |
| Batch pricing update | `POST /api/kdp/pricing/update/batch` |
| Upload interior/cover | `POST /api/kdp/content/upload` |
| Batch upload | `POST /api/kdp/content/upload/batch` |
| Create new title | `POST /api/kdp/titles/create` |
| Update categories | `POST /api/kdp/categories/update` |
| Full publish wizard | `POST /api/kdp/publish` |
| Unpublish live title | `POST /api/kdp/titles/unpublish` |
| Delete draft | `POST /api/kdp/titles/delete` |
| Archive title | `POST /api/kdp/titles/archive` |
| Recovery learnings | `GET /api/kdp/recovery/learnings` |

Always **dry-run one book** before live writes on additional books. Never set `publish: true` without explicit user confirmation.

Batch REST endpoints (`/batch`) are for manual/advanced use. **Agents must not use them for multi-book work** — call the single-book endpoint repeatedly, one title at a time, waiting for each to complete.

## Automatic error recovery

Write flows (details save, content upload, pricing, publish wizard) **retry with recovery** when KDP blocks progress:

- Built-in playbook: dismiss modals, set release date, approve manuscript preview, select cover upload accordion, bypass Server Busy, wait for processing, etc.
- **Learnings file**: `.kdp-session/recovery-learnings.json` — successful error→action pairs are ranked higher on future runs.
- Publish API responses may include `recoveryLog` describing what was tried.

If recovery exhausts retries, read `errors` and `recoveryLog`, then fix the underlying issue (e.g. invalid cover PDF dimensions).

## Rules for agents

1. **Always check session** (`npm run status`) before sync/update. If `connected: false`, run login sub-skill first.
2. **One operation at a time** for writes — see [Sequential operations](#sequential-operations-required). No batch scripts, no parallel publishes, no `/batch` API for multiple titles.
3. **Never commit** `.kdp-session/` or downloaded `.xlsx` files.
4. **Rate limiting**: the server spaces every KDP page load and API call by `KDP_REQUEST_DELAY_MS` (default 4s). Do not bypass this.
5. **Metadata/pricing updates**: dry-run one book, then apply live changes **one book per request**.
6. **Verify saves** by re-reading metadata from KDP (built into update flows).
7. **Categories**: writable via browse node IDs or modal path picker (`POST /api/kdp/categories/update` or publish wizard).
8. **Publish**: use `npm run publish:book` dry-run first; live publish requires `"publish": true` and user confirmation. **One book per `publish:book` invocation.**

## References

- [references/api-endpoints.md](references/api-endpoints.md) — REST API
- [references/metadata-fields.md](references/metadata-fields.md) — scraped book shape
- [references/troubleshooting.md](references/troubleshooting.md) — Server Busy, auth, pagination
