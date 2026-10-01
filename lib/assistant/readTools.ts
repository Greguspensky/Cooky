import { adminDb } from "../db.js";
import { env } from "../env.js";
import { buildSearchTsQuery } from "../recipe.js";
import type { AssistantContext } from "./context.js";
import { resolveWho } from "./context.js";

/** Executes a read-only tool call immediately. Every query is scoped by household_id here,
 * server-side, rather than trusting the model to have scoped its own arguments. */
export async function executeReadTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AssistantContext,
): Promise<unknown> {
  switch (name) {
    case "search_recipes":
      return searchRecipes(input, ctx);
    case "get_recipe":
      return getRecipe(input, ctx);
    case "get_preferences":
      return getPreferences(input, ctx);
    case "open_in_app":
      return openInApp(input);
    case "get_cook_entries":
      return getCookEntries(input, ctx);
    default:
      throw new Error(`Unknown read-only tool: ${name}`);
  }
}

async function getCookEntries(input: Record<string, unknown>, ctx: AssistantContext) {
  let query = adminDb()
    .from("cook_entries")
    .select("entry_date, status, recipes(title)")
    .eq("household_id", ctx.householdId)
    .order("entry_date", { ascending: true })
    .limit(50);

  if (typeof input.recipe_id === "string") query = query.eq("recipe_id", input.recipe_id);
  if (input.status === "planned" || input.status === "cooked") query = query.eq("status", input.status);
  if (typeof input.from_date === "string") query = query.gte("entry_date", input.from_date);
  if (typeof input.to_date === "string") query = query.lte("entry_date", input.to_date);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    recipe_title: (row.recipes as unknown as { title: string } | null)?.title ?? "(deleted recipe)",
    date: row.entry_date,
    status: row.status,
  }));
}

async function searchRecipes(input: Record<string, unknown>, ctx: AssistantContext) {
  let query = adminDb()
    .from("recipes")
    .select("id, title, cuisine, tags, total_minutes, servings, recipe_user_meta(user_id, is_favorite, rating)")
    .eq("household_id", ctx.householdId)
    .order("created_at", { ascending: false })
    .limit(10);

  const search = typeof input.query === "string" ? buildSearchTsQuery(input.query) : null;
  if (search) query = query.filter("search", "fts(simple)", search);
  if (typeof input.cuisine === "string") query = query.eq("cuisine", input.cuisine);
  if (typeof input.max_minutes === "number") query = query.lte("total_minutes", input.max_minutes);

  const { data, error } = await query;
  if (error) throw error;

  let rows = data ?? [];
  const favoritesOf = input.favorites_of;
  if (favoritesOf === "me" || favoritesOf === "partner") {
    const userId = resolveWho(ctx, favoritesOf);
    rows = rows.filter((r) => r.recipe_user_meta.some((m) => m.user_id === userId && m.is_favorite));
  } else if (favoritesOf === "either") {
    rows = rows.filter((r) => r.recipe_user_meta.some((m) => m.is_favorite));
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    cuisine: r.cuisine,
    tags: r.tags,
    total_minutes: r.total_minutes,
    servings: r.servings,
  }));
}

async function getRecipe(input: Record<string, unknown>, ctx: AssistantContext) {
  if (typeof input.id !== "string") return { error: "missing_id" };
  const { data, error } = await adminDb()
    .from("recipes")
    .select("*")
    .eq("id", input.id)
    .eq("household_id", ctx.householdId)
    .maybeSingle();
  if (error) throw error;
  return data ?? { error: "not_found" };
}

async function getPreferences(input: Record<string, unknown>, ctx: AssistantContext) {
  const who = typeof input.who === "string" ? input.who : "both";
  const userIds = who === "both" ? [ctx.userId, ctx.partnerId].filter((id): id is string => !!id) : [resolveWho(ctx, who)].filter((id): id is string => !!id);
  if (userIds.length === 0) return {};

  const { data, error } = await adminDb()
    .from("taste_preferences")
    .select("user_id, likes, dislikes, diet_notes")
    .in("user_id", userIds);
  if (error) throw error;

  const byUser: Record<string, unknown> = {};
  for (const id of userIds) {
    const row = data?.find((d) => d.user_id === id);
    byUser[id === ctx.userId ? "me" : "partner"] = row
      ? { likes: row.likes, dislikes: row.dislikes, diet_notes: row.diet_notes }
      : { likes: [], dislikes: [], diet_notes: null };
  }
  return byUser;
}

function openInApp(input: Record<string, unknown>) {
  const targetType = input.target_type;
  const id = input.id;
  if (typeof id !== "string") return { error: "missing_id" };
  const prefix = targetType === "grocery_list" ? "list" : "recipe";
  const url = new URL(env.miniAppUrl);
  url.searchParams.set("startapp", `${prefix}_${id}`);
  return { url: url.toString() };
}
