import { adminDb } from "../db.js";
import { statusForDate, toLocalISODate } from "../cookEntries.js";
import { guessStoreSection, mergeIngredients, type MergeInput } from "../grocery.js";
import { scaleIngredients, type Ingredient, type Recipe, type RecipeStep } from "../recipe.js";
import type { PendingAction } from "./pendingActions.js";

/** Applies a confirmed write tool call and returns a small result object for the reply message. */
export async function applyWriteTool(action: PendingAction): Promise<Record<string, unknown>> {
  const { input, householdId } = action.payload;
  switch (action.action_type) {
    case "save_recipe":
      return saveRecipe(input, householdId, action.user_id);
    case "create_grocery_list":
      return createGroceryList(input, householdId, action.user_id);
    case "add_to_grocery_list":
      return addToGroceryList(input, householdId, action.user_id);
    case "schedule_dish":
      return scheduleDish(input, householdId, action.user_id);
    case "propose_preference_update":
      return updatePreferences(input, action.user_id);
    default:
      throw new Error(`Unknown write tool: ${action.action_type}`);
  }
}

async function scheduleDish(input: Record<string, unknown>, householdId: string, userId: string) {
  const date = typeof input.date === "string" && input.date ? input.date : toLocalISODate(new Date());
  const db = adminDb();

  const recipe = await db.from("recipes").select("title").eq("id", input.recipe_id).eq("household_id", householdId).maybeSingle();
  if (recipe.error) throw recipe.error;
  if (!recipe.data) throw new Error("That recipe wasn't found.");

  const { error } = await db.from("cook_entries").insert({
    household_id: householdId,
    recipe_id: input.recipe_id,
    entry_date: date,
    status: statusForDate(date),
    created_by: userId,
  });
  if (error) throw error;

  return { title: recipe.data.title, date, status: statusForDate(date) };
}

async function saveRecipe(input: Record<string, unknown>, householdId: string, userId: string) {
  const rawIngredients = (input.ingredients as { qty?: number; unit?: string; item: string; note?: string }[]) ?? [];
  const rawSteps = (input.steps as { text: string }[]) ?? [];

  const ingredients: Ingredient[] = rawIngredients.map((i) => ({
    id: crypto.randomUUID(),
    qty: i.qty ?? null,
    unit: i.unit ?? null,
    item: i.item,
    note: i.note ?? null,
    store_section: null,
  }));
  const steps: RecipeStep[] = rawSteps.map((s, idx) => ({
    n: idx + 1,
    text: s.text,
    timer_seconds: null,
    ingredient_ids: [],
  }));

  const { data, error } = await adminDb()
    .from("recipes")
    .insert({
      household_id: householdId,
      created_by: userId,
      title: input.title,
      description: input.description ?? null,
      servings: input.servings ?? null,
      prep_minutes: input.prep_minutes ?? null,
      cook_minutes: input.cook_minutes ?? null,
      cuisine: input.cuisine ?? null,
      tags: input.tags ?? [],
      ingredients,
      steps,
      source_type: "assistant",
    })
    .select("id, title")
    .single();
  if (error) throw error;
  return { recipeId: data.id, title: data.title };
}

async function createGroceryList(input: Record<string, unknown>, householdId: string, userId: string) {
  const requested = (input.recipes as { recipe_id: string; servings?: number }[]) ?? [];
  const db = adminDb();

  const { data: recipes, error: recipesError } = await db
    .from("recipes")
    .select("id, title, servings, ingredients")
    .eq("household_id", householdId)
    .in("id", requested.map((r) => r.recipe_id));
  if (recipesError) throw recipesError;

  const mergeInputs: MergeInput[] = [];
  for (const want of requested) {
    const recipe = recipes.find((r) => r.id === want.recipe_id) as (Recipe & { ingredients: Ingredient[] }) | undefined;
    if (!recipe) continue;
    const ingredients =
      want.servings && recipe.servings ? scaleIngredients(recipe.ingredients, recipe.servings, want.servings) : recipe.ingredients;
    for (const ing of ingredients) {
      mergeInputs.push({ item: ing.item, qty: ing.qty, unit: ing.unit, recipeId: recipe.id });
    }
  }
  const merged = mergeIngredients(mergeInputs);

  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : "From the assistant";
  const { data: list, error: listError } = await db
    .from("grocery_lists")
    .insert({ household_id: householdId, name, created_by: userId })
    .select("id, name")
    .single();
  if (listError) throw listError;

  if (merged.length > 0) {
    const { error } = await db.from("grocery_items").insert(
      merged.map((m) => ({
        list_id: list.id,
        item: m.item,
        qty: m.qty,
        unit: m.unit,
        store_section: m.store_section,
        added_by: userId,
        source_recipe_ids: m.source_recipe_ids,
      })),
    );
    if (error) throw error;
  }

  return { listId: list.id, name: list.name, itemCount: merged.length };
}

async function addToGroceryList(input: Record<string, unknown>, householdId: string, userId: string) {
  const items = (input.items as { item: string; qty?: number; unit?: string }[]) ?? [];
  const db = adminDb();

  let listId = typeof input.list_id === "string" ? input.list_id : undefined;
  let listName: string;
  if (listId) {
    const { data } = await db.from("grocery_lists").select("id, name").eq("id", listId).eq("household_id", householdId).maybeSingle();
    if (!data) listId = undefined;
    listName = data?.name ?? "";
  }
  if (!listId) {
    const { data: existing } = await db
      .from("grocery_lists")
      .select("id, name")
      .eq("household_id", householdId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      listId = existing.id;
      listName = existing.name;
    } else {
      const { data: created, error } = await db
        .from("grocery_lists")
        .insert({ household_id: householdId, name: "From the assistant", created_by: userId })
        .select("id, name")
        .single();
      if (error) throw error;
      listId = created.id;
      listName = created.name;
    }
  }

  const { error } = await db.from("grocery_items").insert(
    items.map((i) => ({
      list_id: listId,
      item: i.item,
      qty: i.qty ?? null,
      unit: i.unit ?? null,
      store_section: guessStoreSection(i.item),
      added_by: userId,
      source_recipe_ids: [],
    })),
  );
  if (error) throw error;

  return { listId, name: listName!, addedCount: items.length };
}

async function updatePreferences(input: Record<string, unknown>, userId: string) {
  const db = adminDb();
  const { data: existing } = await db
    .from("taste_preferences")
    .select("likes, dislikes, diet_notes")
    .eq("user_id", userId)
    .maybeSingle();

  const likes = mergeUnique(existing?.likes ?? [], input.add_likes as string[] | undefined);
  const dislikes = mergeUnique(existing?.dislikes ?? [], input.add_dislikes as string[] | undefined);
  const dietNotes = typeof input.diet_notes === "string" ? input.diet_notes : (existing?.diet_notes ?? null);

  const { error } = await db
    .from("taste_preferences")
    .upsert({ user_id: userId, likes, dislikes, diet_notes: dietNotes }, { onConflict: "user_id" });
  if (error) throw error;

  return { likes, dislikes, diet_notes: dietNotes };
}

function mergeUnique(existing: string[], additions: string[] | undefined): string[] {
  if (!additions?.length) return existing;
  const seen = new Set(existing.map((v) => v.toLowerCase()));
  const merged = [...existing];
  for (const value of additions) {
    if (!seen.has(value.toLowerCase())) {
      merged.push(value);
      seen.add(value.toLowerCase());
    }
  }
  return merged;
}
