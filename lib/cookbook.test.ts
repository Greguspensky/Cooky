import { describe, expect, it } from "vitest";
import { buildChunkRanges, dedupeByTitle, parseExtractedRecipes, titlesMatch } from "./cookbook.js";

describe("buildChunkRanges", () => {
  it("returns one chunk for a short PDF", () => {
    expect(buildChunkRanges(10)).toEqual([{ pageStart: 1, pageEnd: 10 }]);
  });

  it("splits into 10-page chunks with a 1-page overlap", () => {
    expect(buildChunkRanges(30)).toEqual([
      { pageStart: 1, pageEnd: 10 },
      { pageStart: 10, pageEnd: 19 },
      { pageStart: 19, pageEnd: 28 },
      { pageStart: 28, pageEnd: 30 },
    ]);
  });

  it("the last chunk never runs past the page count", () => {
    const ranges = buildChunkRanges(16);
    expect(ranges[ranges.length - 1].pageEnd).toBe(16);
  });

  it("returns nothing for a zero or negative page count", () => {
    expect(buildChunkRanges(0)).toEqual([]);
    expect(buildChunkRanges(-1)).toEqual([]);
  });
});

describe("parseExtractedRecipes", () => {
  it("accepts a well-formed batch", () => {
    const result = parseExtractedRecipes({
      recipes: [
        {
          title: "Lasagna",
          ingredients: [{ item: "pasta", qty: 500, unit: "g" }],
          steps: [{ text: "Bake it" }],
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Lasagna");
    expect(result[0].ingredients).toEqual([{ item: "pasta", qty: 500, unit: "g", note: null }]);
  });

  it("accepts steps given as plain strings", () => {
    const result = parseExtractedRecipes({
      recipes: [{ title: "Soup", ingredients: [{ item: "water" }], steps: ["Boil it"] }],
    });
    expect(result[0].steps).toEqual([{ text: "Boil it" }]);
  });

  it("drops a recipe with no title", () => {
    const result = parseExtractedRecipes({ recipes: [{ ingredients: [], steps: ["x"] }] });
    expect(result).toEqual([]);
  });

  it("drops a recipe with neither ingredients nor steps", () => {
    const result = parseExtractedRecipes({ recipes: [{ title: "Empty" }] });
    expect(result).toEqual([]);
  });

  it("keeps a recipe but drops its malformed ingredient rows", () => {
    const result = parseExtractedRecipes({
      recipes: [{ title: "Cake", ingredients: [{ item: "flour" }, { qty: 2 }], steps: ["Mix"] }],
    });
    expect(result[0].ingredients).toEqual([{ item: "flour", qty: null, unit: null, note: null }]);
  });

  it("handles non-object and non-array input", () => {
    expect(parseExtractedRecipes(null)).toEqual([]);
    expect(parseExtractedRecipes("nope")).toEqual([]);
    expect(parseExtractedRecipes({ recipes: "nope" })).toEqual([]);
  });

  it("keeps multiple valid recipes", () => {
    const result = parseExtractedRecipes({
      recipes: [
        { title: "A", ingredients: [{ item: "x" }], steps: [] },
        { title: "B", ingredients: [], steps: ["y"] },
      ],
    });
    expect(result.map((r) => r.title)).toEqual(["A", "B"]);
  });
});

describe("titlesMatch", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(titlesMatch("  Lasagna  ", "lasagna")).toBe(true);
  });

  it("collapses internal whitespace differences", () => {
    expect(titlesMatch("Chicken   Soup", "chicken soup")).toBe(true);
  });

  it("is false for different titles", () => {
    expect(titlesMatch("Lasagna", "Soup")).toBe(false);
  });
});

describe("dedupeByTitle", () => {
  it("drops a recipe matching an existing title", () => {
    const result = dedupeByTitle([{ title: "Lasagna" }, { title: "Soup" }], ["lasagna"]);
    expect(result.map((r) => r.title)).toEqual(["Soup"]);
  });

  it("dedupes within the batch itself, keeping the first", () => {
    const result = dedupeByTitle([{ title: "Soup" }, { title: "soup" }], []);
    expect(result).toEqual([{ title: "Soup" }]);
  });

  it("keeps everything when nothing matches", () => {
    const result = dedupeByTitle([{ title: "Soup" }], ["Lasagna"]);
    expect(result).toEqual([{ title: "Soup" }]);
  });
});
