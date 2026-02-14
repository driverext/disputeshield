import { Hono } from "hono";

type Bindings = { TURNSTILE_SECRET: string };
type TurnstileResponse = { success?: boolean };

const app = new Hono<{ Bindings: Bindings }>();

const ALLOWED_ORIGINS = new Set([
  "https://disputeshield.app",
]);

const isPreviewOrigin = (origin: string) =>
  origin.startsWith("https://") && origin.endsWith(".pages.dev");

function getAllowedOrigin(reqOrigin: string | null) {
  if (!reqOrigin) return "https://disputeshield.app";
  if (ALLOWED_ORIGINS.has(reqOrigin) || isPreviewOrigin(reqOrigin)) return reqOrigin;
  return "https://disputeshield.app";
}

function withCors(c: any) {
  const origin = getAllowedOrigin(c.req.header("Origin") ?? null);
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "content-type");
  c.header("Access-Control-Max-Age", "86400");
}

app.options("/turnstile/*", (c) => {
  withCors(c);
  return c.body(null, 204);
});

app.post("/turnstile/verify", async (c) => {
  withCors(c);

  let token = "";
  try {
    const body = (await c.req.json()) as { token?: string };
    token = body.token ?? "";
  } catch {}

  if (!token) return c.json({ ok: false, error: "missing_token" }, 400);

  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) return c.json({ ok: false, error: "missing_secret" }, 500);

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);

  const resp = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: formData }
  );

  const data = (await resp.json()) as TurnstileResponse;
  return c.json({ ok: Boolean(data.success) }, 200);
});

export default app;
