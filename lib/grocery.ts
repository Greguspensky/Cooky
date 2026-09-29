// Shared grocery-list domain types and pure helpers. No imports, no side effects, so this file
// is safe to import from both /web (browser bundle) and /api (server).

export type StoreSection = "produce" | "dairy" | "meat_fish" | "pantry" | "frozen" | "bakery" | "other";

/** Matches the household's usual supermarket layout. */
export const STORE_SECTION_ORDER: StoreSection[] = [
  "produce",
  "dairy",
  "meat_fish",
  "pantry",
  "frozen",
  "bakery",
  "other",
];

export const STORE_SECTION_LABELS: Record<StoreSection, string> = {
  produce: "Produce",
  dairy: "Dairy",
  meat_fish: "Meat & fish",
  pantry: "Pantry",
  frozen: "Frozen",
  bakery: "Bakery",
  other: "Other",
};

export interface GroceryList {
  id: string;
  household_id: string;
  name: string;
  status: "active" | "done";
  created_by: string | null;
  created_at: string;
}

export interface GroceryItem {
  id: string;
  list_id: string;
  item: string;
  qty: number | null;
  unit: string | null;
  store_section: StoreSection;
  checked: boolean;
  checked_by: string | null;
  added_by: string | null;
  source_recipe_ids: string[];
  created_at: string;
}

// Ordered so a more specific match (e.g. "pepper" as a vegetable) wins over a broader one
// (e.g. "pepper" as a pantry spice). English-only for now: recipes keep their original
// language, so a non-English ingredient name falls through to "other" and needs a manual fix.
const SECTION_KEYWORDS: [StoreSection, string[]][] = [
  [
    "produce",
    [
      "tomato", "onion", "garlic", "potato", "carrot", "bell pepper", "lettuce", "spinach",
      "cucumber", "zucchini", "apple", "banana", "lemon", "lime", "parsley", "cilantro", "basil",
      "mushroom", "broccoli", "cabbage", "avocado", "ginger", "celery", "scallion", "kale",
    ],
  ],
  ["dairy", ["milk", "cheese", "yogurt", "butter", "cream", "egg", "mozzarella", "parmesan", "ricotta"]],
  [
    "meat_fish",
    ["chicken", "beef", "pork", "lamb", "bacon", "sausage", "fish", "salmon", "shrimp", "tuna", "turkey", "mince"],
  ],
  ["bakery", ["bread", "baguette", "bun", "roll", "tortilla", "pita", "bagel"]],
  ["frozen", ["frozen", "ice cream"]],
  [
    "pantry",
    [
      "flour", "sugar", "salt", "pepper", "oil", "rice", "pasta", "beans", "lentil", "vinegar",
      "stock", "broth", "spice", "cumin", "paprika", "cinnamon", "baking powder", "baking soda",
      "yeast", "honey", "syrup", "tomato paste", "chocolate", "cocoa", "nuts", "noodle",
    ],
  ],
];

/** Best-effort guess at an item's aisle. Wrong guesses are a one-tap fix in the UI, not a bug. */
export function guessStoreSection(itemName: string): StoreSection {
  const name = itemName.toLowerCase();
  for (const [section, keywords] of SECTION_KEYWORDS) {
    if (keywords.some((k) => name.includes(k))) return section;
  }
  return "other";
}

export interface MergeInput {
  item: string;
  qty: number | null;
  unit: string | null;
  recipeId: string;
}

export interface MergedItem {
  item: string;
  qty: number | null;
  unit: string | null;
  store_section: StoreSection;
  source_recipe_ids: string[];
}

/**
 * Combines ingredients from one or more recipes into shopping-list lines. Two ingredients merge
 * only when their name and unit match exactly (case-insensitive) — no unit conversion. Anything
 * that doesn't line up exactly stays as its own line; the plan's LLM-assisted fuzzy merge
 * ("2 cloves garlic" + "1 tsp minced garlic") arrives alongside the assistant's Claude
 * integration rather than duplicating that setup here.
 */
export function mergeIngredients(inputs: MergeInput[]): MergedItem[] {
  const groups = new Map<string, MergedItem>();

  for (const input of inputs) {
    const item = input.item.trim();
    if (!item) continue;
    const unit = input.unit?.trim() || null;
    const key = `${item.toLowerCase()}\u0000${(unit ?? "").toLowerCase()}`;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        item,
        qty: input.qty,
        unit,
        store_section: guessStoreSection(item),
        source_recipe_ids: [input.recipeId],
      });
      continue;
    }
    // Both sides need a quantity to sum meaningfully; "salt" + "salt to taste" just stays
    // quantity-less rather than silently dropping one recipe's amount.
    existing.qty = existing.qty != null && input.qty != null ? roundQty(existing.qty + input.qty) : null;
    if (!existing.source_recipe_ids.includes(input.recipeId)) existing.source_recipe_ids.push(input.recipeId);
  }

  return [...groups.values()];
}

function roundQty(qty: number): number {
  return Math.round(qty * 100) / 100;
}
