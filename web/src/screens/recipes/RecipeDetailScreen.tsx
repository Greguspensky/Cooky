import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scaleIngredients } from "../../../../lib/recipe";
import type { Member } from "../../hooks/useHouseholdMembers";
import { useBackButton, useMainButton } from "../../hooks/useTelegramButtons";
import { deleteRecipePhoto, getSignedPhotoUrl, uploadRecipePhoto } from "../../lib/recipePhotos";
import { deleteRecipe, fetchRecipe, upsertMyRecipeMeta, type RecipeWithMeta } from "../../lib/recipesApi";
import { haptic } from "../../telegram";

export function RecipeDetailScreen({
  db,
  recipeId,
  householdId,
  myUserId,
  members,
  onBack,
  onEdit,
  onDeleted,
}: {
  db: SupabaseClient;
  recipeId: string;
  householdId: string;
  myUserId: string;
  members: Member[];
  onBack: () => void;
  onEdit: (id: string) => void;
  onDeleted: () => void;
}) {
  const [recipe, setRecipe] = useState<RecipeWithMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reload() {
    fetchRecipe(db, recipeId)
      .then((r) => {
        setRecipe(r);
        setServings(r.servings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this recipe."));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [db, recipeId]);

  useEffect(() => {
    if (recipe?.image_path) getSignedPhotoUrl(db, recipe.image_path).then(setImageUrl);
    else setImageUrl(null);
  }, [db, recipe?.image_path]);

  useBackButton(onBack);
  useMainButton("Edit recipe", () => onEdit(recipeId), !!recipe);

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

  async function onDelete() {
    if (!recipe) return;
    if (!window.confirm(`Delete "${recipe.title}"? This can't be undone.`)) return;
    await deleteRecipe(db, recipe.id);
    onDeleted();
  }

  if (error && !recipe) return <p className="error screen">{error}</p>;
  if (!recipe) return <p className="muted screen">Loading…</p>;

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
