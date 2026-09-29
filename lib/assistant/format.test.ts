import { describe, expect, it } from "vitest";
import { describeAppliedAction } from "./format.js";

describe("describeAppliedAction", () => {
  it("describes a saved recipe", () => {
    expect(describeAppliedAction("save_recipe", { title: "Lasagna" })).toContain("Lasagna");
  });

  it("pluralizes item counts correctly", () => {
    expect(describeAppliedAction("create_grocery_list", { name: "Weekly shop", itemCount: 1 })).toMatch(/1 item\.?\s*🛒/);
    expect(describeAppliedAction("create_grocery_list", { name: "Weekly shop", itemCount: 3 })).toMatch(/3 items\.?\s*🛒/);
  });

  it("describes adding items to an existing list", () => {
    const message = describeAppliedAction("add_to_grocery_list", { name: "Weekly shop", addedCount: 2 });
    expect(message).toContain("Weekly shop");
    expect(message).toContain("2 items");
  });

  it("describes a preference update", () => {
    expect(describeAppliedAction("propose_preference_update", {})).toMatch(/preferences/i);
  });

  it("falls back for an unknown tool", () => {
    expect(describeAppliedAction("mystery_tool", {})).toBe("Done.");
  });
});
