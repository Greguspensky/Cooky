import { adminDb } from "../../lib/db.js";
import { verifySessionToken } from "../../lib/jwt.js";
import type { ExtractedRecipe } from "../../lib/cookbook.js";

/**
 * POST /api/cookbooks/candidates  { candidateId, action: "accept" | "reject" }
 * The client can only read import_candidates (RLS), not write them, since accepting one creates
 * a recipe and needs to be consistent with the candidate's new status. Rejecting is simple but
 * goes through the same endpoint for symmetry.
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

  let body: { candidateId?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const { candidateId, action } = body;
  if (typeof candidateId !== "string" || !candidateId) return json({ error: "missing_candidate_id" }, 400);
  if (action !== "accept" && action !== "reject") return json({ error: "invalid_action" }, 400);

  const db = adminDb();
  const candidate = await db
    .from("import_candidates")
    .select("id, recipe, page, status, cookbooks!inner(household_id, title)")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidate.error) throw candidate.error;
  const cookbook = candidate.data?.cookbooks as unknown as { household_id: string; title: string } | undefined;
  if (!candidate.data || !cookbook || cookbook.household_id !== claims.householdId) {
    return json({ error: "not_found" }, 404);
  }
  if (candidate.data.status !== "pending") return json({ error: "already_decided" }, 409);

  if (action === "reject") {
    const update = await db.from("import_candidates").update({ status: "rejected" }).eq("id", candidateId);
    if (update.error) throw update.error;
    return json({ ok: true });
  }

  const recipe = candidate.data.recipe as ExtractedRecipe;
  const created = await db
    .from("recipes")
    .insert({
      household_id: claims.householdId,
      title: recipe.title,
      description: recipe.description,
      servings: recipe.servings,
      prep_minutes: recipe.prep_minutes,
      cook_minutes: recipe.cook_minutes,
      cuisine: recipe.cuisine,
      tags: recipe.tags,
      ingredients: recipe.ingredients.map((i) => ({ ...i, id: crypto.randomUUID(), store_section: null })),
      steps: recipe.steps.map((s, idx) => ({ n: idx + 1, text: s.text, timer_seconds: null, ingredient_ids: [] })),
      source_type: "pdf",
      source_ref: { book_title: cookbook.title, page: candidate.data.page },
      created_by: claims.userId,
    })
    .select("id")
    .single();
  if (created.error) throw created.error;

  const update = await db.from("import_candidates").update({ status: "accepted" }).eq("id", candidateId);
  if (update.error) throw update.error;

  return json({ ok: true, recipeId: created.data.id });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
