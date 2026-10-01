import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tools the assistant can call (plan §4.5), minus `search_cookbook_candidates`, which needs the
 * cookbook importer (phase 3, not built yet). Read-only tools run immediately; every other tool
 * name here must appear in WRITE_TOOLS below and returns a pending_action instead (plan §6).
 */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_recipes",
    description:
      "Search the household's saved recipes. Always try this before suggesting a recipe idea from " +
      "general knowledge, so saved recipes are offered first.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search: title, ingredient, or tag." },
        cuisine: { type: "string" },
        max_minutes: { type: "number", description: "Only recipes at or under this total time." },
        favorites_of: { type: "string", enum: ["me", "partner", "either"] },
      },
    },
  },
  {
    name: "get_recipe",
    description: "Get the full ingredients and steps for one saved recipe by id.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_preferences",
    description: "Get the household's taste preferences: likes, dislikes, and diet notes for one or both people.",
    input_schema: {
      type: "object",
      properties: { who: { type: "string", enum: ["me", "partner", "both"] } },
    },
  },
  {
    name: "open_in_app",
    description: "Get a link that opens a specific recipe or grocery list in the Mini App.",
    input_schema: {
      type: "object",
      properties: {
        target_type: { type: "string", enum: ["recipe", "grocery_list"] },
        id: { type: "string" },
      },
      required: ["target_type", "id"],
    },
  },
  {
    name: "get_cook_entries",
    description:
      "Look up the household's cooking calendar: past logged dishes (history, e.g. \"how many times have " +
      "we made lasagna\") and/or future planned ones (e.g. \"what are we cooking Friday\"). Returns each " +
      "entry's recipe title, date and status.",
    input_schema: {
      type: "object",
      properties: {
        recipe_id: { type: "string", description: "Limit to one recipe's history." },
        status: { type: "string", enum: ["planned", "cooked", "any"], description: "Defaults to any." },
        from_date: { type: "string", description: "YYYY-MM-DD, inclusive." },
        to_date: { type: "string", description: "YYYY-MM-DD, inclusive." },
      },
    },
  },
  {
    name: "save_recipe",
    description:
      "Save a new recipe to the household's collection. Only for a recipe you're proposing from general " +
      "knowledge, not one that came back from search_recipes (that one's already saved). Always tell the " +
      "user first which suggestions are already saved and which are new, before offering to save one.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        servings: { type: "number" },
        prep_minutes: { type: "number" },
        cook_minutes: { type: "number" },
        cuisine: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        ingredients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              qty: { type: "number" },
              unit: { type: "string" },
              item: { type: "string" },
              note: { type: "string" },
            },
            required: ["item"],
          },
        },
        steps: {
          type: "array",
          items: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        },
      },
      required: ["title", "ingredients", "steps"],
    },
  },
  {
    name: "create_grocery_list",
    description: "Create a new grocery list by merging the ingredients of one or more saved recipes.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        recipes: {
          type: "array",
          description: "Which saved recipes to include, and at what servings.",
          items: {
            type: "object",
            properties: { recipe_id: { type: "string" }, servings: { type: "number" } },
            required: ["recipe_id"],
          },
        },
      },
      required: ["recipes"],
    },
  },
  {
    name: "add_to_grocery_list",
    description:
      "Add one or more standalone items to a grocery list, e.g. things the user just mentions needing. " +
      "If list_id is omitted, adds to the household's most recently created active list, creating a new " +
      "one named \"From the assistant\" if none is active.",
    input_schema: {
      type: "object",
      properties: {
        list_id: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              qty: { type: "number" },
              unit: { type: "string" },
            },
            required: ["item"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "schedule_dish",
    description:
      "Log that a saved recipe was (or will be) cooked on a date. A date of today or earlier counts " +
      "immediately as cooked (use this for \"we made lasagna today\" or backfilling something already " +
      "made); a future date is a plan, shown on the Calendar tab, that gets confirmed as cooked later.",
    input_schema: {
      type: "object",
      properties: {
        recipe_id: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today if omitted." },
      },
      required: ["recipe_id"],
    },
  },
  {
    name: "propose_preference_update",
    description:
      "Propose adding to the CURRENT user's own taste preferences based on something they said (e.g. " +
      "\"I don't like cilantro\"). Only ever updates the person speaking, never their partner. Additive: " +
      "give only the new likes/dislikes to add, not the full existing list.",
    input_schema: {
      type: "object",
      properties: {
        add_likes: { type: "array", items: { type: "string" } },
        add_dislikes: { type: "array", items: { type: "string" } },
        diet_notes: { type: "string", description: "Replaces the existing diet notes, if given." },
      },
    },
  },
];

/** Tool names whose call becomes a pending_action instead of executing immediately (plan §6). */
export const WRITE_TOOLS = new Set([
  "save_recipe",
  "create_grocery_list",
  "add_to_grocery_list",
  "schedule_dish",
  "propose_preference_update",
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}
