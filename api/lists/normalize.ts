import Anthropic from "@anthropic-ai/sdk";
import { adminDb } from "../../lib/db.js";
import { env } from "../../lib/env.js";
import { verifySessionToken } from "../../lib/jwt.js";

/**
 * POST /api/lists/normalize  { listId }
 * Rewrites a list's unchecked items from cooking quantities into realistic shop-buyable ones
 * (e.g. "2 tbsp mayonnaise" -> "1 jar mayonnaise"), leaving already-sensible quantities (weights,
 * counts) alone. One Claude call per press of the button — this never runs on its own.
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
  const list = await db.from("grocery_lists").select("id, household_id").eq("id", listId).maybeSingle();
  if (list.error) throw list.error;
  if (!list.data || list.data.household_id !== claims.householdId) return json({ error: "not_found" }, 404);

  const items = await db
    .from("grocery_items")
    .select("id, item, qty, unit")
    .eq("list_id", listId)
    .eq("checked", false);
  if (items.error) throw items.error;
  if (items.data.length === 0) return json({ updated: 0 });

  const updates = await normalizeForShopping(items.data);
  if (updates.length === 0) return json({ updated: 0 });

  await Promise.all(updates.map((u) => db.from("grocery_items").update({ qty: u.qty, unit: u.unit }).eq("id", u.id)));

  return json({ updated: updates.length });
}

export interface LineItem {
  id: string;
  item: string;
  qty: number | null;
  unit: string | null;
}

export interface NormalizedChange {
  id: string;
  qty: number;
  unit: string;
}

/** Keeps only well-formed changes that reference a real item on this list — Claude's tool call
 * is untrusted input, not a guarantee. Exported so this filtering can be unit tested without
 * mocking the Anthropic API. */
export function parseNormalizeChanges(items: LineItem[], rawChanges: unknown): NormalizedChange[] {
  if (!Array.isArray(rawChanges)) return [];
  const validIds = new Set(items.map((i) => i.id));
  return rawChanges.filter(
    (c): c is NormalizedChange =>
      !!c &&
      typeof c === "object" &&
      typeof (c as NormalizedChange).id === "string" &&
      validIds.has((c as NormalizedChange).id) &&
      typeof (c as NormalizedChange).qty === "number" &&
      Number.isFinite((c as NormalizedChange).qty) &&
      (c as NormalizedChange).qty > 0 &&
      typeof (c as NormalizedChange).unit === "string" &&
      (c as NormalizedChange).unit.trim().length > 0,
  );
}

const NORMALIZE_TOOL: Anthropic.Tool = {
  name: "rewrite_items",
  description: "Rewrite grocery items that need a shop-buyable quantity instead of a cooking measurement.",
  input_schema: {
    type: "object",
    properties: {
      changes: {
        type: "array",
        description: "Only the items that actually need changing — omit anything already fine as-is.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            qty: { type: "number", description: "How many of the retail unit, e.g. 1." },
            unit: { type: "string", description: "A retail unit, e.g. jar, can, bottle, bunch, head, bag, loaf, pack." },
          },
          required: ["id", "qty", "unit"],
        },
      },
    },
    required: ["changes"],
  },
};

const SYSTEM_PROMPT = `You help turn a recipe-derived grocery list into one that makes sense at a shop. Most
items are already fine — a weight ("300 g chicken breast"), a count ("2 onions"), or no quantity at
all. Only flag items whose quantity is a small cooking measurement that doesn't match how the thing
is actually sold: tsp/tbsp/ml/cl/pinch/dash of a condiment, sauce, oil, spice or similar (mayonnaise,
mustard, ketchup, soy sauce, vinegar, oil, individual spices), or a count of something normally sold
as a unit (e.g. "3 cloves garlic" sold as a bulb). For those, suggest a realistic retail quantity and
unit (e.g. "1 jar", "1 bottle", "1 bulb", "1 bag", "1 bunch", "1 head", "1 loaf", "1 pack", "1 can").
Call rewrite_items with only the items that actually need changing.`;

async function normalizeForShopping(items: LineItem[]): Promise<NormalizedChange[]> {
  const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
  const response = await anthropic.messages.create({
    model: env.claudeModelFast,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [NORMALIZE_TOOL],
    tool_choice: { type: "tool", name: "rewrite_items" },
    messages: [
      {
        role: "user",
        content: JSON.stringify(items.map((i) => ({ id: i.id, item: i.item, qty: i.qty, unit: i.unit }))),
      },
    ],
  });

  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return parseNormalizeChanges(items, (call?.input as { changes?: unknown } | undefined)?.changes);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
