---
name: amazon-kdp-connect
description: Connects and manages the Amazon KDP browser session for Playwright automation. Use when signing in to KDP, checking if the session is valid, reconnecting after expiry, or disconnecting.
disable-model-invocation: true
---

# KDP Connect Session

**Agent runs all commands.** Only the Amazon sign-in step requires the user (MFA in Chromium).

## Ensure server is running

```bash
npm run server:start   # background if not already listening on :3001
```

## Check status

```bash
npm run status
```

`connected: true` → ready. `connected: false` → start login flow below.

## Sign in (agent-driven)

1. Agent starts server if needed.
2. Agent runs: `npm run login`
3. **Tell the user** to complete Amazon sign-in in the visible Chromium window (MFA if prompted).
4. Agent polls: `npm run status` until `connected: true`

Session saved to `.kdp-session/amazon-kdp.json`.

## Disconnect

```bash
curl -X DELETE http://localhost:3001/api/kdp/session
```

Clears session cookies and local metadata cache.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/kdp/status` | Connection + session timestamp |
| POST | `/api/kdp/login/start` | Open login browser |
| DELETE | `/api/kdp/session` | Log out locally |

## Errors

- **401 on any endpoint** → session expired; re-run login
- **Login already in progress** → wait for browser window to finish

See [references/troubleshooting.md](../../references/troubleshooting.md).
