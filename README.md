# Amazon KDP Skill

[![skills.sh](https://skills.sh/b/joshyattridge/amazon-kdp-skill)](https://skills.sh/joshyattridge/amazon-kdp-skill)

An agent skill for **Amazon Kindle Direct Publishing (KDP)** — royalty reports, book metadata, pricing, content uploads, and catalog audits. Works with Cursor, Claude Code, and other agents that support the [Agent Skills](https://agentskills.io) format.

Tell your agent what you want in plain English. The skill handles setup, server, and commands — you only sign in to Amazon when needed.

## Why use this?

Amazon has **no public API** for author account data — no backend keywords, no bulk metadata export, no programmatic pricing updates. KDP is a web UI only.

This skill fills that gap. A local Playwright server drives KDP the same way you would in a browser, with throttled requests to avoid rate limits. Your agent can:

- Download and parse royalty reports
- Sync your full catalog — titles, keywords, categories, pricing, ASINs
- Audit metadata for SEO gaps (missing keywords, short descriptions, etc.)
- Update listings, prices, KDP Select, and content files (Buggy still in development)
- Run the full publish wizard from draft to live (Buggy still in development)

Everything runs on your machine. Session cookies stay in `.kdp-session/` and are never sent anywhere else.

## Quick start

```bash
npx skills add joshyattridge/amazon-kdp-skill
```

Then ask your agent things like:

- *"Download my lifetime royalty report and summarize it."*
- *"Sync all my book metadata and export to Excel."*
- *"Audit my catalog for keyword gaps."*
- *"Dry-run a price update on my paperback."*

## What it covers

| Area | Examples |
|------|----------|
| **Session** | Sign in, check connection, reconnect after expiry |
| **Reports** | Download lifetime or date-range royalty `.xlsx`, parse to JSON |
| **Metadata** | Full Bookshelf scrape, single-book refresh, export to Excel |
| **Analysis** | Keyword gaps, missing categories, duplicate keywords |
| **Updates** | Title, subtitle, description, keywords, author, categories |
| **Pricing** | List price, territory prices, KDP Select, royalty plan |
| **Content** | Upload interior/cover PDFs, assign free ISBN |
| **Publishing** | Create draft, run full wizard, publish (dry-run by default) |
| **Account** | Catalog size, vendor code, title/ASIN listing |

Write operations default to **dry-run** — the agent verifies before pushing live changes.

**Multiple books:** The agent processes one title at a time (separate publish/update calls, no batch scripts or parallel browser sessions). See `SKILL.md` → Sequential operations.

See `skills/` for task-specific agent instructions and `references/` for API shapes and troubleshooting.

## How it works

```
You  →  Agent (Cursor / Claude)  →  npm scripts / REST API  →  Playwright  →  KDP
                                              ↓
                                    .kdp-session/ (local cookies + cache)
```

- **Setup:** The skill installs dependencies, starts the local server, and manages the session
- **Server:** Express on `http://localhost:3001`
- **Throttling:** 4s delay between KDP requests (configurable via `.env`)
- **Cache:** Scraped metadata stored locally in `.kdp-session/`
- **Recovery learnings:** Successful KDP error workarounds stored in `.kdp-session/recovery-learnings.json`

## Contributing

The goal is to cover **every KDP workflow an author or publisher would automate** — reports, metadata, pricing, content, categories, publishing, account management, and anything else KDP exposes through its UI.

KDP exposes a large surface area — dozens of pages, forms, and workflows — and there are many endpoints and sub-skills still to build. This project can't reach full coverage alone; **community contributions are essential**. If you use a KDP flow that isn't supported yet, please help fill the gap.

If a use case is missing or broken, please open an issue or submit a PR. Useful contributions include:

- New sub-skills or API endpoints for uncovered KDP flows
- Bug fixes for UI changes Amazon makes to KDP
- Better error handling, docs, or test coverage
- Real-world examples in `examples/`

Check `references/troubleshooting.md` before reporting browser automation failures — KDP rate-limits aggressively and UI selectors can drift.

## Security

- **Never commit** `.kdp-session/` — it contains Amazon session cookies
- **Never commit** `.env`, downloaded `.xlsx` files, or `output/`
- All automation is local; no data is sent to third parties

## Repo layout

```
amazon-kdp-skill/
├── SKILL.md           # Main agent skill (router)
├── skills/            # Sub-skills by task
├── server/            # Express + Playwright automation
├── lib/               # Royalty xlsx parser
├── scripts/           # CLI wrappers
├── references/        # API docs + troubleshooting
└── examples/          # Sample publish/update specs
```
