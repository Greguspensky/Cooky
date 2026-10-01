import { openAppKeyboard, getBot } from "../../lib/bot.js";
import { dedupeByTitle, titlesMatch } from "../../lib/cookbook.js";
import { extractRecipesFromChunk, sliceChunkPdf } from "../../lib/cookbookImport.js";
import { adminDb } from "../../lib/db.js";
import { verifySessionToken } from "../../lib/jwt.js";

const MAX_ATTEMPTS = 3;

/**
 * POST /api/cookbooks/run-job  { cookbookId }
 * Processes exactly one queued import_job for this cookbook (download its page range, extract
 * recipes with Claude, store the results as import_candidates) and reports how many jobs are
 * left. The Mini App calls this in a loop while its Import screen is open, since a single
 * serverless invocation can't reliably outlive several slow Claude calls in a row.
 */
export async function POST(request: Request): Promise<Response> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  let claims;
  try {
    claims = await verifySessionToken(token);
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  let cookbookId: unknown;
  try {
    ({ cookbookId } = (await request.json()) as { cookbookId?: unknown });
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof cookbookId !== "string" || !cookbookId) return json({ error: "missing_cookbook_id" }, 400);

  const db = adminDb();
  const cookbook = await db
    .from("cookbooks")
    .select("household_id, title, storage_path, uploaded_by")
    .eq("id", cookbookId)
    .maybeSingle();
  if (cookbook.error) throw cookbook.error;
  if (!cookbook.data || cookbook.data.household_id !== claims.householdId) {
    return json({ error: "not_found" }, 404);
  }

  const nextJob = await db
    .from("import_jobs")
    .select("id, page_start, page_end, attempts")
    .eq("cookbook_id", cookbookId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextJob.error) throw nextJob.error;

  let found = 0;
  if (nextJob.data) {
    found = await runOneJob(db, cookbookId, cookbook.data.household_id, cookbook.data.storage_path, nextJob.data);
  }

  const remaining = await db
    .from("import_jobs")
    .select("id", { count: "exact", head: true })
    .eq("cookbook_id", cookbookId)
    .in("status", ["queued", "running"]);
  if (remaining.error) throw remaining.error;

  const stillGoing = (remaining.count ?? 0) > 0;
  if (!stillGoing) {
    await finishCookbook(db, cookbookId, cookbook.data.title, cookbook.data.household_id);
  }

  return json({ done: !stillGoing, remaining: remaining.count ?? 0, found });
}

/** Processes one job; returns how many candidates it added. Never throws — a failed chunk is
 * recorded on the job (and retried up to MAX_ATTEMPTS) rather than failing the whole request. */
async function runOneJob(
  db: ReturnType<typeof adminDb>,
  cookbookId: string,
  householdId: string,
  storagePath: string,
  job: { id: string; page_start: number; page_end: number; attempts: number },
): Promise<number> {
  await db.from("import_jobs").update({ status: "running" }).eq("id", job.id);

  try {
    const download = await db.storage.from("cookbooks").download(storagePath);
    if (download.error) throw download.error;
    const pdfBytes = new Uint8Array(await download.data.arrayBuffer());
    const chunkBytes = await sliceChunkPdf(pdfBytes, { pageStart: job.page_start, pageEnd: job.page_end });

    const extracted = await extractRecipesFromChunk(chunkBytes);

    const existingCandidates = await db
      .from("import_candidates")
      .select("recipe")
      .eq("cookbook_id", cookbookId)
      .eq("status", "pending");
    if (existingCandidates.error) throw existingCandidates.error;
    const existingTitles = (existingCandidates.data ?? []).map(
      (c) => (c.recipe as { title: string }).title,
    );

    // The 1-page chunk overlap means a recipe can appear in two consecutive chunks' results.
    const fresh = dedupeByTitle(extracted, existingTitles);
    if (fresh.length === 0) {
      await db.from("import_jobs").update({ status: "done" }).eq("id", job.id);
      return 0;
    }

    const householdRecipes = await db.from("recipes").select("id, title").eq("household_id", householdId);
    if (householdRecipes.error) throw householdRecipes.error;

    const rows = fresh.map((r) => ({
      cookbook_id: cookbookId,
      job_id: job.id,
      recipe: r,
      page: r.page != null ? job.page_start + r.page - 1 : null,
      duplicate_of: householdRecipes.data?.find((existing) => titlesMatch(existing.title, r.title))?.id ?? null,
    }));
    const inserted = await db.from("import_candidates").insert(rows);
    if (inserted.error) throw inserted.error;

    await db.from("import_jobs").update({ status: "done" }).eq("id", job.id);
    return fresh.length;
  } catch (e) {
    const attempts = job.attempts + 1;
    const message = e instanceof Error ? e.message : "Unknown error";
    await db
      .from("import_jobs")
      .update({ status: attempts < MAX_ATTEMPTS ? "queued" : "failed", attempts, error: message })
      .eq("id", job.id);
    return 0;
  }
}

async function finishCookbook(
  db: ReturnType<typeof adminDb>,
  cookbookId: string,
  title: string,
  householdId: string,
): Promise<void> {
  const count = await db
    .from("import_candidates")
    .select("id", { count: "exact", head: true })
    .eq("cookbook_id", cookbookId)
    .eq("status", "pending");
  if (count.error) throw count.error;

  await db.from("cookbooks").update({ status: "ready" }).eq("id", cookbookId);

  const recipients = await db.from("users").select("telegram_id").eq("household_id", householdId);
  if (recipients.error) throw recipients.error;

  const found = count.count ?? 0;
  const message =
    found > 0
      ? `📖 Import finished: "${title}" — ${found} recipe${found === 1 ? "" : "s"} found, ready to review.`
      : `📖 Import finished: "${title}" — no recipes found.`;

  const bot = getBot();
  await Promise.allSettled(
    recipients.data.map((r) =>
      bot.api.sendMessage(Number(r.telegram_id), message, {
        reply_markup: openAppKeyboard("Review recipes", `review_${cookbookId}`),
      }),
    ),
  );
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
