import { describe, expect, it } from "vitest";
import { buildSearchTsQuery, scaleIngredients } from "./recipe.js";

describe("scaleIngredients", () => {
  const base = [
    { item: "flour", qty: 200 },
    { item: "salt", qty: null },
  ];

  it("scales numeric quantities proportionally", () => {
    expect(scaleIngredients(base, 4, 8)).toEqual([
      { item: "flour", qty: 400 },
      { item: "salt", qty: null },
    ]);
  });

  it("leaves quantity-less ingredients unchanged", () => {
    expect(scaleIngredients(base, 4, 2)[1].qty).toBeNull();
  });

  it("rounds to two decimals", () => {
    const [scaled] = scaleIngredients([{ item: "flour", qty: 100 }], 3, 1);
    expect(scaled.qty).toBeCloseTo(33.33, 2);
  });

  it("is a no-op when servings are equal or invalid", () => {
    expect(scaleIngredients(base, 4, 4)).toBe(base);
    expect(scaleIngredients(base, 0, 4)).toBe(base);
  });
});

describe("buildSearchTsQuery", () => {
  it("turns words into ANDed prefix matches", () => {
    expect(buildSearchTsQuery("choc cake")).toBe("choc:* & cake:*");
  });

  it("collapses extra whitespace", () => {
    expect(buildSearchTsQuery("  lasagna   bianca  ")).toBe("lasagna:* & bianca:*");
  });

  it("strips characters that would break the tsquery syntax", () => {
    expect(buildSearchTsQuery("o'brien's stew")).toBe("obriens:* & stew:*");
  });

  it("returns null for empty input", () => {
    expect(buildSearchTsQuery("   ")).toBeNull();
  });
});
