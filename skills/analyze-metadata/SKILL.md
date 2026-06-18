---
name: amazon-kdp-analyze-metadata
description: Audits cached KDP book metadata for keyword gaps, missing categories, duplicate keywords, short descriptions. Use for SEO audits, catalog health checks, or finding books needing updates.
disable-model-invocation: true
---

# KDP Analyze Metadata

Runs audit rules against cached metadata (requires prior sync).

```bash
npm run metadata:analyze
curl http://localhost:3001/api/kdp/metadata/analyze
```

## Checks

| Issue | Severity |
|-------|----------|
| Empty or partial keyword slots (< 7) | warning/error |
| Keyword > 50 chars | error |
| Duplicate keywords | warning |
| Description < 100 chars | warning |
| No categories | warning |
| Missing ASIN / list price | info |

## Workflow

1. `npm run sync:metadata`
2. `npm run metadata:analyze`
3. Fix issues via [update-metadata/SKILL.md](../update-metadata/SKILL.md)
