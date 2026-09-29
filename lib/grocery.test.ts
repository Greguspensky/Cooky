import { describe, expect, it } from "vitest";
import { guessStoreSection, mergeIngredients } from "./grocery.js";

describe("guessStoreSection", () => {
  it("matches known keywords", () => {
    expect(guessStoreSection("Whole milk")).toBe("dairy");
    expect(guessStoreSection("Chicken thighs")).toBe("meat_fish");
    expect(guessStoreSection("All-purpose flour")).toBe("pantry");
    expect(guessStoreSection("Frozen peas")).toBe("frozen");
    expect(guessStoreSection("Sourdough bread")).toBe("bakery");
  });

  it("falls back to other for anything unrecognized", () => {
    expect(guessStoreSection("Za'atar")).toBe("other");
  });
});

describe("mergeIngredients", () => {
  it("sums quantities for the same item and unit", () => {
    const merged = mergeIngredients([
      { item: "Flour", qty: 200, unit: "g", recipeId: "r1" },
      { item: "flour", qty: 100, unit: "G", recipeId: "r2" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ item: "Flour", qty: 300, unit: "g" });
    expect(merged[0].source_recipe_ids.sort()).toEqual(["r1", "r2"]);
  });

  it("keeps items with different units separate", () => {
    const merged = mergeIngredients([
      { item: "Garlic", qty: 2, unit: "cloves", recipeId: "r1" },
      { item: "Garlic", qty: 1, unit: "tsp", recipeId: "r2" },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("drops the quantity when only one side has one", () => {
    const merged = mergeIngredients([
      { item: "Salt", qty: 1, unit: "tsp", recipeId: "r1" },
      { item: "Salt", qty: null, unit: "tsp", recipeId: "r2" },
    ]);
    expect(merged[0].qty).toBeNull();
  });

  it("assigns a guessed store section", () => {
    const [merged] = mergeIngredients([{ item: "Cheddar cheese", qty: 1, unit: null, recipeId: "r1" }]);
    expect(merged.store_section).toBe("dairy");
  });

  it("skips blank ingredient names", () => {
    expect(mergeIngredients([{ item: "  ", qty: 1, unit: null, recipeId: "r1" }])).toHaveLength(0);
  });
});
