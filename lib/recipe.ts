// Shared recipe domain types and pure helpers. No imports, no side effects, so this file is
// safe to import from both /web (browser bundle) and /api (server).

export interface Ingredient {
  id: string;
  qty: number | null;
  unit: string | null;
  item: string;
  note: string | null;
  /** Grocery-list aisle. Set during grocery list generation (phase 4), not at recipe entry. */
  store_section: string | null;
}

export interface RecipeStep {
  n: number;
  text: string;
  /** Cooking-mode timer (phase 5). Not collected at recipe entry. */
  timer_seconds: number | null;
  /** Ingredients shown alongside this step (phase 5). Not collected at recipe entry. */
  ingredient_ids: string[];
}

export type RecipeSourceType = "manual" | "pdf" | "assistant" | "url";

export interface RecipeSourceRef {
  book_title?: string;
  page?: number;
  url?: string;
}

export interface Recipe {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  cuisine: string | null;
  tags: string[];
  ingredients: Ingredient[];
  steps: RecipeStep[];
  /** Generated column: coalesce(prep_minutes, 0) + coalesce(cook_minutes, 0). */
  total_minutes: number;
  source_type: RecipeSourceType;
  source_ref: RecipeSourceRef | null;
  image_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeUserMeta {
  recipe_id: string;
  user_id: string;
  is_favorite: boolean;
  rating: number | null;
  personal_note: string | null;
  updated_at: string;
}

/** Fields the Add/Edit form collects and writes. Everything else is server- or phase-assigned. */
export type RecipeInput = Pick<
  Recipe,
  "title" | "description" | "servings" | "prep_minutes" | "cook_minutes" | "cuisine" | "tags"
> & {
  ingredients: Pick<Ingredient, "qty" | "unit" | "item" | "note">[];
  steps: Pick<RecipeStep, "text">[];
};

/**
 * Scales ingredient quantities from one serving count to another. Ingredients without a
 * numeric quantity (e.g. "salt to taste") pass through unchanged.
 */
export function scaleIngredients<T extends { qty: number | null }>(
  ingredients: T[],
  fromServings: number,
  toServings: number,
): T[] {
  if (fromServings <= 0 || toServings <= 0 || fromServings === toServings) return ingredients;
  const factor = toServings / fromServings;
  return ingredients.map((ing) => (ing.qty == null ? ing : { ...ing, qty: roundQty(ing.qty * factor) }));
}

/** Rounds to a sane number of decimals so scaling doesn't produce e.g. 0.6666666. */
function roundQty(qty: number): number {
  return Math.round(qty * 100) / 100;
}

// Drop apostrophes/backslashes (so "o'brien" stays one word) before splitting on anything
// else non-alphanumeric (so tsquery operator characters like & : ! can't leak into the query).
const TSQUERY_DROP = /['\\]/g;
const TSQUERY_SPLIT = /[^\p{L}\p{N}]+/u;

/**
 * Builds a prefix-matching tsquery from free-typed search text, for use with the `search`
 * column (a `simple`-config tsvector) via `.filter("search", "fts(simple)", ...)`. Each word
 * becomes a prefix match, ANDed together, so "choc cak" matches "Chocolate cake".
 */
export function buildSearchTsQuery(text: string): string | null {
  const words = text
    .replace(TSQUERY_DROP, "")
    .split(TSQUERY_SPLIT)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => `${w}:*`).join(" & ");
}
