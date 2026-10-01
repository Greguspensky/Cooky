import { adminDb } from "../../lib/db.js";
import { startCookbookImport } from "../../lib/cookbookImport.js";
import { verifySessionToken } from "../../lib/jwt.js";

/**
 * POST /api/cookbooks/start  { cookbookId }
 * Called once the PDF has finished uploading to Storage: splits it into chunks and queues one
 * import_job per chunk. Processing those jobs is a separate step (run-job.ts), driven by the
 * Mini App while it's open.
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
  const cookbook = await db.from("cookbooks").select("household_id").eq("id", cookbookId).maybeSingle();
  if (cookbook.error) throw cookbook.error;
  if (!cookbook.data || cookbook.data.household_id !== claims.householdId) {
    return json({ error: "not_found" }, 404);
  }

  const { jobCount } = await startCookbookImport(db, cookbookId);
  return json({ jobCount });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
