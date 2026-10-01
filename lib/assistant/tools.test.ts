import { describe, expect, it } from "vitest";
import { isWriteTool, TOOLS } from "./tools.js";

describe("isWriteTool", () => {
  it("classifies the data-changing tools as writes", () => {
    for (const name of ["save_recipe", "create_grocery_list", "add_to_grocery_list", "schedule_dish", "propose_preference_update"]) {
      expect(isWriteTool(name)).toBe(true);
    }
  });

  it("classifies read-only tools and unknown names as non-writes", () => {
    for (const name of [
      "search_recipes",
      "get_recipe",
      "get_preferences",
      "open_in_app",
      "get_cook_entries",
      "search_cookbook_candidates",
      "nonsense",
    ]) {
      expect(isWriteTool(name)).toBe(false);
    }
  });
});

describe("TOOLS", () => {
  it("every declared tool name is unique", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
