import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ingredient, Recipe, RecipeStep, RecipeUserMeta } from "../../../lib/recipe";
import { buildSearchTsQuery } from "../../../lib/recipe";

export type RecipeWithMeta = Recipe & { recipe_user_meta: RecipeUserMeta[] };

export type FavoritesFilter = "any" | "mine" | "partner";
export type RecipeSort = "newest" | "title";

export interface RecipeFilters {
  search: string;
  cuisine: string | null;
  tag: string | null;
  favorites: FavoritesFilter;
  maxMinutes: number | null;
  sort: RecipeSort;
}

export const PAGE_SIZE = 20;

const META_COLUMNS = "user_id, is_favorite, rating, personal_note";

/** One page of the household's recipes, with both partners' favorite/rating/note attached. */
export async function listRecipes(
  db: SupabaseClient,
  filters: RecipeFilters,
  myUserId: string,
  partnerUserId: string | null,
  page: number,
): Promise<{ rows: RecipeWithMeta[]; hasMore: boolean }> {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE; // one extra row, to detect "more" without a separate count query

  // Filtering by favorite requires an inner join, so it only excludes non-matching recipes
  // when a favorites filter is actually chosen.
  const needsFavoriteJoin = filters.favorites !== "any";
  let query = db
    .from("recipes")
    .select(needsFavoriteJoin ? `*, recipe_user_meta!inner(${META_COLUMNS})` : `*, recipe_user_meta(${META_COLUMNS})`)
    .range(from, to);

  if (filters.favorites === "mine") {
    query = query.eq("recipe_user_meta.user_id", myUserId).eq("recipe_user_meta.is_favorite", true);
  } else if (filters.favorites === "partner" && partnerUserId) {
    query = query.eq("recipe_user_meta.user_id", partnerUserId).eq("recipe_user_meta.is_favorite", true);
  }

  const tsQuery = buildSearchTsQuery(filters.search);
  if (tsQuery) query = query.filter("search", "fts(simple)", tsQuery);
  if (filters.cuisine) query = query.eq("cuisine", filters.cuisine);
  if (filters.tag) query = query.contains("tags", [filters.tag]);
  if (filters.maxMinutes != null) query = query.lte("total_minutes", filters.maxMinutes);
  query =
    filters.sort === "title"
      ? query.order("title", { ascending: true })
      : query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as RecipeWithMeta[];
  const hasMore = rows.length > PAGE_SIZE;
  return { rows: hasMore ? rows.slice(0, PAGE_SIZE) : rows, hasMore };
}

/** Distinct cuisines and tags already in use, for filter dropdowns and tag autocomplete. */
export async function listCuisinesAndTags(
  db: SupabaseClient,
): Promise<{ cuisines: string[]; tags: string[] }> {
  const { data, error } = await db.from("recipes").select("cuisine, tags");
  if (error) throw error;
  const cuisines = new Set<string>();
  const tags = new Set<string>();
  for (const row of data ?? []) {
    if (row.cuisine) cuisines.add(row.cuisine);
    for (const t of row.tags ?? []) tags.add(t);
  }
  return { cuisines: [...cuisines].sort(), tags: [...tags].sort() };
}

export async function fetchRecipe(db: SupabaseClient, id: string): Promise<RecipeWithMeta> {
  const { data, error } = await db
    .from("recipes")
    .select(`*, recipe_user_meta(${META_COLUMNS})`)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as unknown as RecipeWithMeta;
}

export interface RecipeWritePayload {
  title: string;
  description: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  cuisine: string | null;
  tags: string[];
  ingredients: Ingredient[];
  steps: RecipeStep[];
}

export async function createRecipe(
  db: SupabaseClient,
  householdId: string,
  userId: string,
  payload: RecipeWritePayload,
): Promise<Recipe> {
  const { data, error } = await db
    .from("recipes")
    .insert({ ...payload, household_id: householdId, created_by: userId, source_type: "manual" })
    .select()
    .single();
  if (error) throw error;
  return data as Recipe;
}

export async function updateRecipe(
  db: SupabaseClient,
  id: string,
  payload: RecipeWritePayload,
): Promise<Recipe> {
  const { data, error } = await db.from("recipes").update(payload).eq("id", id).select().single();
  if (error) throw error;
  return data as Recipe;
}

export async function deleteRecipe(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("recipes").delete().eq("id", id);
  if (error) throw error;
}

export async function upsertMyRecipeMeta(
  db: SupabaseClient,
  recipeId: string,
  userId: string,
  patch: Partial<Pick<RecipeUserMeta, "is_favorite" | "rating" | "personal_note">>,
): Promise<void> {
  const { error } = await db
    .from("recipe_user_meta")
    .upsert({ recipe_id: recipeId, user_id: userId, ...patch }, { onConflict: "recipe_id,user_id" });
  if (error) throw error;
}
