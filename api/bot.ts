import { webhookCallback } from "grammy";
import { env } from "../lib/env.js";
import { getBot } from "../lib/bot.js";

let handle: ((request: Request) => Promise<Response>) | undefined;

/** POST /api/bot — Telegram webhook. Telegram sends the secret in a header; grammY checks it. */
export async function POST(request: Request): Promise<Response> {
  handle ??= webhookCallback(getBot(), "std/http", { secretToken: env.webhookSecret });
  return handle(request);
}
