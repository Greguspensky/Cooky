import type { SupabaseClient } from "@supabase/supabase-js";
import {
  STORE_SECTION_ORDER,
  type GroceryItem,
  type GroceryList,
  type MergedItem,
  type StoreSection,
} from "../../../lib/grocery";
import { getAccessToken } from "../api";

export async function listGroceryLists(db: SupabaseClient): Promise<GroceryList[]> {
  const { data, error } = await db.from("grocery_lists").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data as GroceryList[];
}

export async function fetchGroceryList(
  db: SupabaseClient,
  id: string,
): Promise<{ list: GroceryList; items: GroceryItem[] }> {
  const [list, items] = await Promise.all([
    db.from("grocery_lists").select("*").eq("id", id).single(),
    db.from("grocery_items").select("*").eq("list_id", id),
  ]);
  if (list.error) throw list.error;
  if (items.error) throw items.error;
  return { list: list.data as GroceryList, items: sortItems(items.data as GroceryItem[]) };
}

/** Orders by store aisle (produce → other), then alphabetically within each aisle. */
export function sortItems(items: GroceryItem[]): GroceryItem[] {
  return [...items].sort((a, b) => {
    const bySection = STORE_SECTION_ORDER.indexOf(a.store_section) - STORE_SECTION_ORDER.indexOf(b.store_section);
    return bySection !== 0 ? bySection : a.item.localeCompare(b.item);
  });
}

export async function createGroceryList(
  db: SupabaseClient,
  householdId: string,
  userId: string,
  name: string,
  items: MergedItem[],
): Promise<GroceryList> {
  const list = await db
    .from("grocery_lists")
    .insert({ household_id: householdId, name, created_by: userId })
    .select()
    .single();
  if (list.error) throw list.error;

  if (items.length > 0) {
    const { error } = await db.from("grocery_items").insert(
      items.map((i) => ({
        list_id: list.data.id,
        item: i.item,
        qty: i.qty,
        unit: i.unit,
        store_section: i.store_section,
        added_by: userId,
        source_recipe_ids: i.source_recipe_ids,
      })),
    );
    if (error) throw error;
  }

  return list.data as GroceryList;
}

/** Lists currently shoppable ("active") lists, for "add this recipe to an existing list" pickers. */
export async function listActiveGroceryLists(db: SupabaseClient): Promise<GroceryList[]> {
  const { data, error } = await db
    .from("grocery_lists")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as GroceryList[];
}

/** Appends merged ingredient lines to an existing list. Doesn't merge with items already on the
 * list (same as adding an item by hand) — just the recipe's own ingredients get merged together. */
export async function addItemsToList(
  db: SupabaseClient,
  listId: string,
  userId: string,
  items: MergedItem[],
): Promise<void> {
  if (items.length === 0) return;
  const { error } = await db.from("grocery_items").insert(
    items.map((i) => ({
      list_id: listId,
      item: i.item,
      qty: i.qty,
      unit: i.unit,
      store_section: i.store_section,
      added_by: userId,
      source_recipe_ids: i.source_recipe_ids,
    })),
  );
  if (error) throw error;
}

export async function addGroceryItem(
  db: SupabaseClient,
  listId: string,
  userId: string,
  item: { item: string; qty: number | null; unit: string | null; store_section: StoreSection },
): Promise<void> {
  const { error } = await db
    .from("grocery_items")
    .insert({ list_id: listId, added_by: userId, source_recipe_ids: [], ...item });
  if (error) throw error;
}

export async function setItemChecked(
  db: SupabaseClient,
  itemId: string,
  checked: boolean,
  userId: string,
): Promise<void> {
  const { error } = await db
    .from("grocery_items")
    .update({ checked, checked_by: checked ? userId : null })
    .eq("id", itemId);
  if (error) throw error;
}

export async function setItemSection(db: SupabaseClient, itemId: string, section: StoreSection): Promise<void> {
  const { error } = await db.from("grocery_items").update({ store_section: section }).eq("id", itemId);
  if (error) throw error;
}

export async function deleteGroceryItem(db: SupabaseClient, itemId: string): Promise<void> {
  const { error } = await db.from("grocery_items").delete().eq("id", itemId);
  if (error) throw error;
}

export async function setListStatus(db: SupabaseClient, listId: string, status: "active" | "done"): Promise<void> {
  const { error } = await db.from("grocery_lists").update({ status }).eq("id", listId);
  if (error) throw error;
}

/** Posts the list to both of your Telegram chats. Goes through /api since it needs the bot token. */
export async function sendListToChat(listId: string): Promise<{ sent: number; of: number }> {
  const token = await getAccessToken();
  const response = await fetch("/api/lists/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ listId }),
  });
  if (!response.ok) throw new Error(`Couldn't send the list (${response.status}).`);
  return response.json();
}
