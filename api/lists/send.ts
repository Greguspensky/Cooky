import { getBot } from "../../lib/bot.js";
import { adminDb } from "../../lib/db.js";
import { STORE_SECTION_LABELS, STORE_SECTION_ORDER, type GroceryItem } from "../../lib/grocery.js";
import { verifySessionToken } from "../../lib/jwt.js";

/**
 * POST /api/lists/send  { listId }
 * Posts a grocery list to both household members' Telegram chats, for offline use at the store.
 * Sending needs the bot token, so it goes through the server rather than straight to Supabase.
 */
export async function POST(request: Request): Promise<Response> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  let claims;
  try {
    claims = await verifySessionToken(token);
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  let listId: unknown;
  try {
    ({ listId } = (await request.json()) as { listId?: unknown });
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof listId !== "string" || !listId) return json({ error: "missing_list_id" }, 400);

  const db = adminDb();
  const list = await db.from("grocery_lists").select("id, name, household_id").eq("id", listId).maybeSingle();
  if (list.error) throw list.error;
  if (!list.data || list.data.household_id !== claims.householdId) {
    return json({ error: "not_found" }, 404);
  }

  const items = await db
    .from("grocery_items")
    .select("item, qty, unit, store_section, checked")
    .eq("list_id", listId);
  if (items.error) throw items.error;

  const recipients = await db.from("users").select("telegram_id").eq("household_id", claims.householdId);
  if (recipients.error) throw recipients.error;

  const text = formatListMessage(list.data.name, (items.data ?? []) as Pick<GroceryItem, "item" | "qty" | "unit" | "store_section" | "checked">[]);

  const bot = getBot();
  const results = await Promise.allSettled(
    recipients.data.map((r) => bot.api.sendMessage(Number(r.telegram_id), text, { parse_mode: "Markdown" })),
  );
  const sent = results.filter((r) => r.status === "fulfilled").length;

  return json({ ok: true, sent, of: results.length });
}

function formatListMessage(
  name: string,
  items: Pick<GroceryItem, "item" | "qty" | "unit" | "store_section" | "checked">[],
): string {
  const lines = [`🛒 ${name}`, ""];
  for (const section of STORE_SECTION_ORDER) {
    const inSection = items.filter((i) => i.store_section === section && !i.checked);
    if (inSection.length === 0) continue;
    lines.push(`*${STORE_SECTION_LABELS[section]}*`);
    for (const i of inSection) {
      const qty = [i.qty, i.unit].filter((v) => v != null && v !== "").join(" ");
      lines.push(`☐ ${qty ? `${qty} ` : ""}${i.item}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
