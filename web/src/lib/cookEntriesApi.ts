import type { SupabaseClient } from "@supabase/supabase-js";
import { statusForDate, type CookEntry } from "../../../lib/cookEntries";

export async function listCookEntriesInRange(
  db: SupabaseClient,
  fromDateISO: string,
  toDateISO: string,
): Promise<CookEntry[]> {
  const { data, error } = await db
    .from("cook_entries")
    .select("*")
    .gte("entry_date", fromDateISO)
    .lte("entry_date", toDateISO);
  if (error) throw error;
  return data as CookEntry[];
}

export interface CookEntryWithRecipeTitle extends CookEntry {
  recipe_title: string;
}

/** Full history for one recipe, newest first — backs the "cooked N times" card on its page. */
export async function listCookEntriesForRecipe(db: SupabaseClient, recipeId: string): Promise<CookEntry[]> {
  const { data, error } = await db
    .from("cook_entries")
    .select("*")
    .eq("recipe_id", recipeId)
    .order("entry_date", { ascending: false });
  if (error) throw error;
  return data as CookEntry[];
}

/** For the Calendar day panel, where each row needs the dish's name alongside the date. */
export async function listCookEntriesForDate(db: SupabaseClient, dateISO: string): Promise<CookEntryWithRecipeTitle[]> {
  const { data, error } = await db
    .from("cook_entries")
    .select("*, recipes(title)")
    .eq("entry_date", dateISO)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as (CookEntry & { recipes: { title: string } | null })[]).map((row) => ({
    ...row,
    recipe_title: row.recipes?.title ?? "(deleted recipe)",
  }));
}

export async function addCookEntry(
  db: SupabaseClient,
  householdId: string,
  userId: string,
  recipeId: string,
  dateISO: string,
): Promise<void> {
  const { error } = await db.from("cook_entries").insert({
    household_id: householdId,
    recipe_id: recipeId,
    entry_date: dateISO,
    status: statusForDate(dateISO),
    created_by: userId,
  });
  if (error) throw error;
}

export async function markCookEntryCooked(db: SupabaseClient, entryId: string): Promise<void> {
  const { error } = await db.from("cook_entries").update({ status: "cooked" }).eq("id", entryId);
  if (error) throw error;
}

export async function deleteCookEntry(db: SupabaseClient, entryId: string): Promise<void> {
  const { error } = await db.from("cook_entries").delete().eq("id", entryId);
  if (error) throw error;
}
