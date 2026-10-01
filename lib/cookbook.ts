// Shared cookbook-import domain types and pure helpers. No imports, no side effects, so this
// file is safe to import from both /web (browser bundle) and /api (server).

export interface PageRange {
  /** 1-indexed, inclusive. */
  pageStart: number;
  pageEnd: number;
}

const CHUNK_SIZE = 15;
const CHUNK_OVERLAP = 1;

/**
 * Splits a PDF's page count into overlapping chunks for separate extraction jobs. The 1-page
 * overlap means a recipe straddling a chunk boundary still appears whole in at least one chunk;
 * `dedupeCandidatesByTitle` below removes the resulting duplicate.
 */
export function buildChunkRanges(pageCount: number): PageRange[] {
  if (pageCount <= 0) return [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  const ranges: PageRange[] = [];
  for (let start = 1; start <= pageCount; start += step) {
    ranges.push({ pageStart: start, pageEnd: Math.min(start + CHUNK_SIZE - 1, pageCount) });
    if (start + CHUNK_SIZE - 1 >= pageCount) break;
  }
  return ranges;
}

/** A recipe as extracted from a PDF chunk, before it becomes an import_candidates row. */
export interface ExtractedRecipe {
  title: string;
  description: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  cuisine: string | null;
  tags: string[];
  ingredients: { qty: number | null; unit: string | null; item: string; note: string | null }[];
  steps: { text: string }[];
  /** Page within the chunk (not the whole book) that the recipe starts on, for dedup/reference. */
  page: number | null;
}

/**
 * Validates Claude's raw `extract_recipes` tool input into well-formed recipes, dropping any
 * entry that doesn't match the expected shape rather than failing the whole batch — a chunk with
 * one malformed recipe shouldn't lose the other nine.
 */
export function parseExtractedRecipes(raw: unknown): ExtractedRecipe[] {
  if (typeof raw !== "object" || raw === null || !("recipes" in raw)) return [];
  const list = (raw as { recipes: unknown }).recipes;
  if (!Array.isArray(list)) return [];

  const out: ExtractedRecipe[] = [];
  for (const entry of list) {
    const parsed = parseOne(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseOne(entry: unknown): ExtractedRecipe | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.title !== "string" || !e.title.trim()) return null;

  const ingredients = Array.isArray(e.ingredients)
    ? e.ingredients
        .map((i): ExtractedRecipe["ingredients"][number] | null => {
          if (typeof i !== "object" || i === null) return null;
          const ing = i as Record<string, unknown>;
          if (typeof ing.item !== "string" || !ing.item.trim()) return null;
          return {
            qty: typeof ing.qty === "number" && Number.isFinite(ing.qty) ? ing.qty : null,
            unit: typeof ing.unit === "string" && ing.unit.trim() ? ing.unit.trim() : null,
            item: ing.item.trim(),
            note: typeof ing.note === "string" && ing.note.trim() ? ing.note.trim() : null,
          };
        })
        .filter((i): i is ExtractedRecipe["ingredients"][number] => i !== null)
    : [];

  const steps = Array.isArray(e.steps)
    ? e.steps
        .map((s): { text: string } | null => {
          if (typeof s === "string" && s.trim()) return { text: s.trim() };
          if (typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).text === "string") {
            const text = ((s as Record<string, unknown>).text as string).trim();
            return text ? { text } : null;
          }
          return null;
        })
        .filter((s): s is { text: string } => s !== null)
    : [];

  if (ingredients.length === 0 && steps.length === 0) return null;

  return {
    title: e.title.trim(),
    description: typeof e.description === "string" && e.description.trim() ? e.description.trim() : null,
    servings: typeof e.servings === "number" && Number.isFinite(e.servings) ? e.servings : null,
    prep_minutes: typeof e.prep_minutes === "number" && Number.isFinite(e.prep_minutes) ? e.prep_minutes : null,
    cook_minutes: typeof e.cook_minutes === "number" && Number.isFinite(e.cook_minutes) ? e.cook_minutes : null,
    cuisine: typeof e.cuisine === "string" && e.cuisine.trim() ? e.cuisine.trim() : null,
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string" && !!t.trim()) : [],
    ingredients,
    steps,
    page: typeof e.page === "number" && Number.isFinite(e.page) ? e.page : null,
  };
}

/** Case/whitespace-insensitive title match, used both for cross-chunk-overlap dedup and for
 * flagging possible duplicates against the household's existing recipes. */
export function titlesMatch(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b);
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Drops recipes whose title already matches one in `existingTitles` — used so the 1-page overlap
 * between consecutive chunks doesn't produce two import_candidates for the same recipe. */
export function dedupeByTitle<T extends { title: string }>(recipes: T[], existingTitles: string[]): T[] {
  const seen = existingTitles.map(normalizeTitle);
  const out: T[] = [];
  for (const r of recipes) {
    const key = normalizeTitle(r.title);
    if (seen.includes(key)) continue;
    seen.push(key);
    out.push(r);
  }
  return out;
}
