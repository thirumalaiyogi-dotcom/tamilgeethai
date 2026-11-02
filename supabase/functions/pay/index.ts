// Supabase Edge Function "pay" — Cashfree payment for both sites
// Secret needed (Supabase → Edge Functions → Secrets): CF_SECRET
const APP_ID = "145409773864e6696cb56744b897904541";
const MODE = "production";
const SITES: Record<string, { amount: number; prefix: string; note: string; ret: string }> = {
  bcc: { amount: 250, prefix: "BCC", note: "Bharathiya Cultural Class fee", ret: "https://bharathiyaculturalclass-tamilgeethai.com/register.html" },
  tg: { amount: 200, prefix: "TG", note: "Tamil Geethai Guru Dakshina", ret: "https://tamilgeethai.com/register.html" },
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const base = MODE === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const secret = Deno.env.get("CF_SECRET") || "";
  let b: any = {};
  try { b = await req.json(); } catch { /* empty */ }
  const site = SITES[b.site] ? b.site : "tg";
  const cfg = SITES[site];
  const H = { "x-client-id": APP_ID, "x-client-secret": secret, "x-api-version": "2023-08-01", "content-type": "application/json" };

  if (b.action === "config") return json({ enabled: !!secret, amount: cfg.amount, mode: MODE });
  if (!secret) return json({ error: "payment_not_configured" }, 503);

  if (b.action === "create") {
    const phone = String(b.phone || "").replace(/\D/g, "").slice(-10);
    const name = String(b.name || "").trim().slice(0, 100);
    if (!/^[6-9]\d{9}$/.test(phone)) return json({ error: "bad_phone" }, 400);
    const orderId = cfg.prefix + Date.now().toString(36).toUpperCase() + crypto.randomUUID().slice(0, 6).toUpperCase();
    const r = await fetch(`${base}/orders`, {
      method: "POST",
      headers: { ...H, "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: cfg.amount,
        order_currency: "INR",
        customer_details: { customer_id: "C" + phone, customer_phone: phone, ...(name.length >= 3 ? { customer_name: name } : {}) },
        order_meta: { return_url: `${cfg.ret}?order_id=${orderId}` },
        order_note: cfg.note,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.payment_session_id) return json({ error: "cashfree_error", detail: d.message || r.status }, 502);
    return json({ order_id: d.order_id, payment_session_id: d.payment_session_id, mode: MODE });
  }

  if (b.action === "status") {
    const id = String(b.order_id || "");
    if (!/^[A-Za-z0-9_-]{3,45}$/.test(id)) return json({ error: "bad_order_id" }, 400);
    const r = await fetch(`${base}/orders/${encodeURIComponent(id)}`, { headers: H });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "cashfree_error", detail: d.message || r.status }, 502);
    return json({ order_id: d.order_id, status: d.order_status, amount: d.order_amount, cf_order_id: d.cf_order_id });
  }
  return json({ error: "unknown_action" }, 400);
});
