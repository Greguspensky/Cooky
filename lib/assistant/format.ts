import { adminDb } from "../db.js";

/** A short, human summary of a proposed write, shown before the user confirms it. */
export async function describeProposedAction(toolName: string, input: Record<string, unknown>): Promise<string> {
  switch (toolName) {
    case "save_recipe": {
      const ingredients = (input.ingredients as unknown[]) ?? [];
      const steps = (input.steps as unknown[]) ?? [];
      return `Save "${input.title}" (${ingredients.length} ingredients, ${steps.length} steps) to your recipes?`;
    }
    case "create_grocery_list": {
      const recipes = (input.recipes as { recipe_id: string }[]) ?? [];
      const { data } = await adminDb()
        .from("recipes")
        .select("id, title")
        .in("id", recipes.map((r) => r.recipe_id));
      const titles = recipes.map((r) => data?.find((d) => d.id === r.recipe_id)?.title ?? "a recipe").join(", ");
      const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : "a new list";
      return `Create "${name}" from: ${titles}?`;
    }
    case "add_to_grocery_list": {
      const items = (input.items as { item: string }[]) ?? [];
      const names = items.map((i) => i.item).join(", ");
      if (typeof input.list_id === "string") {
        const { data } = await adminDb().from("grocery_lists").select("name").eq("id", input.list_id).maybeSingle();
        return `Add to "${data?.name ?? "your list"}": ${names}?`;
      }
      return `Add to your active grocery list: ${names}?`;
    }
    case "propose_preference_update": {
      const parts: string[] = [];
      const addLikes = input.add_likes as string[] | undefined;
      const addDislikes = input.add_dislikes as string[] | undefined;
      if (addLikes?.length) parts.push(`like ${addLikes.join(", ")}`);
      if (addDislikes?.length) parts.push(`dislike ${addDislikes.join(", ")}`);
      if (input.diet_notes) parts.push(`diet notes: "${input.diet_notes}"`);
      return `Update your preferences — ${parts.join("; ")}?`;
    }
    default:
      return `Go ahead with this?`;
  }
}

/** A short confirmation message shown once a write has actually been applied. */
export function describeAppliedAction(toolName: string, result: Record<string, unknown>): string {
  switch (toolName) {
    case "save_recipe":
      return `Saved "${result.title}" to your recipes. 🍽️`;
    case "create_grocery_list":
      return `Created "${result.name}" with ${result.itemCount} item${result.itemCount === 1 ? "" : "s"}. 🛒`;
    case "add_to_grocery_list":
      return `Added ${result.addedCount} item${result.addedCount === 1 ? "" : "s"} to "${result.name}". 🛒`;
    case "propose_preference_update":
      return `Updated your preferences. 👍`;
    default:
      return "Done.";
  }
}
