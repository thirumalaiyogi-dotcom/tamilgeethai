// Supabase Edge Function "pay" — Cashfree payments for both sites (server-side, tamper-proof)
// Secret needed (Supabase → Edge Functions → Secrets): CF_SECRET
// IMPORTANT: Edge Functions → pay → Details → "Verify JWT" must be OFF (Cashfree webhook calls this).
const APP_ID = "145409773864e6696cb56744b897904541";
const MODE = "production"; // "sandbox" for testing
const SITES: Record<string, { amount: number; prefix: string; note: string; ret: string; source: string }> = {
  bcc: { amount: 250, prefix: "BCC", note: "Bharathiya Cultural Class fee", ret: "https://bharathiyaculturalclass-tamilgeethai.com/register.html", source: "bcc" },
  tg: { amount: 200, prefix: "TG", note: "Tamil Geethai Guru Dakshina", ret: "https://tamilgeethai.com/register.html", source: "tamilgeethai" },
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CF = MODE === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("CF_SECRET") || "";
const FN_URL = `${SB_URL}/functions/v1/pay`;

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "content-type": "application/json" } });
const cfH = () => ({ "x-client-id": APP_ID, "x-client-secret": SECRET, "x-api-version": "2023-08-01", "content-type": "application/json" });
const sbH = (extra: Record<string, string> = {}) => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", ...extra });
const clip = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);

async function getOrder(id: string) {
  const r = await fetch(`${CF}/orders/${encodeURIComponent(id)}`, { headers: cfH() });
  const d = await r.json().catch(() => ({}));
  return r.ok ? d : null;
}

// Mark the registration paid — only after Cashfree itself confirms PAID.
async function markPaid(id: string) {
  const o = await getOrder(id);
  if (!o) return { status: "UNKNOWN" };
  if (o.order_status === "PAID") {
    const q = `${SB_URL}/rest/v1/registrations?order_id=eq.${encodeURIComponent(id)}&paid=eq.false&select=id,details`;
    const rows = await (await fetch(q, { headers: sbH() })).json().catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) {
      const details = { ...(row.details || {}), payment: `Online ₹${o.order_amount} செலுத்தப்பட்டது ✓`, cf_order_id: o.cf_order_id };
      await fetch(`${SB_URL}/rest/v1/registrations?id=eq.${row.id}`, {
        method: "PATCH",
        headers: sbH({ Prefer: "return=minimal" }),
        body: JSON.stringify({ paid: true, paid_at: new Date().toISOString(), details }),
      });
    }
  }
  return { status: o.order_status, amount: o.order_amount, cf_order_id: o.cf_order_id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  let b: any = {};
  try { b = await req.json(); } catch { /* empty */ }

  // Cashfree server-to-server notification (notify_url). We never trust the body —
  // we only take the order id and re-check the order with Cashfree.
  if (url.searchParams.get("webhook") === "1") {
    const id = clip(b?.data?.order?.order_id, 45);
    if (/^[A-Za-z0-9_-]{3,45}$/.test(id) && SECRET) await markPaid(id);
    return json({ ok: true });
  }

  const site = SITES[b.site] ? b.site : "tg";
  const cfg = SITES[site];
  if (b.action === "config") return json({ enabled: !!SECRET, amount: cfg.amount, mode: MODE });
  if (!SECRET) return json({ error: "payment_not_configured" }, 503);

  if (b.action === "create") {
    const reg = b.reg && typeof b.reg === "object" ? b.reg : {};
    const phone = String(reg.whatsapp || b.phone || "").replace(/\D/g, "").slice(-10);
    const name = clip(reg.name || b.name, 120);
    if (!/^[6-9]\d{9}$/.test(phone)) return json({ error: "bad_phone" }, 400);
    if (!name) return json({ error: "bad_name" }, 400);
    const orderId = cfg.prefix + Date.now().toString(36).toUpperCase() + crypto.randomUUID().slice(0, 6).toUpperCase();

    // 1) Save the registration first (pending), server-side.
    const details: Record<string, string> = {};
    for (const [k, v] of Object.entries(reg)) {
      if (["name", "whatsapp", "district", "town", "taluk", "payment", "order_id", "cf_order_id", "paid"].includes(k)) continue;
      if (typeof v === "string" || typeof v === "number") details[clip(k, 40)] = clip(v, 500);
    }
    details.payment = `⏳ ₹${cfg.amount} payment நிலுவை`;
    details.order_id = orderId;
    const ins = await fetch(`${SB_URL}/rest/v1/registrations`, {
      method: "POST",
      headers: sbH({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        source: cfg.source, name, whatsapp: phone,
        district: clip(reg.district, 80) || null, town: clip(reg.town || reg.taluk, 80) || null,
        details, order_id: orderId, amount: cfg.amount,
      }),
    });
    if (!ins.ok) return json({ error: "save_failed", detail: await ins.text() }, 500);

    // 2) Create the Cashfree order.
    const r = await fetch(`${CF}/orders`, {
      method: "POST",
      headers: { ...cfH(), "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: cfg.amount,
        order_currency: "INR",
        customer_details: { customer_id: "C" + phone, customer_phone: phone, ...(name.length >= 3 ? { customer_name: name.slice(0, 100) } : {}) },
        order_meta: { return_url: `${cfg.ret}?order_id=${orderId}`, notify_url: `${FN_URL}?webhook=1` },
        order_note: cfg.note,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.payment_session_id) return json({ error: "cashfree_error", detail: d.message || r.status }, 502);
    return json({ order_id: d.order_id, payment_session_id: d.payment_session_id, mode: MODE });
  }

  if (b.action === "status") {
    const id = clip(b.order_id, 45);
    if (!/^[A-Za-z0-9_-]{3,45}$/.test(id)) return json({ error: "bad_order_id" }, 400);
    return json({ order_id: id, ...(await markPaid(id)) });
  }
  return json({ error: "unknown_action" }, 400);
});
