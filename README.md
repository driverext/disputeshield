# DisputeShield

## Environment Variables

Frontend (`apps/web`):
- `VITE_TURNSTILE_SITEKEY` = Cloudflare Turnstile site key
- `VITE_WORKER_URL` = Base URL for the Worker (optional; use when not deploying on the same origin)

Backend (`apps/worker`):
- `TURNSTILE_SECRET` = Cloudflare Turnstile secret key

## Notes
- Turnstile verification is bypassed in local dev when `import.meta.env.DEV` is true.
