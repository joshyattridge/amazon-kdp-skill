---
name: amazon-kdp-upload-content
description: Uploads interior PDF or cover file to Amazon KDP title-setup content page. Use when replacing manuscript, cover, or updating print files.
disable-model-invocation: true
---

# KDP Upload Content

Uploads files to the **content** page for an existing title.

## Dry run (verify file input exists)

```bash
curl -X POST http://localhost:3001/api/kdp/content/upload \
  -H 'Content-Type: application/json' \
  -d '{
    "titleId": "YOUR_TITLE_ID",
    "format": "paperback",
    "fileType": "interior",
    "filePath": "/absolute/path/to/manuscript.pdf",
    "dryRun": true
  }'
```

## Upload

Set `"dryRun": false`. File must exist on disk.

```bash
curl -X POST http://localhost:3001/api/kdp/content/upload \
  -H 'Content-Type: application/json' \
  -d '{
    "titleId": "YOUR_TITLE_ID",
    "format": "paperback",
    "fileType": "cover",
    "filePath": "/absolute/path/to/cover.pdf",
    "dryRun": false
  }'
```

## fileType

- `interior` — manuscript PDF
- `cover` — cover PDF

## API

| Method | Path |
|--------|------|
| POST | `/api/kdp/content/upload` |
| POST | `/api/kdp/content/upload/batch` |

Upload processing can take 1–2 minutes. The flow waits for upload confirmation then saves.
