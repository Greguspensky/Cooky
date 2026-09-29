import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useHouseholdMembers } from "../../hooks/useHouseholdMembers";
import { GroceryListDetailScreen } from "./GroceryListDetailScreen";
import { GroceryListsScreen } from "./GroceryListsScreen";
import { RecipePickerScreen } from "./RecipePickerScreen";

type View = { screen: "lists" } | { screen: "picker" } | { screen: "detail"; id: string };

export function GroceryListsTab({
  db,
  householdId,
  myUserId,
}: {
  db: SupabaseClient;
  householdId: string;
  myUserId: string;
}) {
  const members = useHouseholdMembers(db);
  const [view, setView] = useState<View>({ screen: "lists" });

  if (view.screen === "picker") {
    return (
      <RecipePickerScreen
        db={db}
        householdId={householdId}
        myUserId={myUserId}
        onCreated={(id) => setView({ screen: "detail", id })}
        onCancel={() => setView({ screen: "lists" })}
      />
    );
  }

  if (view.screen === "detail") {
    return (
      <GroceryListDetailScreen
        db={db}
        listId={view.id}
        myUserId={myUserId}
        members={members}
        onBack={() => setView({ screen: "lists" })}
      />
    );
  }

  return (
    <GroceryListsScreen
      db={db}
      onOpenList={(id) => setView({ screen: "detail", id })}
      onNewList={() => setView({ screen: "picker" })}
    />
  );
}
