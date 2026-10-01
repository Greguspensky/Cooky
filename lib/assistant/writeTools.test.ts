import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingAction } from "./pendingActions.js";

vi.mock("../db.js", () => ({ adminDb: vi.fn() }));
const { adminDb } = await import("../db.js");
const { applyWriteTool } = await import("./writeTools.js");

/** A minimal fake Supabase query builder: each call in the code's actual sequence consumes the
 * next queued result. Chain methods just return `this`; awaiting (or calling .single()/
 * .maybeSingle()) resolves the next queued result. */
function fakeDb(results: unknown[]) {
  let i = 0;
  const next = () => results[i++] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  const chainMethods = ["select", "insert", "update", "upsert", "eq", "neq", "in", "order", "limit"];
  for (const m of chainMethods) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(next()));
  chain.maybeSingle = vi.fn(() => Promise.resolve(next()));
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve(next()).then(resolve);
  return { from: vi.fn(() => chain) };
}

function action(overrides: Partial<PendingAction>): PendingAction {
  return {
    id: "pa1",
    user_id: "u1",
    action_type: "save_recipe",
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    payload: { input: {}, householdId: "h1" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(adminDb).mockReset();
});

describe("applyWriteTool: save_recipe", () => {
  it("builds ingredients/steps with generated ids and inserts as an assistant-sourced recipe", async () => {
    const db = fakeDb([{ data: { id: "r1", title: "Lasagna" }, error: null }]);
    vi.mocked(adminDb).mockReturnValue(db as never);

    const result = await applyWriteTool(
      action({
        action_type: "save_recipe",
        payload: {
          householdId: "h1",
          input: {
            title: "Lasagna",
            ingredients: [{ item: "Pasta", qty: 200, unit: "g" }],
            steps: [{ text: "Bake it" }],
          },
        },
      }),
    );

    expect(result).toEqual({ recipeId: "r1", title: "Lasagna" });
    const insertedPayload = vi.mocked(db.from).mock.results[0].value.insert.mock.calls[0][0];
    expect(insertedPayload.household_id).toBe("h1");
    expect(insertedPayload.source_type).toBe("assistant");
    expect(insertedPayload.ingredients[0]).toMatchObject({ item: "Pasta", qty: 200, unit: "g" });
    expect(typeof insertedPayload.ingredients[0].id).toBe("string");
    expect(insertedPayload.steps[0]).toEqual({ n: 1, text: "Bake it", timer_seconds: null, ingredient_ids: [] });
  });
});

describe("applyWriteTool: create_grocery_list", () => {
  it("scales ingredients to the requested servings before merging", async () => {
    const recipes = [
      { id: "r1", title: "Soup", servings: 2, ingredients: [{ id: "i1", qty: 100, unit: "g", item: "Onion", note: null, store_section: null }] },
    ];
    const db = fakeDb([
      { data: recipes, error: null }, // fetch recipes
      { data: { id: "l1", name: "From the assistant" }, error: null }, // insert list
      { error: null }, // insert items
    ]);
    vi.mocked(adminDb).mockReturnValue(db as never);

    const result = await applyWriteTool(
      action({
        action_type: "create_grocery_list",
        payload: { householdId: "h1", input: { recipes: [{ recipe_id: "r1", servings: 4 }] } },
      }),
    );

    expect(result).toEqual({ listId: "l1", name: "From the assistant", itemCount: 1 });
    // `.from()` always returns the same fake chain, so its `insert` calls are in call order:
    // [0] = the grocery_lists insert, [1] = the grocery_items insert.
    const chain = vi.mocked(db.from).mock.results[0].value as { insert: ReturnType<typeof vi.fn> };
    const itemsInsertPayload = chain.insert.mock.calls[1][0];
    expect(itemsInsertPayload[0]).toMatchObject({ item: "Onion", qty: 200, unit: "g", list_id: "l1" });
  });
});

describe("applyWriteTool: propose_preference_update", () => {
  it("merges new likes/dislikes without duplicating case-insensitively", async () => {
    const db = fakeDb([
      { data: { likes: ["garlic"], dislikes: [], diet_notes: null }, error: null }, // existing prefs
      { error: null }, // upsert
    ]);
    vi.mocked(adminDb).mockReturnValue(db as never);

    const result = await applyWriteTool(
      action({
        action_type: "propose_preference_update",
        payload: { householdId: "h1", input: { add_likes: ["Garlic", "Basil"], add_dislikes: ["Cilantro"] } },
      }),
    );

    expect(result).toEqual({ likes: ["garlic", "Basil"], dislikes: ["Cilantro"], diet_notes: null });
  });
});

describe("applyWriteTool: schedule_dish", () => {
  it("marks a past date as cooked immediately", async () => {
    const db = fakeDb([{ data: { title: "Lasagna" }, error: null }, { error: null }]);
    vi.mocked(adminDb).mockReturnValue(db as never);

    const result = await applyWriteTool(
      action({ action_type: "schedule_dish", payload: { householdId: "h1", input: { recipe_id: "r1", date: "2000-01-01" } } }),
    );

    expect(result).toEqual({ title: "Lasagna", date: "2000-01-01", status: "cooked" });
    const chain = vi.mocked(db.from).mock.results[0].value as { insert: ReturnType<typeof vi.fn> };
    expect(chain.insert.mock.calls[0][0]).toMatchObject({ status: "cooked", recipe_id: "r1", household_id: "h1" });
  });

  it("marks a future date as planned", async () => {
    const farFuture = "2999-01-01";
    const db = fakeDb([{ data: { title: "Lasagna" }, error: null }, { error: null }]);
    vi.mocked(adminDb).mockReturnValue(db as never);

    const result = await applyWriteTool(
      action({ action_type: "schedule_dish", payload: { householdId: "h1", input: { recipe_id: "r1", date: farFuture } } }),
    );

    expect(result).toMatchObject({ status: "planned", date: farFuture });
  });

  it("defaults to today when no date is given", async () => {
    const db = fakeDb([{ data: { title: "Lasagna" }, error: null }, { error: null }]);
    vi.mocked(adminDb).mockReturnValue(db as never);

    const result = await applyWriteTool(
      action({ action_type: "schedule_dish", payload: { householdId: "h1", input: { recipe_id: "r1" } } }),
    );

    expect(result).toMatchObject({ status: "cooked" });
  });

  it("throws when the recipe isn't found in this household", async () => {
    const db = fakeDb([{ data: null, error: null }]);
    vi.mocked(adminDb).mockReturnValue(db as never);

    await expect(
      applyWriteTool(action({ action_type: "schedule_dish", payload: { householdId: "h1", input: { recipe_id: "nope" } } })),
    ).rejects.toThrow(/wasn't found/);
  });
});
