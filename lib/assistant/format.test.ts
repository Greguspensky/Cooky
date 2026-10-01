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

  it("describes a logged (past-dated) dish as cooked", () => {
    const message = describeAppliedAction("schedule_dish", { title: "Lasagna", date: "2026-09-01", status: "cooked" });
    expect(message).toContain("Lasagna");
    expect(message).toMatch(/cooked/i);
  });

  it("describes a future-dated dish as scheduled", () => {
    const message = describeAppliedAction("schedule_dish", { title: "Lasagna", date: "2099-09-01", status: "planned" });
    expect(message).toMatch(/scheduled/i);
  });

  it("falls back for an unknown tool", () => {
    expect(describeAppliedAction("mystery_tool", {})).toBe("Done.");
  });
});
