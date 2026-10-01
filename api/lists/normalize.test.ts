import { describe, expect, it } from "vitest";
import { parseNormalizeChanges, type LineItem } from "./normalize.js";

const items: LineItem[] = [
  { id: "i1", item: "Mayonnaise", qty: 2, unit: "tbsp" },
  { id: "i2", item: "Chicken breast", qty: 300, unit: "g" },
];

describe("parseNormalizeChanges", () => {
  it("accepts a well-formed change", () => {
    const result = parseNormalizeChanges(items, [{ id: "i1", qty: 1, unit: "jar" }]);
    expect(result).toEqual([{ id: "i1", qty: 1, unit: "jar" }]);
  });

  it("drops a change for an id not on this list", () => {
    const result = parseNormalizeChanges(items, [{ id: "not-on-list", qty: 1, unit: "jar" }]);
    expect(result).toEqual([]);
  });

  it("drops malformed entries: missing fields, wrong types, non-positive qty, blank unit", () => {
    const result = parseNormalizeChanges(items, [
      { id: "i1" }, // missing qty/unit
      { id: "i1", qty: "one", unit: "jar" }, // qty is a string
      { id: "i1", qty: 0, unit: "jar" }, // qty not positive
      { id: "i1", qty: Infinity, unit: "jar" }, // qty not finite
      { id: "i1", qty: 1, unit: "  " }, // blank unit
      { id: "i1", qty: 1 }, // missing unit
      null,
      "not an object",
    ]);
    expect(result).toEqual([]);
  });

  it("returns an empty array when the model's response isn't an array at all", () => {
    expect(parseNormalizeChanges(items, undefined)).toEqual([]);
    expect(parseNormalizeChanges(items, { changes: [] })).toEqual([]);
  });

  it("keeps multiple valid changes", () => {
    const result = parseNormalizeChanges(items, [
      { id: "i1", qty: 1, unit: "jar" },
      { id: "i2", qty: 300, unit: "g" },
    ]);
    expect(result).toHaveLength(2);
  });
});
