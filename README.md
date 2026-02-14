# DisputeShield

## Environment Variables

Frontend (`apps/web`):
- `VITE_TURNSTILE_SITEKEY` = Cloudflare Turnstile site key
- `VITE_WORKER_URL` = Base URL for the Worker (optional; use when not deploying on the same origin)

Backend (`apps/worker`):
- `TURNSTILE_SECRET` = Cloudflare Turnstile secret key

## Cloudflare Worker Deploy

Cloudflare Pages/Workers settings:
- Path: `apps/worker`
- Build command: (leave blank)
- Deploy command: `cd apps/worker && npx wrangler deploy`

Notes:
- `wrangler.toml` lives in `apps/worker`.
- Use `npm install` (not `npm ci`) if you encounter lockfile-related CI issues in a monorepo.

## Notes
- Turnstile verification is bypassed in local dev when `import.meta.env.DEV` is true.
