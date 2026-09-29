import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useHouseholdMembers } from "../../hooks/useHouseholdMembers";
import { listCuisinesAndTags } from "../../lib/recipesApi";
import { RecipeDetailScreen } from "./RecipeDetailScreen";
import { RecipeFormScreen } from "./RecipeFormScreen";
import { RecipesListScreen } from "./RecipesListScreen";

type View = { screen: "list" } | { screen: "detail"; id: string } | { screen: "form"; id?: string };

export function RecipesTab({
  db,
  householdId,
  myUserId,
  onAskAssistant,
}: {
  db: SupabaseClient;
  householdId: string;
  myUserId: string;
  onAskAssistant: (prefill: string) => void;
}) {
  const members = useHouseholdMembers(db);
  const [stack, setStack] = useState<View[]>([{ screen: "list" }]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const view = stack[stack.length - 1];

  // Refreshed whenever we return to the list, which is cheap and keeps new tags suggestible
  // right after they're used for the first time.
  useEffect(() => {
    if (view.screen === "list") {
      listCuisinesAndTags(db)
        .then(({ tags }) => setTagSuggestions(tags))
        .catch(() => {});
    }
  }, [db, view.screen]);

  function push(next: View) {
    setStack((s) => [...s, next]);
  }
  function pop() {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }
  function resetToList() {
    setStack([{ screen: "list" }]);
  }

  if (view.screen === "detail") {
    return (
      <RecipeDetailScreen
        db={db}
        recipeId={view.id}
        householdId={householdId}
        myUserId={myUserId}
        members={members}
        onBack={pop}
        onEdit={(id) => push({ screen: "form", id })}
        onDeleted={resetToList}
        onAskAssistant={onAskAssistant}
      />
    );
  }

  if (view.screen === "form") {
    return (
      <RecipeFormScreen
        db={db}
        householdId={householdId}
        myUserId={myUserId}
        recipeId={view.id}
        tagSuggestions={tagSuggestions}
        onSaved={(id) => setStack([{ screen: "list" }, { screen: "detail", id }])}
        onCancel={pop}
      />
    );
  }

  return (
    <RecipesListScreen
      db={db}
      members={members}
      myUserId={myUserId}
      onOpenRecipe={(id) => push({ screen: "detail", id })}
      onAddRecipe={() => push({ screen: "form" })}
    />
  );
}
