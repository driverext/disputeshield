export type PagesEnv = {
  TURNSTILE_SECRET: string;
};

export const onRequestPost: PagesFunction<PagesEnv> = async ({ request, env }) => {
  let token = "";
  try {
    const body = (await request.json()) as { token?: string };
    token = body.token ?? "";
  } catch {
    token = "";
  }

  if (!token) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!env.TURNSTILE_SECRET) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const formData = new FormData();
  formData.append("secret", env.TURNSTILE_SECRET);
  formData.append("response", token);

  const resp = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: formData,
    },
  );

  const data = (await resp.json()) as { success?: boolean };
  return new Response(JSON.stringify({ ok: Boolean(data.success) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
