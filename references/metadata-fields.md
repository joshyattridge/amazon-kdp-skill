# Scraped book metadata fields

Each record in `.kdp-session/book-metadata.json`:

| Field | Source page |
|-------|-------------|
| `titleId`, `format` | Bookshelf |
| `title`, `subtitle`, `description` | Details |
| `keywords[]` (7) | Details |
| `categories[]` | Details |
| `seriesTitle`, `seriesNumber` | Details |
| `primaryAuthor`, `contributors` | Details |
| `language`, `readingInterestAgeMin/Max` | Details |
| `isPublicDomain`, `isAdultContent`, `largePrint` | Details |
| `asin`, `listPriceUsd`, `prices`, `territory` | Pricing |
| `trimSize`, `pageCount`, `interiorFileName` | Content |
| `kdpSelect`, `royaltyPlan` | Pricing |
| `syncedAt` | Sync timestamp |

## KDP URLs (per format)

```
https://kdp.amazon.com/en_US/title-setup/{format}/{titleId}/details
https://kdp.amazon.com/en_US/title-setup/{format}/{titleId}/content
https://kdp.amazon.com/en_US/title-setup/{format}/{titleId}/pricing
```

## Keyword fields

- 7 backend keyword slots, max 50 chars each
- Amazon indexes title/subtitle words in search
