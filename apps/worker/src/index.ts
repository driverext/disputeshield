import { Hono } from "hono";

type Bindings = {
  TURNSTILE_SECRET: string;
};

type TurnstileResponse = {
  success?: boolean;
};

const allowedOrigin = "https://disputeshield.app";

const app = new Hono<{ Bindings: Bindings }>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
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
    return jsonResponse({ ok: false }, 400);
  }

  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) {
    return jsonResponse({ ok: false }, 500);
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
  return jsonResponse({ ok: Boolean(data.success) }, 200);
});

const addCors = (res: Response) => {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set("Vary", "Origin");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};

export default {
  fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }

    return app.fetch(request, env, ctx).then(addCors);
  },
};
