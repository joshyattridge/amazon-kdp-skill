# Amazon KDP Skill

Cursor / Claude agent skill for **full Amazon Kindle Direct Publishing (KDP) automation**: royalty reports, book metadata sync, metadata/pricing/content updates, and catalog audits. The agent runs all commands; the user only completes Amazon sign-in (MFA) in the browser when needed.

Amazon does not expose a public API for author account metadata or backend keywords. This repo uses **Playwright + a saved browser session** to interact with KDP the same way the web UI does. Every KDP request is spaced by `KDP_REQUEST_DELAY_MS` (default 4 seconds) to avoid rate limits.

## Install

```bash
git clone <your-repo-url> amazon-kdp-skill
cd amazon-kdp-skill
npm install
cp .env.example .env
```

## Run the sync server

```bash
npm run server:start
# → http://localhost:3001
```

## Connect Amazon

```bash
npm run login
# Sign in via the Chromium window, then:
npm run status
```

## Install as Cursor skills

```bash
SKILLS=~/.cursor/skills
REPO="$(pwd)"
ln -sf "$REPO/SKILL.md" "$SKILLS/amazon-kdp/SKILL.md"
for skill in connect-session account-info download-reports parse-reports sync-metadata export-metadata analyze-metadata update-metadata update-pricing upload-content publish-book; do
  ln -sf "$REPO/skills/$skill" "$SKILLS/amazon-kdp-$skill"
done
```

## Commands

### Read

| Command | Action |
|---------|--------|
| `npm run status` | Check session |
| `npm run account:info` | Account + catalog size |
| `npm run bookshelf:list` | Fast title/format list |
| `npm run catalog:get` | All titles + ASINs |
| `npm run download:report` | Lifetime royalties `.xlsx` |
| `npm run parse:report -- file.xlsx` | Summarize royalty report |
| `npm run sync:metadata` | Full metadata scrape → cache |
| `npm run sync:book -- ID format` | Refresh one book |
| `npm run metadata:get` | Print cached JSON |
| `npm run metadata:export` | Cache → Excel |
| `npm run metadata:analyze` | Keyword/category audit |

### Write

| Command | Action |
|---------|--------|
| `npm run update:metadata -- file.json` | Push details changes |
| `npm run publish:book -- spec.json` | Full wizard (dry-run default) |
| `npm run title:create -- paperback` | Start new draft |
| `npm run title:delete -- ID format` | Delete draft |
| `curl POST /api/kdp/pricing/update` | Update prices / KDP Select |
| `curl POST /api/kdp/content/upload` | Upload interior/cover PDF |

Always dry-run writes first. See sub-skills in `skills/` for full API shapes.

## Repo layout

```
amazon-kdp-skill/
├── SKILL.md                 # Main agent skill (router)
├── skills/                  # Sub-skills by task (12 skills)
├── server/                  # Express + Playwright automation
├── lib/                     # Royalty xlsx parser
├── scripts/                 # CLI wrappers
├── references/              # API + troubleshooting docs
└── output/                  # Downloaded reports (gitignored)
```

## Security

- `.kdp-session/` contains Amazon cookies — **never commit or share**
- Runs locally only; no data sent to third parties

## License

Private / your choice — add LICENSE if open-sourcing.
