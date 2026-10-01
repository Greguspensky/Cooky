import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useBackButton } from "../../hooks/useTelegramButtons";
import {
  acceptCandidate,
  fetchCookbook,
  listPendingCandidates,
  rejectCandidate,
  runNextImportJob,
  type Cookbook,
  type ImportCandidate,
} from "../../lib/cookbooksApi";
import { listCuisinesAndTags } from "../../lib/recipesApi";
import { haptic } from "../../telegram";
import { RecipeFormScreen } from "../recipes/RecipeFormScreen";

export function CookbookReviewScreen({
  db,
  householdId,
  myUserId,
  cookbookId,
  onBack,
}: {
  db: SupabaseClient;
  householdId: string;
  myUserId: string;
  cookbookId: string;
  onBack: () => void;
}) {
  const [cookbook, setCookbook] = useState<Cookbook | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [progress, setProgress] = useState<{ remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const runningRef = useRef(false);

  function reloadCandidates() {
    listPendingCandidates(db, cookbookId)
      .then(setCandidates)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the recipes found."));
  }

  useEffect(() => {
    listCuisinesAndTags(db)
      .then(({ tags }) => setTagSuggestions(tags))
      .catch(() => {});
  }, [db]);

  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    async function run() {
      try {
        let cb = await fetchCookbook(db, cookbookId);
        setCookbook(cb);
        while (cb.status === "uploaded" || cb.status === "processing") {
          const result = await runNextImportJob(cookbookId);
          setProgress({ remaining: result.remaining });
          if (result.done) break;
          cb = await fetchCookbook(db, cookbookId);
          setCookbook(cb);
        }
        cb = await fetchCookbook(db, cookbookId);
        setCookbook(cb);
        reloadCandidates();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't run the import.");
      }
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, cookbookId]);

  async function accept(candidate: ImportCandidate) {
    haptic("tap");
    try {
      const { recipeId } = await acceptCandidate(candidate.id);
      setCandidates((rows) => rows?.filter((r) => r.id !== candidate.id) ?? null);
      setEditingRecipeId(recipeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't accept that recipe.");
    }
  }

  async function reject(candidate: ImportCandidate) {
    haptic("tap");
    setCandidates((rows) => rows?.filter((r) => r.id !== candidate.id) ?? null);
    try {
      await rejectCandidate(candidate.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reject that recipe.");
      reloadCandidates();
    }
  }

  useBackButton(editingRecipeId ? () => setEditingRecipeId(null) : onBack);

  if (editingRecipeId) {
    return (
      <RecipeFormScreen
        db={db}
        householdId={householdId}
        myUserId={myUserId}
        recipeId={editingRecipeId}
        tagSuggestions={tagSuggestions}
        onSaved={() => setEditingRecipeId(null)}
        onCancel={() => setEditingRecipeId(null)}
      />
    );
  }

  const stillProcessing = cookbook && (cookbook.status === "uploaded" || cookbook.status === "processing");

  return (
    <div className="screen">
      <h1>{cookbook?.title ?? "Cookbook"}</h1>
      {error && <p className="error">{error}</p>}

      {stillProcessing && (
        <p className="muted">
          Extracting recipes…{progress ? ` (${progress.remaining} chunk${progress.remaining === 1 ? "" : "s"} left)` : ""}
        </p>
      )}

      {cookbook?.status === "failed" && <p className="error">Couldn't read any pages from this PDF.</p>}

      {cookbook?.status === "ready" && candidates !== null && candidates.length === 0 && (
        <div className="center">
          <div className="emoji">🍽️</div>
          <h2>Nothing left to review</h2>
          <p className="muted">Every recipe found in this cookbook has been accepted or rejected.</p>
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <ul className="import-candidate-list">
          {candidates.map((c) => (
            <li key={c.id} className="card import-candidate">
              <h3>{c.recipe.title}</h3>
              <p className="muted">
                {c.recipe.ingredients.length} ingredient{c.recipe.ingredients.length === 1 ? "" : "s"} ·{" "}
                {c.recipe.steps.length} step{c.recipe.steps.length === 1 ? "" : "s"}
                {c.page != null ? ` · page ${c.page}` : ""}
              </p>
              {c.duplicate_recipe && (
                <p className="muted duplicate-warning">⚠ Possibly already have "{c.duplicate_recipe.title}"</p>
              )}
              <div className="import-candidate-actions">
                <button type="button" className="button secondary compact" onClick={() => reject(c)}>
                  Reject
                </button>
                <button type="button" className="button compact" onClick={() => accept(c)}>
                  Accept
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
