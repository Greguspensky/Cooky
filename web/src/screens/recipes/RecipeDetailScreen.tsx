import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scaleIngredients } from "../../../../lib/recipe";
import { mergeIngredients, type GroceryList, type MergeInput } from "../../../../lib/grocery";
import { toLocalISODate, type CookEntry } from "../../../../lib/cookEntries";
import type { Member } from "../../hooks/useHouseholdMembers";
import { useBackButton, useMainButton } from "../../hooks/useTelegramButtons";
import { addCookEntry, listCookEntriesForRecipe } from "../../lib/cookEntriesApi";
import {
  addItemsToList,
  createGroceryList,
  listActiveGroceryLists,
} from "../../lib/groceryApi";
import { deleteRecipePhoto, getSignedPhotoUrl, uploadRecipePhoto } from "../../lib/recipePhotos";
import { deleteRecipe, fetchRecipe, upsertMyRecipeMeta, type RecipeWithMeta } from "../../lib/recipesApi";
import { haptic } from "../../telegram";
import { CookingModeScreen } from "./CookingModeScreen";

export function RecipeDetailScreen({
  db,
  recipeId,
  householdId,
  myUserId,
  members,
  onBack,
  onEdit,
  onDeleted,
  onAskAssistant,
}: {
  db: SupabaseClient;
  recipeId: string;
  householdId: string;
  myUserId: string;
  members: Member[];
  onBack: () => void;
  onEdit: (id: string) => void;
  onDeleted: () => void;
  onAskAssistant: (prefill: string) => void;
}) {
  const [recipe, setRecipe] = useState<RecipeWithMeta | null>(null);
  const [cooking, setCooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [groceryPanelOpen, setGroceryPanelOpen] = useState(false);
  const [activeLists, setActiveLists] = useState<GroceryList[] | null>(null);
  const [selectedListOption, setSelectedListOption] = useState("new");
  const [addingToGrocery, setAddingToGrocery] = useState(false);
  const [groceryMessage, setGroceryMessage] = useState<string | null>(null);

  const [cookHistory, setCookHistory] = useState<CookEntry[] | null>(null);
  const [schedulingDate, setSchedulingDate] = useState<string | null>(null);

  function reload() {
    fetchRecipe(db, recipeId)
      .then((r) => {
        setRecipe(r);
        setServings(r.servings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this recipe."));
  }

  function reloadHistory() {
    listCookEntriesForRecipe(db, recipeId)
      .then(setCookHistory)
      .catch(() => setCookHistory([]));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reloadHistory, [db, recipeId]);

  async function logCooked(dateISO: string) {
    try {
      await addCookEntry(db, householdId, myUserId, recipeId, dateISO);
      haptic(dateISO <= toLocalISODate(new Date()) ? "success" : "tap");
      setSchedulingDate(null);
      reloadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log that.");
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [db, recipeId]);

  useEffect(() => {
    if (recipe?.image_path) getSignedPhotoUrl(db, recipe.image_path).then(setImageUrl);
    else setImageUrl(null);
  }, [db, recipe?.image_path]);

  // Cooking mode takes over the recipe's own BackButton/MainButton while it's open.
  useBackButton(onBack, !cooking);
  useMainButton("Edit recipe", () => onEdit(recipeId), !!recipe && !cooking);

  const myMeta = recipe?.recipe_user_meta.find((m) => m.user_id === myUserId);
  const partner = members.find((m) => m.id !== myUserId) ?? null;
  const partnerMeta = partner ? recipe?.recipe_user_meta.find((m) => m.user_id === partner.id) : undefined;

  const scaledIngredients = useMemo(() => {
    if (!recipe) return [];
    if (!recipe.servings || !servings) return recipe.ingredients;
    return scaleIngredients(recipe.ingredients, recipe.servings, servings);
  }, [recipe, servings]);

  async function toggleFavorite() {
    if (!recipe) return;
    haptic("tap");
    await upsertMyRecipeMeta(db, recipe.id, myUserId, { is_favorite: !myMeta?.is_favorite });
    reload();
  }

  async function setRating(rating: number) {
    if (!recipe) return;
    haptic("tap");
    await upsertMyRecipeMeta(db, recipe.id, myUserId, { rating: rating === myMeta?.rating ? null : rating });
    reload();
  }

  async function saveNote(personalNote: string) {
    if (!recipe) return;
    try {
      await upsertMyRecipeMeta(db, recipe.id, myUserId, { personal_note: personalNote || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your note.");
    }
  }

  async function onPickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !recipe) return;
    setUploading(true);
    setError(null);
    try {
      const previousPath = recipe.image_path;
      const path = await uploadRecipePhoto(db, householdId, recipe.id, file);
      const { error: updateError } = await db.from("recipes").update({ image_path: path }).eq("id", recipe.id);
      if (updateError) throw updateError;
      if (previousPath) await deleteRecipePhoto(db, previousPath);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that photo.");
    } finally {
      setUploading(false);
    }
  }

  async function openGroceryPanel() {
    setGroceryPanelOpen(true);
    setGroceryMessage(null);
    if (activeLists === null) {
      try {
        setActiveLists(await listActiveGroceryLists(db));
      } catch {
        setActiveLists([]); // the "new list" option still works even if this fails
      }
    }
  }

  async function addToGroceryList() {
    if (!recipe) return;
    setAddingToGrocery(true);
    setError(null);
    try {
      const mergeInputs: MergeInput[] = scaledIngredients.map((ing) => ({
        item: ing.item,
        qty: ing.qty,
        unit: ing.unit,
        recipeId: recipe.id,
      }));
      const merged = mergeIngredients(mergeInputs);

      if (selectedListOption === "new") {
        const list = await createGroceryList(db, householdId, myUserId, recipe.title, merged);
        setGroceryMessage(`Added to new list "${list.name}".`);
      } else {
        await addItemsToList(db, selectedListOption, myUserId, merged);
        const list = activeLists?.find((l) => l.id === selectedListOption);
        setGroceryMessage(`Added to "${list?.name ?? "your list"}".`);
      }
      haptic("success");
      setGroceryPanelOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add this to a grocery list.");
    } finally {
      setAddingToGrocery(false);
    }
  }

  async function onDelete() {
    if (!recipe) return;
    if (!window.confirm(`Delete "${recipe.title}"? This can't be undone.`)) return;
    await deleteRecipe(db, recipe.id);
    onDeleted();
  }

  if (error && !recipe) return <p className="error screen">{error}</p>;
  if (!recipe) return <p className="muted screen">Loading…</p>;

  if (cooking) {
    return (
      <CookingModeScreen
        recipe={recipe}
        scaledIngredients={scaledIngredients}
        onExit={() => setCooking(false)}
        onAskAssistant={(prefill) => {
          setCooking(false);
          onAskAssistant(prefill);
        }}
      />
    );
  }

  return (
    <div className="screen recipe-detail">
      <button
        type="button"
        className="recipe-photo"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {imageUrl ? <img src={imageUrl} alt="" /> : <span className="recipe-photo-placeholder">📷 Add a photo</span>}
        {uploading && <span className="recipe-photo-overlay">Uploading…</span>}
      </button>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />

      <h1>{recipe.title}</h1>
      {recipe.description && <p className="muted">{recipe.description}</p>}
      {(recipe.total_minutes > 0 || recipe.cuisine) && (
        <p className="muted">
          {[recipe.total_minutes > 0 ? `${recipe.total_minutes} min` : null, recipe.cuisine]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {recipe.tags.length > 0 && (
        <div className="chips">
          {recipe.tags.map((t) => (
            <span key={t} className="chip-static">
              {t}
            </span>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {recipe.steps.length > 0 && (
        <button className="button start-cooking" onClick={() => setCooking(true)}>
          ▶ Start cooking
        </button>
      )}

      <section className="card">
        <div className="row-between">
          <button className={myMeta?.is_favorite ? "heart active" : "heart"} onClick={toggleFavorite}>
            {myMeta?.is_favorite ? "♥ Favorited" : "♡ Favorite"}
          </button>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={n <= (myMeta?.rating ?? 0) ? "star filled" : "star"}
                onClick={() => setRating(n)}
                aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <textarea
          className="note-input"
          placeholder="Your notes on this recipe…"
          defaultValue={myMeta?.personal_note ?? ""}
          onBlur={(e) => saveNote(e.target.value)}
        />
        {partner && (
          <p className="muted partner-rating">
            {partner.display_name.split(" ")[0]}: {partnerMeta?.is_favorite ? "♥" : "♡"}
            {partnerMeta?.rating ? ` ${"★".repeat(partnerMeta.rating)}` : " no rating yet"}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Cooking history</h2>
        {cookHistory === null && <p className="muted">Loading…</p>}
        {cookHistory && (
          <>
            <p className="muted">
              Cooked {cookHistory.filter((e) => e.status === "cooked").length} time
              {cookHistory.filter((e) => e.status === "cooked").length === 1 ? "" : "s"}
              {cookHistory.some((e) => e.status === "cooked") &&
                ` — last on ${cookHistory.find((e) => e.status === "cooked")!.entry_date}`}
            </p>
            {cookHistory.length > 0 && (
              <ul className="history-dates">
                {cookHistory.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    {e.entry_date}
                    {e.status === "planned" && <span className="status-chip">Planned</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="history-actions">
          {schedulingDate === null ? (
            <button className="button secondary compact" onClick={() => setSchedulingDate(toLocalISODate(new Date()))}>
              Log a date
            </button>
          ) : (
            <span className="schedule-picker">
              <input type="date" value={schedulingDate} onChange={(e) => setSchedulingDate(e.target.value)} />
              <button className="button secondary compact" onClick={() => logCooked(schedulingDate)}>
                Add
              </button>
            </span>
          )}
        </div>
      </section>

      {recipe.servings != null && servings != null && (
        <section className="card">
          <div className="row-between">
            <h2>Servings</h2>
            <div className="servings-stepper">
              <button onClick={() => setServings((s) => Math.max(1, (s ?? 1) - 1))} aria-label="Fewer servings">
                −
              </button>
              <span>{servings}</span>
              <button onClick={() => setServings((s) => (s ?? 1) + 1)} aria-label="More servings">
                +
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Ingredients</h2>
        {scaledIngredients.length === 0 ? (
          <p className="muted">No ingredients listed.</p>
        ) : (
          <ul className="ingredient-list">
            {scaledIngredients.map((ing) => (
              <li key={ing.id}>
                {ing.qty != null && (
                  <strong>
                    {ing.qty}
                    {ing.unit ? ` ${ing.unit}` : ""}{" "}
                  </strong>
                )}
                {ing.item}
                {ing.note && <span className="muted"> ({ing.note})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Grocery list</h2>
          {!groceryPanelOpen && (
            <button className="button secondary compact" onClick={openGroceryPanel}>
              + Add to list
            </button>
          )}
        </div>
        {groceryMessage && !groceryPanelOpen && <p className="muted">{groceryMessage}</p>}
        {groceryPanelOpen && (
          <div className="grocery-add-panel">
            <label className="field">
              <span>Add to</span>
              <select value={selectedListOption} onChange={(e) => setSelectedListOption(e.target.value)}>
                <option value="new">New list: "{recipe.title}"</option>
                {activeLists?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            {servings != null && (
              <p className="muted">
                Using {servings} serving{servings === 1 ? "" : "s"} — change the servings above to adjust.
              </p>
            )}
            <div className="confirm-card-actions">
              <button className="button secondary compact" onClick={() => setGroceryPanelOpen(false)}>
                Cancel
              </button>
              <button className="button compact" disabled={addingToGrocery} onClick={addToGroceryList}>
                {addingToGrocery ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Steps</h2>
        {recipe.steps.length === 0 ? (
          <p className="muted">No steps listed.</p>
        ) : (
          <ol className="step-list">
            {recipe.steps.map((step) => (
              <li key={step.n}>{step.text}</li>
            ))}
          </ol>
        )}
      </section>

      <button className="button danger" onClick={onDelete}>
        Delete recipe
      </button>
    </div>
  );
}
