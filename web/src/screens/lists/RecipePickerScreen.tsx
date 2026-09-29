import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scaleIngredients } from "../../../../lib/recipe";
import { mergeIngredients, type MergeInput } from "../../../../lib/grocery";
import { useBackButton, useMainButton } from "../../hooks/useTelegramButtons";
import { createGroceryList } from "../../lib/groceryApi";
import { listRecipes, type RecipeWithMeta } from "../../lib/recipesApi";

interface Selection {
  recipe: RecipeWithMeta;
  servings: number;
}

const DEFAULT_LIST_NAME = () =>
  `Grocery list – ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

export function RecipePickerScreen({
  db,
  householdId,
  myUserId,
  onCreated,
  onCancel,
}: {
  db: SupabaseClient;
  householdId: string;
  myUserId: string;
  onCreated: (listId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(DEFAULT_LIST_NAME);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<RecipeWithMeta[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, Selection>>(new Map());

  const load = useCallback(
    async (targetPage: number, replace: boolean) => {
      setLoading(true);
      try {
        const { rows: newRows, hasMore: more } = await listRecipes(
          db,
          { search, cuisine: null, tag: null, favorites: "any", maxMinutes: null, sort: "newest" },
          myUserId,
          null,
          targetPage,
        );
        setRows((prev) => (replace ? newRows : [...prev, ...newRows]));
        setHasMore(more);
        setPage(targetPage);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load recipes.");
      } finally {
        setLoading(false);
      }
    },
    [db, search, myUserId],
  );

  useEffect(() => {
    const t = setTimeout(() => load(0, true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function toggle(recipe: RecipeWithMeta) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(recipe.id)) next.delete(recipe.id);
      else next.set(recipe.id, { recipe, servings: recipe.servings ?? 2 });
      return next;
    });
  }

  function setServings(recipeId: string, servings: number) {
    setSelected((prev) => {
      const next = new Map(prev);
      const entry = next.get(recipeId);
      if (entry) next.set(recipeId, { ...entry, servings: Math.max(1, servings) });
      return next;
    });
  }

  async function createList() {
    if (selected.size === 0) return;
    setCreating(true);
    setError(null);
    try {
      const inputs: MergeInput[] = [];
      for (const { recipe, servings } of selected.values()) {
        const scaled = recipe.servings
          ? scaleIngredients(recipe.ingredients, recipe.servings, servings)
          : recipe.ingredients;
        for (const ing of scaled) inputs.push({ item: ing.item, qty: ing.qty, unit: ing.unit, recipeId: recipe.id });
      }
      const merged = mergeIngredients(inputs);
      const list = await createGroceryList(db, householdId, myUserId, name.trim() || DEFAULT_LIST_NAME(), merged);
      onCreated(list.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the list.");
      setCreating(false);
    }
  }

  useMainButton(creating ? "Creating…" : `Create list (${selected.size})`, createList, selected.size > 0);
  useBackButton(onCancel);

  return (
    <div className="screen">
      <h1>New grocery list</h1>
      {error && <p className="error">{error}</p>}

      <label className="field">
        <span>List name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <input
        className="search-input"
        placeholder="Search recipes to add…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading && rows.length === 0 && <p className="muted">Loading…</p>}

      <ul className="picker-list">
        {rows.map((r) => {
          const sel = selected.get(r.id);
          return (
            <li key={r.id} className="picker-row">
              <label className="picker-check">
                <input type="checkbox" checked={!!sel} onChange={() => toggle(r)} />
                <span>{r.title}</span>
              </label>
              {sel && (
                <div className="servings-stepper compact">
                  <button type="button" onClick={() => setServings(r.id, sel.servings - 1)}>
                    −
                  </button>
                  <span>{sel.servings} servings</span>
                  <button type="button" onClick={() => setServings(r.id, sel.servings + 1)}>
                    +
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button className="button secondary" onClick={() => load(page + 1, false)}>
          Load more
        </button>
      )}
    </div>
  );
}
