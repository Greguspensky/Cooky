import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ingredient, RecipeStep } from "../../../../lib/recipe";
import { useBackButton, useMainButton } from "../../hooks/useTelegramButtons";
import { createRecipe, fetchRecipe, updateRecipe, type RecipeWritePayload } from "../../lib/recipesApi";
import { TagInput } from "./TagInput";

interface IngredientRow {
  /** Assigned as soon as the row exists (not just on save), so steps can reference it while editing. */
  id: string;
  qty: string;
  unit: string;
  item: string;
  note: string;
}
interface StepRow {
  text: string;
  /** IngredientRow ids used in this step — cooking mode shows only these alongside the step. */
  ingredientIds: string[];
  /** Optional cooking-mode timer, in minutes. */
  timerMinutes: string;
}

function emptyIngredient(): IngredientRow {
  return { id: crypto.randomUUID(), qty: "", unit: "", item: "", note: "" };
}
function emptyStep(): StepRow {
  return { text: "", ingredientIds: [], timerMinutes: "" };
}

export function RecipeFormScreen({
  db,
  householdId,
  myUserId,
  recipeId,
  tagSuggestions,
  onSaved,
  onCancel,
}: {
  db: SupabaseClient;
  householdId: string;
  myUserId: string;
  recipeId?: string;
  tagSuggestions: string[];
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const isEditing = !!recipeId;
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [servings, setServings] = useState("");
  const [prepMinutes, setPrepMinutes] = useState("");
  const [cookMinutes, setCookMinutes] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([emptyIngredient()]);
  const [steps, setSteps] = useState<StepRow[]>([emptyStep()]);

  useEffect(() => {
    if (!recipeId) return;
    fetchRecipe(db, recipeId)
      .then((r) => {
        setTitle(r.title);
        setDescription(r.description ?? "");
        setServings(r.servings != null ? String(r.servings) : "");
        setPrepMinutes(r.prep_minutes != null ? String(r.prep_minutes) : "");
        setCookMinutes(r.cook_minutes != null ? String(r.cook_minutes) : "");
        setCuisine(r.cuisine ?? "");
        setTags(r.tags);
        setIngredients(
          r.ingredients.length
            ? r.ingredients.map((i) => ({
                id: i.id,
                qty: i.qty != null ? String(i.qty) : "",
                unit: i.unit ?? "",
                item: i.item,
                note: i.note ?? "",
              }))
            : [emptyIngredient()],
        );
        setSteps(
          r.steps.length
            ? r.steps.map((s) => ({
                text: s.text,
                ingredientIds: s.ingredient_ids,
                timerMinutes: s.timer_seconds ? String(Math.round(s.timer_seconds / 60)) : "",
              }))
            : [emptyStep()],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this recipe."))
      .finally(() => setLoading(false));
  }, [db, recipeId]);

  function updateIngredient(index: number, patch: Partial<IngredientRow>) {
    setIngredients((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function removeIngredient(index: number) {
    const removedId = ingredients[index]?.id;
    setIngredients((rows) => rows.filter((_, i) => i !== index));
    if (removedId) {
      setSteps((rows) => rows.map((r) => ({ ...r, ingredientIds: r.ingredientIds.filter((id) => id !== removedId) })));
    }
  }
  function updateStep(index: number, patch: Partial<StepRow>) {
    setSteps((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function toggleStepIngredient(index: number, ingredientId: string) {
    setSteps((rows) =>
      rows.map((r, i) =>
        i === index
          ? {
              ...r,
              ingredientIds: r.ingredientIds.includes(ingredientId)
                ? r.ingredientIds.filter((id) => id !== ingredientId)
                : [...r.ingredientIds, ingredientId],
            }
          : r,
      ),
    );
  }
  function removeStep(index: number) {
    setSteps((rows) => rows.filter((_, i) => i !== index));
  }
  function moveStep(index: number, dir: -1 | 1) {
    setSteps((rows) => {
      const target = index + dir;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    if (!title.trim()) {
      setError("Give the recipe a title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cleanIngredients: Ingredient[] = ingredients
        .filter((r) => r.item.trim())
        .map((r) => ({
          id: r.id,
          qty: r.qty.trim() ? Number(r.qty) : null,
          unit: r.unit.trim() || null,
          item: r.item.trim(),
          note: r.note.trim() || null,
          store_section: null,
        }));
      const keptIngredientIds = new Set(cleanIngredients.map((i) => i.id));
      const cleanSteps: RecipeStep[] = steps
        .filter((r) => r.text.trim())
        .map((r, idx) => ({
          n: idx + 1,
          text: r.text.trim(),
          timer_seconds: r.timerMinutes.trim() ? Math.round(Number(r.timerMinutes) * 60) : null,
          ingredient_ids: r.ingredientIds.filter((id) => keptIngredientIds.has(id)),
        }));

      const payload: RecipeWritePayload = {
        title: title.trim(),
        description: description.trim() || null,
        servings: servings.trim() ? Number(servings) : null,
        prep_minutes: prepMinutes.trim() ? Number(prepMinutes) : null,
        cook_minutes: cookMinutes.trim() ? Number(cookMinutes) : null,
        cuisine: cuisine.trim() || null,
        tags,
        ingredients: cleanIngredients,
        steps: cleanSteps,
      };

      const saved = recipeId
        ? await updateRecipe(db, recipeId, payload)
        : await createRecipe(db, householdId, myUserId, payload);
      onSaved(saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this recipe.");
    } finally {
      setSaving(false);
    }
  }

  useBackButton(onCancel);
  useMainButton(saving ? "Saving…" : "Save", save, !loading);

  if (loading) return <p className="muted screen">Loading…</p>;

  const namedIngredients = ingredients.filter((r) => r.item.trim());

  return (
    <div className="screen recipe-form">
      <h1>{isEditing ? "Edit recipe" : "Add recipe"}</h1>
      {error && <p className="error">{error}</p>}

      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Servings</span>
          <input inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} />
        </label>
        <label className="field">
          <span>Prep min</span>
          <input inputMode="numeric" value={prepMinutes} onChange={(e) => setPrepMinutes(e.target.value)} />
        </label>
        <label className="field">
          <span>Cook min</span>
          <input inputMode="numeric" value={cookMinutes} onChange={(e) => setCookMinutes(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span>Cuisine</span>
        <input value={cuisine} onChange={(e) => setCuisine(e.target.value)} />
      </label>

      <div className="field">
        <span>Tags</span>
        <TagInput tags={tags} onChange={setTags} suggestions={tagSuggestions} />
      </div>

      <section className="card">
        <h2>Ingredients</h2>
        {ingredients.map((row, i) => (
          <div className="ingredient-row" key={row.id}>
            <input
              className="qty"
              placeholder="Qty"
              inputMode="decimal"
              value={row.qty}
              onChange={(e) => updateIngredient(i, { qty: e.target.value })}
            />
            <input
              className="unit"
              placeholder="Unit"
              value={row.unit}
              onChange={(e) => updateIngredient(i, { unit: e.target.value })}
            />
            <input
              className="item"
              placeholder="Ingredient"
              value={row.item}
              onChange={(e) => updateIngredient(i, { item: e.target.value })}
            />
            <input
              className="note"
              placeholder="Note"
              value={row.note}
              onChange={(e) => updateIngredient(i, { note: e.target.value })}
            />
            <button
              type="button"
              className="remove"
              onClick={() => removeIngredient(i)}
              aria-label="Remove ingredient"
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="button secondary" onClick={() => setIngredients((r) => [...r, emptyIngredient()])}>
          + Add ingredient
        </button>
      </section>

      <section className="card">
        <h2>Steps</h2>
        <p className="muted step-help">
          Optionally tag which ingredients each step uses and set a timer — cooking mode uses both.
        </p>
        {steps.map((row, i) => (
          <div className="step-row-block" key={i}>
            <div className="step-row">
              <span className="step-n">{i + 1}</span>
              <textarea value={row.text} onChange={(e) => updateStep(i, { text: e.target.value })} />
              <div className="step-actions">
                <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move up">
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(i, 1)}
                  disabled={i === steps.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button type="button" className="remove" onClick={() => removeStep(i)} aria-label="Remove step">
                  ×
                </button>
              </div>
            </div>
            <div className="step-extras">
              {namedIngredients.length > 0 && (
                <div className="step-ingredient-picker">
                  {namedIngredients.map((ing) => (
                    <button
                      type="button"
                      key={ing.id}
                      className={row.ingredientIds.includes(ing.id) ? "step-tag active" : "step-tag"}
                      onClick={() => toggleStepIngredient(i, ing.id)}
                    >
                      {ing.item}
                    </button>
                  ))}
                </div>
              )}
              <label className="step-timer">
                <span>Timer (min)</span>
                <input
                  inputMode="numeric"
                  placeholder="—"
                  value={row.timerMinutes}
                  onChange={(e) => updateStep(i, { timerMinutes: e.target.value })}
                />
              </label>
            </div>
          </div>
        ))}
        <button type="button" className="button secondary" onClick={() => setSteps((r) => [...r, emptyStep()])}>
          + Add step
        </button>
      </section>
    </div>
  );
}
