# E2E tests (Playwright)

Run smoke tests without credentials:

```bash
pnpm test:e2e
```

## Auth and manual-order flows

These specs are skipped unless credentials are set:

| Variable | Description |
|----------|-------------|
| `E2E_EMAIL` | Staging/test user email |
| `E2E_PASSWORD` | Password for that user |
| `E2E_TENANT_B_EMAIL` | Second tenant user (RLS cross-tenant test) |
| `E2E_TENANT_B_PASSWORD` | Password for tenant B |

Example:

```bash
E2E_EMAIL=test@example.com E2E_PASSWORD=secret pnpm test:e2e
```

Use a **staging** Supabase project or local stack with seeded branch data. Do not point E2E at production.

## Install browsers (first time)

```bash
pnpm exec playwright install chromium
```

On unsupported Linux distros (e.g. very new Ubuntu), use a supported environment or install [Google Chrome](https://www.google.com/chrome/) and set `channel: 'chrome'` in `playwright.config.ts`.

## UI mode

```bash
pnpm test:e2e:ui
```
