import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroceryList } from "../../../../lib/grocery";
import { useMainButton } from "../../hooks/useTelegramButtons";
import { listGroceryLists } from "../../lib/groceryApi";

export function GroceryListsScreen({
  db,
  onOpenList,
  onNewList,
}: {
  db: SupabaseClient;
  onOpenList: (id: string) => void;
  onNewList: () => void;
}) {
  const [lists, setLists] = useState<GroceryList[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGroceryLists(db)
      .then(setLists)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your lists."));
  }, [db]);

  useMainButton("+ New list", onNewList);

  const active = lists?.filter((l) => l.status === "active") ?? [];
  const done = lists?.filter((l) => l.status === "done") ?? [];

  return (
    <div className="screen">
      <h1>Lists</h1>
      {error && <p className="error">{error}</p>}

      {lists === null && !error && <p className="muted">Loading…</p>}

      {lists !== null && active.length === 0 && (
        <div className="center">
          <div className="emoji">🛒</div>
          <h2>No active lists</h2>
          <p className="muted">Tap “+ New list” below to build one from your recipes.</p>
        </div>
      )}

      {active.length > 0 && (
        <ul className="list-of-lists">
          {active.map((l) => (
            <li key={l.id}>
              <button className="list-card" onClick={() => onOpenList(l.id)}>
                {l.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <>
          <h2 className="muted">Done</h2>
          <ul className="list-of-lists">
            {done.map((l) => (
              <li key={l.id}>
                <button className="list-card done" onClick={() => onOpenList(l.id)}>
                  {l.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
