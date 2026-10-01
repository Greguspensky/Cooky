import { adminDb } from "../../lib/db.js";
import { verifySessionToken } from "../../lib/jwt.js";

/**
 * POST /api/cookbooks/upload-url  { title }
 * Registers a new cookbook and issues a signed Supabase Storage upload URL, so the PDF goes
 * straight from the Mini App to Storage without passing through a serverless function body
 * (plan §4.2 — avoids Vercel's request body size limit).
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

  let title: unknown;
  try {
    ({ title } = (await request.json()) as { title?: unknown });
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof title !== "string" || !title.trim()) return json({ error: "missing_title" }, 400);

  const db = adminDb();
  const cookbook = await db
    .from("cookbooks")
    .insert({ household_id: claims.householdId, title: title.trim(), storage_path: "", uploaded_by: claims.userId })
    .select("id")
    .single();
  if (cookbook.error) throw cookbook.error;

  const path = `${claims.householdId}/${cookbook.data.id}.pdf`;
  const signed = await db.storage.from("cookbooks").createSignedUploadUrl(path);
  if (signed.error) throw signed.error;

  const update = await db.from("cookbooks").update({ storage_path: path }).eq("id", cookbook.data.id);
  if (update.error) throw update.error;

  return json({ cookbookId: cookbook.data.id, path, token: signed.data.token });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
