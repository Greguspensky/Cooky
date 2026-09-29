import { describe, expect, it } from "vitest";
import { isWriteTool, TOOLS } from "./tools.js";

describe("isWriteTool", () => {
  it("classifies the data-changing tools as writes", () => {
    for (const name of ["save_recipe", "create_grocery_list", "add_to_grocery_list", "propose_preference_update"]) {
      expect(isWriteTool(name)).toBe(true);
    }
  });

  it("classifies read-only tools and unknown names as non-writes", () => {
    for (const name of ["search_recipes", "get_recipe", "get_preferences", "open_in_app", "nonsense"]) {
      expect(isWriteTool(name)).toBe(false);
    }
  });
});

describe("TOOLS", () => {
  it("declares no tool the plan's search_cookbook_candidates (needs phase 3)", () => {
    expect(TOOLS.some((t) => t.name === "search_cookbook_candidates")).toBe(false);
  });

  it("every declared tool name is unique", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
