// Static site + Cashfree payment API (shared by Tamil Geethai and Bharathiya Cultural Class workers)
// Secrets/vars (Cloudflare → Worker → Settings → Variables and Secrets):
//   CF_APP_ID  (var)    Cashfree App ID
//   CF_SECRET  (secret) Cashfree Secret Key — never put in code
//   CF_ENV     (var)    "sandbox" or "production"
//   PAY_AMOUNT, PAY_NOTE, ORDER_PREFIX (vars)
const API_VERSION = "2023-08-01";

function base(env) {
  return env.CF_ENV === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}
function cfHeaders(env) {
  return {
    "x-client-id": env.CF_APP_ID,
    "x-client-secret": env.CF_SECRET,
    "x-api-version": API_VERSION,
    "content-type": "application/json",
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function createOrder(request, env) {
  if (!env.CF_APP_ID || !env.CF_SECRET) return json({ error: "payment_not_configured" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
  const name = String(body.name || "").trim().slice(0, 100);
  if (!/^[6-9]\d{9}$/.test(phone)) return json({ error: "bad_phone" }, 400);
  const orderId = (env.ORDER_PREFIX || "TG") + Date.now().toString(36).toUpperCase() + crypto.randomUUID().slice(0, 6).toUpperCase();
  const origin = new URL(request.url).origin;
  const payload = {
    order_id: orderId,
    order_amount: Number(env.PAY_AMOUNT || 200),
    order_currency: "INR",
    customer_details: {
      customer_id: "C" + phone,
      customer_phone: phone,
      ...(name.length >= 3 ? { customer_name: name } : {}),
    },
    order_meta: { return_url: `${origin}/register.html?order_id=${orderId}` },
    order_note: env.PAY_NOTE || "Tamil Geethai Guru Dakshina",
  };
  const r = await fetch(`${base(env)}/orders`, {
    method: "POST",
    headers: { ...cfHeaders(env), "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.payment_session_id) return json({ error: "cashfree_error", detail: d.message || r.status }, 502);
  return json({ order_id: d.order_id, payment_session_id: d.payment_session_id, mode: env.CF_ENV === "production" ? "production" : "sandbox" });
}

async function orderStatus(url, env) {
  const id = url.searchParams.get("order_id") || "";
  if (!/^[A-Za-z0-9_-]{3,45}$/.test(id)) return json({ error: "bad_order_id" }, 400);
  if (!env.CF_APP_ID || !env.CF_SECRET) return json({ error: "payment_not_configured" }, 503);
  const r = await fetch(`${base(env)}/orders/${encodeURIComponent(id)}`, { headers: cfHeaders(env) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: "cashfree_error", detail: d.message || r.status }, 502);
  return json({ order_id: d.order_id, status: d.order_status, amount: d.order_amount, cf_order_id: d.cf_order_id });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/pay/create" && request.method === "POST") return createOrder(request, env);
    if (url.pathname === "/api/pay/status" && request.method === "GET") return orderStatus(url, env);
    if (url.pathname === "/api/pay/config") return json({ enabled: !!(env.CF_APP_ID && env.CF_SECRET), amount: Number(env.PAY_AMOUNT || 200), mode: env.CF_ENV === "production" ? "production" : "sandbox" });
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
