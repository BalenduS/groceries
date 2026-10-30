// Groceries – push notifications for the shared monthly list.
// POST JSON {action, ...} with Authorization: Bearer <member's session token>
//   vapid  → { publicKey }
//   test   → a test push to the caller's own phones
//   notify → tell the rest of the family what the caller just did
//            {type: "tick" | "add", item_id} or {type: "list", month_id, count}
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// The VAPID key pair is shared with the Sankalp app (same Supabase project).
async function vapid() {
  const { data } = await db.from("sk_secrets").select("key,value").in("key", ["vapid_public", "vapid_private"]);
  const m = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  let pub = m.vapid_public as string | undefined, priv = m.vapid_private as string | undefined;
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await db.from("sk_secrets").upsert([{ key: "vapid_public", value: k.publicKey }, { key: "vapid_private", value: k.privateKey }]);
    pub = k.publicKey; priv = k.privateKey;
  }
  webpush.setVapidDetails("mailto:groceries@balendu.me", pub, priv);
  return pub;
}

async function pushTo(memberIds: string[], payload: Record<string, unknown>) {
  if (!memberIds.length) return 0;
  await vapid();
  const { data: subs } = await db.from("gr_push_subs").select("*").in("member_id", memberIds);
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 3, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("gr_push_subs").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", code, String(e));
    }
  }));
  return sent;
}

async function caller(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return null;
  const { data: m } = await db.from("gr_members").select("id,household_code,name").eq("user_id", data.user.id).limit(1).maybeSingle();
  return m;
}

const rupees = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "vapid") return json({ publicKey: await vapid() });

    const me = await caller(req);
    if (!me) return json({ error: "sign in first" }, 401);

    if (body.action === "test") {
      const n = await pushTo([me.id], { title: "🛒 Notifications are on", body: "You'll hear when someone ticks or adds an item.", tag: "gr-test" });
      return json({ sent: n });
    }

    if (body.action === "notify") {
      const { data: others } = await db.from("gr_members").select("id").eq("household_code", me.household_code).neq("id", me.id);
      const ids = (others ?? []).map((o) => o.id);
      let payload: Record<string, unknown> | null = null;

      if (body.type === "tick" || body.type === "add") {
        const { data: it } = await db.from("gr_items").select("name,qty,unit,price,bought_by,household_code,month_id")
          .eq("id", body.item_id).maybeSingle();
        if (!it || it.household_code !== me.household_code) return json({ error: "not found" }, 404);
        if (body.type === "tick") {
          if (!it.bought_by) return json({ sent: 0 });
          const { data: all } = await db.from("gr_items").select("bought_by,price")
            .eq("month_id", it.month_id);
          const got = (all ?? []).filter((x) => x.bought_by).length;
          const spent = (all ?? []).filter((x) => x.bought_by).reduce((a, x) => a + Number(x.price), 0);
          payload = {
            title: `✓ ${me.name} got ${it.name}`,
            body: `${got} of ${(all ?? []).length} bought · ${rupees(spent)} spent`,
            tag: "gr-live",
          };
        } else {
          payload = {
            title: `➕ ${me.name} added ${it.name}`,
            body: `${it.qty} ${it.unit}${Number(it.price) ? " · " + rupees(Number(it.price)) : ""}`,
            tag: "gr-add",
          };
        }
      } else if (body.type === "list") {
        const { data: mo } = await db.from("gr_months").select("month,household_code").eq("id", body.month_id).maybeSingle();
        if (!mo || mo.household_code !== me.household_code) return json({ error: "not found" }, 404);
        const label = new Date(mo.month + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" });
        const count = Math.max(0, Math.min(500, Number(body.count) || 0));
        payload = { title: `📝 ${label} list is ready`, body: `${me.name} started it with ${count} items. Take a look before shopping.`, tag: "gr-list" };
      }
      if (!payload) return json({ error: "unknown type" }, 400);
      return json({ sent: await pushTo(ids, { ...payload, url: "./" }) });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
