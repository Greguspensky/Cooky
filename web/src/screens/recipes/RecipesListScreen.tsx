import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Member } from "../../hooks/useHouseholdMembers";
import { useMainButton } from "../../hooks/useTelegramButtons";
import { getSignedPhotoUrls } from "../../lib/recipePhotos";
import {
  listCuisinesAndTags,
  listRecipes,
  type FavoritesFilter,
  type RecipeFilters,
  type RecipeSort,
  type RecipeWithMeta,
} from "../../lib/recipesApi";
import { RecipeCard } from "./RecipeCard";

export function RecipesListScreen({
  db,
  members,
  myUserId,
  onOpenRecipe,
  onAddRecipe,
}: {
  db: SupabaseClient;
  members: Member[];
  myUserId: string;
  onOpenRecipe: (id: string) => void;
  onAddRecipe: () => void;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<FavoritesFilter>("any");
  const [maxMinutes, setMaxMinutes] = useState<number | null>(null);
  const [sort, setSort] = useState<RecipeSort>("newest");

  const [cuisines, setCuisines] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  const [rows, setRows] = useState<RecipeWithMeta[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const partner = members.find((m) => m.id !== myUserId) ?? null;

  // Debounce free-text search so every keystroke doesn't fire a query.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    listCuisinesAndTags(db)
      .then(({ cuisines, tags }) => {
        setCuisines(cuisines);
        setTags(tags);
      })
      .catch(() => {
        // Filter dropdowns just stay empty; the list itself still works.
      });
  }, [db]);

  const filters: RecipeFilters = { search, cuisine, tag, favorites, maxMinutes, sort };
  const filtersKey = JSON.stringify(filters);

  const load = useCallback(
    async (targetPage: number, replace: boolean) => {
      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const { rows: newRows, hasMore: more } = await listRecipes(
          db,
          filters,
          myUserId,
          partner?.id ?? null,
          targetPage,
        );
        setRows((prev) => (replace ? newRows : [...prev, ...newRows]));
        setHasMore(more);
        setPage(targetPage);

        const paths = newRows.map((r) => r.image_path).filter((p): p is string => !!p);
        if (paths.length > 0) {
          const urls = await getSignedPhotoUrls(db, paths);
          setImageUrls((prev) => ({ ...prev, ...urls }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load recipes.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    // filtersKey covers `filters` by value; partner?.id and myUserId rarely change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, filtersKey, myUserId, partner?.id],
  );

  useEffect(() => {
    load(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useMainButton("+ Add recipe", onAddRecipe);

  return (
    <div className="screen">
      <h1>Recipes</h1>

      <input
        className="search-input"
        placeholder="Search recipes…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />

      <div className="filter-row">
        <select value={cuisine ?? ""} onChange={(e) => setCuisine(e.target.value || null)}>
          <option value="">Any cuisine</option>
          {cuisines.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={tag ?? ""} onChange={(e) => setTag(e.target.value || null)}>
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={maxMinutes ?? ""}
          onChange={(e) => setMaxMinutes(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Any time</option>
          <option value="15">Under 15 min</option>
          <option value="30">Under 30 min</option>
          <option value="60">Under 60 min</option>
        </select>
        <select value={favorites} onChange={(e) => setFavorites(e.target.value as FavoritesFilter)}>
          <option value="any">Any favorite</option>
          <option value="mine">My favorites</option>
          {partner && <option value="partner">{partner.display_name.split(" ")[0]}'s favorites</option>}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as RecipeSort)}>
          <option value="newest">Newest</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <div className="center">
          <div className="emoji">🍽️</div>
          <h2>No recipes yet</h2>
          <p className="muted">Tap “+ Add recipe” below to add your first one.</p>
        </div>
      )}

      <div className="recipe-grid">
        {rows.map((r) => (
          <RecipeCard
            key={r.id}
            recipe={r}
            members={members}
            imageUrl={r.image_path ? imageUrls[r.image_path] : undefined}
            onClick={() => onOpenRecipe(r.id)}
          />
        ))}
      </div>

      {hasMore && (
        <button className="button secondary" disabled={loadingMore} onClick={() => load(page + 1, false)}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
