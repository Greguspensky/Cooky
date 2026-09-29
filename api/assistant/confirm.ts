import { cancelPendingAction, confirmPendingAction } from "../../lib/assistant/confirm.js";
import { verifySessionToken } from "../../lib/jwt.js";

/**
 * POST /api/assistant/confirm  { pendingActionId, action: "confirm" | "cancel" }
 * Backs the Mini App's confirmation card (bot confirmations go through callback_query instead).
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

  let body: { pendingActionId?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof body.pendingActionId !== "string" || (body.action !== "confirm" && body.action !== "cancel")) {
    return json({ error: "bad_request" }, 400);
  }

  const outcome =
    body.action === "confirm"
      ? await confirmPendingAction(body.pendingActionId, claims.userId)
      : await cancelPendingAction(body.pendingActionId, claims.userId);

  return json(outcome);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
