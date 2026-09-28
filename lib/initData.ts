import { createHmac, timingSafeEqual } from "node:crypto";

// Validates Telegram.WebApp.initData as described in
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface ValidInitData {
  user: TelegramUser;
  authDate: Date;
  startParam?: string;
}

export class InitDataError extends Error {}

/** initData older than this is rejected. The app re-reads it on every launch. */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

export function validateInitData(
  initData: string,
  botToken: string,
  now: Date = new Date(),
): ValidInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new InitDataError("initData has no hash");

  // Every field except `hash` (including `signature`), sorted by key, joined with "\n".
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const received = Buffer.from(hash, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new InitDataError("initData signature is invalid");
  }

  const authDateSeconds = Number(params.get("auth_date"));
  if (!Number.isFinite(authDateSeconds) || authDateSeconds <= 0) {
    throw new InitDataError("initData has no auth_date");
  }
  const ageSeconds = now.getTime() / 1000 - authDateSeconds;
  if (ageSeconds > INIT_DATA_MAX_AGE_SECONDS) {
    throw new InitDataError("initData has expired; reopen the app");
  }

  const rawUser = params.get("user");
  if (!rawUser) throw new InitDataError("initData has no user");
  const user = JSON.parse(rawUser) as TelegramUser;
  if (!Number.isSafeInteger(user.id)) throw new InitDataError("initData user has no id");

  return {
    user,
    authDate: new Date(authDateSeconds * 1000),
    startParam: params.get("start_param") ?? undefined,
  };
}

/** Builds signed initData, for tests and local development only. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
