---
name: amazon-kdp-account-info
description: Reads Amazon KDP account info and reports catalog (titles, ASINs, authors). Use when checking catalog size, vendor code, account creation date, or listing all published titles from kdpreports.
disable-model-invocation: true
---

# KDP Account Info

**Agent runs all commands** — ensure server is up and session connected first.

## Account details

```bash
npm run account:info
curl http://localhost:3001/api/kdp/account
```

Returns: `accountCreationDate`, `catalogSize`, `vendorCode`, `reportingExperience`.

## Reports catalog (all titles + ASINs)

```bash
npm run catalog:get
curl http://localhost:3001/api/kdp/catalog
```

Returns titles from `kdpreports` with print/digital/hardcover ASINs, ISBN, cover URL, publish dates.

## API

| Method | Path |
|--------|------|
| GET | `/api/kdp/account` |
| GET | `/api/kdp/catalog` |
