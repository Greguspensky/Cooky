// Server-only configuration. Never import this from /web.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  get botToken() {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get webhookSecret() {
    return required("TELEGRAM_WEBHOOK_SECRET");
  },
  get allowedTelegramIds() {
    return parseAllowlist(required("ALLOWED_TELEGRAM_IDS"));
  },
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** Legacy HS256 secret (Supabase → Settings → JWT Keys → Legacy JWT secret). */
  get supabaseJwtSecret() {
    return process.env.SUPABASE_JWT_SECRET || undefined;
  },
  /** Private JWK (JSON) of a signing key imported into Supabase. Takes precedence over the legacy secret. */
  get supabaseJwtPrivateKey() {
    return process.env.SUPABASE_JWT_PRIVATE_KEY || undefined;
  },
  /**
   * Public URL of the Mini App. Defaults to this deployment's stable URL on Vercel:
   * the branch URL for previews, the production domain otherwise.
   */
  get miniAppUrl() {
    const explicit = process.env.MINI_APP_URL;
    if (explicit) return explicit.replace(/\/+$/, "");
    const host =
      process.env.VERCEL_ENV === "preview"
        ? process.env.VERCEL_BRANCH_URL
        : process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (!host) throw new Error("Missing environment variable MINI_APP_URL");
    return `https://${host}`;
  },
};

/** Parses "123, 456" into a set of Telegram user IDs. */
export function parseAllowlist(raw: string): Set<number> {
  const ids = raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => {
      const id = Number(part);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(`ALLOWED_TELEGRAM_IDS contains an invalid ID: "${part}"`);
      }
      return id;
    });
  return new Set(ids);
}

export function isAllowed(telegramId: number | undefined): telegramId is number {
  return telegramId !== undefined && env.allowedTelegramIds.has(telegramId);
}
