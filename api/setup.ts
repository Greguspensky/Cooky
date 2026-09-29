import { timingSafeEqual } from "node:crypto";
import { env } from "../lib/env.js";
import { getBot } from "../lib/bot.js";

/**
 * GET /api/setup?secret=<TELEGRAM_WEBHOOK_SECRET>
 * One-time (and idempotent) bot setup: points the webhook at this app, sets the menu
 * button to open the Mini App and registers the command list.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = new URL(request.url).searchParams.get("secret") ?? "";
  if (!safeEqual(secret, env.webhookSecret)) {
    return new Response("Not found", { status: 404 });
  }

  const api = getBot().api;
  const appUrl = env.miniAppUrl;
  const webhookUrl = `${appUrl}/api/bot`;

  await api.setWebhook(webhookUrl, {
    secret_token: env.webhookSecret,
    allowed_updates: ["message", "callback_query"],
  });
  await api.setChatMenuButton({
    menu_button: { type: "web_app", text: "Open", web_app: { url: appUrl } },
  });
  await api.setMyCommands([{ command: "start", description: "Open Cookie" }]);
  const info = await api.getWebhookInfo();

  return Response.json(
    {
      ok: true,
      miniAppUrl: appUrl,
      webhook: { url: info.url, pendingUpdates: info.pending_update_count, lastError: info.last_error_message ?? null },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
