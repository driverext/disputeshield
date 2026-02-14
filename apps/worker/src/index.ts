import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  TURNSTILE_SECRET: string;
};

type TurnstileResponse = {
  success?: boolean;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.post("/turnstile/verify", async (c) => {
  let token = "";
  try {
    const body = (await c.req.json()) as { token?: string };
    token = body.token ?? "";
  } catch {
    token = "";
  }

  if (!token) {
    return c.json({ ok: false }, 400);
  }

  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) {
    return c.json({ ok: false }, 500);
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
  return c.json({ ok: Boolean(data.success) });
});

export default app;
