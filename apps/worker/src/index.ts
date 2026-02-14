import { Hono } from "hono";

type Bindings = {
  TURNSTILE_SECRET: string;
};

type TurnstileResponse = {
  success?: boolean;
};

const app = new Hono<{ Bindings: Bindings }>();
const allowedOrigin = "https://disputeshield.app";

const applyCors = (c: {
  header: (name: string, value: string) => void;
}) => {
  c.header("Access-Control-Allow-Origin", allowedOrigin);
  c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  c.header("Access-Control-Max-Age", "86400");
  c.header("Vary", "Origin");
};

const jsonWithCors = (
  c: {
    header: (name: string, value: string) => void;
    json: (body: unknown, status?: number) => Response;
  },
  body: unknown,
  status = 200,
) => {
  applyCors(c);
  c.header("Content-Type", "application/json");
  return c.json(body, status);
};

app.options("/turnstile/verify", (c) => {
  applyCors(c);
  return c.body(null, 204);
});

app.post("/turnstile/verify", async (c) => {
  let token = "";
  try {
    const body = (await c.req.json()) as { token?: string };
    token = body.token ?? "";
  } catch {
    token = "";
  }

  if (!token) {
    return jsonWithCors(c, { ok: false }, 400);
  }

  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) {
    return jsonWithCors(c, { ok: false }, 500);
  }

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: formData,
    },
  );

  const data = (await response.json()) as TurnstileResponse;
  return jsonWithCors(c, { ok: Boolean(data.success) }, 200);
});

export default app;
