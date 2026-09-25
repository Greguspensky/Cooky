import { env, isAllowed } from "../lib/env.js";
import { InitDataError, validateInitData } from "../lib/initData.js";
import { signSessionToken } from "../lib/jwt.js";
import { ensureUser } from "../lib/users.js";

/**
 * POST /api/auth  { initData }
 * Validates Telegram.WebApp.initData, checks the allowlist and returns a short-lived
 * Supabase access token plus the public Supabase config for the front end.
 */
export async function POST(request: Request): Promise<Response> {
  let initData: unknown;
  try {
    ({ initData } = (await request.json()) as { initData?: unknown });
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof initData !== "string" || !initData) {
    return json({ error: "missing_init_data" }, 400);
  }

  let tgUser;
  try {
    tgUser = validateInitData(initData, env.botToken).user;
  } catch (error) {
    if (error instanceof InitDataError) return json({ error: "invalid_init_data" }, 401);
    throw error;
  }

  if (!isAllowed(tgUser.id)) return json({ error: "not_allowed" }, 403);

  const user = await ensureUser(tgUser);
  const { token, expiresAt } = await signSessionToken({
    userId: user.id,
    householdId: user.householdId,
    telegramId: user.telegramId,
  });

  return json({
    token,
    expiresAt,
    user,
    supabase: { url: env.supabaseUrl, anonKey: env.supabaseAnonKey },
  });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
