import { runAssistantTurn } from "../../lib/assistant/core.js";
import { verifySessionToken } from "../../lib/jwt.js";

/**
 * POST /api/assistant/message  { message, conversationId? }
 * One turn of the Mini App chat. Shares history with the bot via the same conversations table.
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

  let body: { message?: unknown; conversationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof body.message !== "string" || !body.message.trim()) {
    return json({ error: "missing_message" }, 400);
  }

  const result = await runAssistantTurn(
    claims.userId,
    claims.householdId,
    "app",
    body.message.trim(),
    typeof body.conversationId === "string" ? body.conversationId : undefined,
  );
  return json(result);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
