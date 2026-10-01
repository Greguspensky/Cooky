import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useBackButton, useMainButton } from "../../hooks/useTelegramButtons";
import {
  acceptCandidate,
  fetchCookbook,
  listPendingCandidates,
  rejectCandidate,
  runNextImportJob,
  type Cookbook,
  type ImportCandidate,
} from "../../lib/cookbooksApi";
import { haptic } from "../../telegram";

export function CookbookReviewScreen({
  db,
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const runningRef = useRef(false);

  function reloadCandidates() {
    listPendingCandidates(db, cookbookId)
      .then((rows) => {
        setCandidates(rows);
        setSelected(new Set(rows.map((r) => r.id))); // all checked by default; uncheck the ones you don't want
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the recipes found."));
  }

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

  function toggle(id: string) {
    haptic("tap");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!candidates) return;
    setSubmitting(true);
    setError(null);
    const toAccept = candidates.filter((c) => selected.has(c.id));
    const toReject = candidates.filter((c) => !selected.has(c.id));
    try {
      await Promise.all([...toAccept.map((c) => acceptCandidate(c.id)), ...toReject.map((c) => rejectCandidate(c.id))]);
      haptic("success");
      reloadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your choices.");
      reloadCandidates();
    } finally {
      setSubmitting(false);
    }
  }

  useBackButton(onBack);

  const stillProcessing = cookbook && (cookbook.status === "uploaded" || cookbook.status === "processing");
  const canSubmit = cookbook?.status === "ready" && candidates !== null && candidates.length > 0 && !submitting;
  const mainButtonText = submitting ? "Adding…" : selected.size === 0 ? "Discard all" : `Add ${selected.size} selected`;
  useMainButton(mainButtonText, submit, canSubmit);

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
          <p className="muted">Every recipe found in this cookbook has been added or discarded.</p>
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <>
          <p className="muted">Everything's checked by default — uncheck anything you don't want.</p>
          <ul className="import-candidate-list">
            {candidates.map((c) => (
              <li key={c.id} className="card import-candidate">
                <label className="import-candidate-main">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  <div>
                    <h3>{c.recipe.title}</h3>
                    <p className="muted">
                      {c.recipe.ingredients.length} ingredient{c.recipe.ingredients.length === 1 ? "" : "s"} ·{" "}
                      {c.recipe.steps.length} step{c.recipe.steps.length === 1 ? "" : "s"}
                      {c.page != null ? ` · page ${c.page}` : ""}
                    </p>
                    {c.duplicate_recipe && (
                      <p className="muted duplicate-warning">⚠ Possibly already have "{c.duplicate_recipe.title}"</p>
                    )}
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
