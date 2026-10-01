import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CookbookReviewScreen } from "./CookbookReviewScreen";
import { CookbooksListScreen } from "./CookbooksListScreen";

type View = { screen: "list" } | { screen: "review"; id: string };

export function ImportTab({
  db,
  householdId,
  myUserId,
  initialCookbookId,
}: {
  db: SupabaseClient;
  householdId: string;
  myUserId: string;
  /** Set when opened via the bot's "review_<id>" deep link. */
  initialCookbookId?: string;
}) {
  const [view, setView] = useState<View>(
    initialCookbookId ? { screen: "review", id: initialCookbookId } : { screen: "list" },
  );

  if (view.screen === "review") {
    return (
      <CookbookReviewScreen
        db={db}
        householdId={householdId}
        myUserId={myUserId}
        cookbookId={view.id}
        onBack={() => setView({ screen: "list" })}
      />
    );
  }

  return <CookbooksListScreen db={db} onOpenCookbook={(id) => setView({ screen: "review", id })} />;
}
