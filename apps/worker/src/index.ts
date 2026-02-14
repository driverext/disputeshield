import { Hono } from "hono";

type Bindings = { TURNSTILE_SECRET: string };
type TurnstileResponse = { success?: boolean };

const app = new Hono<{ Bindings: Bindings }>();
const allowedOrigin = "https://disputeshield.app";

const getAllowedOrigin = (origin: string | null) => {
  if (origin === allowedOrigin) return origin;
  if (origin && origin.endsWith(".pages.dev")) return origin;
  return allowedOrigin;
};

app.use("*", async (c, next) => {
  const origin = getAllowedOrigin(c.req.header("Origin") ?? null);
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Credentials", "false");
  c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  c.header(
    "Access-Control-Allow-Headers",
    c.req.header("Access-Control-Request-Headers") ?? "Content-Type",
  );

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
});

app.post("/turnstile/verify", async (c) => {
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
    { method: "POST", body: formData },
  );

  const data = (await resp.json()) as TurnstileResponse;
  return c.json({ ok: Boolean(data.success) }, 200);
});

export default app;
