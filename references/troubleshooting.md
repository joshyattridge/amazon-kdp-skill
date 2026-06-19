# Troubleshooting

## Session expired / 401

```bash
npm run login
npm run status   # wait for connected: true
```

## Server Busy (metadata update fails)

Amazon rate-limits rapid page loads. Symptoms: page title "Server Busy", error `Could not find editable fields`.

**Fix:**
- Default spacing is 4s between every KDP request (`KDP_REQUEST_DELAY_MS=4000` in `.env`)
- Increase to `6000` or `8000` if still blocked
- Update books in smaller batches
- Wait 1–2 minutes if still blocked, then retry

## fetch failed on batch update

Single HTTP request timed out for many books. Use single-book `/api/kdp/metadata/update` calls or smaller batches instead.

## Bookshelf sync count lower than expected

Only rows with editable title-setup links sync. Placeholder rows ("Create Kindle eBook") and incomplete setups are skipped. Check `stats` in sync response.

## Save reported failure but change applied

KDP shows warning banners (e.g. scheduled release, language notice) that are not save failures. Update flow verifies by **re-reading** metadata after save.

## Pricing page not available after content upload

KDP blocks pricing until manuscript (and often cover) finish processing. The publish wizard polls up to **10 minutes** (`waitForPricingPageReady`). If it times out, open the title in KDP manually or re-run:

```bash
npm run publish:book -- output/YourBook.pricing-only.json --live
```

(JSON with `"titleId"`, `"pricing"` only, `"create": false`.)

## Cover upload shows NOT_STARTED

Ensure print settings (trim size, ink/paper type) are set before cover upload. The content flow now waits for hidden `publisher_cover[status]=SUCCESS` before continuing.

## Playwright / Chromium

```bash
npx playwright install chromium
```

Headless updates; login uses visible browser (`headless: false` in login.ts).

## Port in use

Change `KDP_SERVER_PORT` in `.env`.
