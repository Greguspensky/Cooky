import { SignJWT, importJWK, type JWK } from "jose";
import { env } from "./env.js";

export const SESSION_TTL_SECONDS = 60 * 60;

export interface SessionClaims {
  userId: string;
  householdId: string;
  telegramId: number;
}

/**
 * Issues a Supabase-compatible access token. RLS policies read `sub` (via auth.uid())
 * and the custom `household_id` claim.
 *
 * Signs with SUPABASE_JWT_PRIVATE_KEY (a signing key imported into Supabase) when set,
 * otherwise with the legacy HS256 SUPABASE_JWT_SECRET.
 */
export async function signSessionToken(
  claims: SessionClaims,
): Promise<{ token: string; expiresAt: number }> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const jwt = new SignJWT({
    role: "authenticated",
    household_id: claims.householdId,
    telegram_id: claims.telegramId,
  })
    .setSubject(claims.userId)
    .setAudience("authenticated")
    .setIssuer(`${env.supabaseUrl}/auth/v1`)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt);

  const privateJwk = env.supabaseJwtPrivateKey;
  if (privateJwk) {
    const jwk = JSON.parse(privateJwk) as JWK;
    if (!jwk.alg || !jwk.kid) {
      throw new Error("SUPABASE_JWT_PRIVATE_KEY must be a JWK with `alg` and `kid`");
    }
    const key = await importJWK(jwk, jwk.alg);
    jwt.setProtectedHeader({ alg: jwk.alg, kid: jwk.kid, typ: "JWT" });
    return { token: await jwt.sign(key), expiresAt };
  }

  const secret = env.supabaseJwtSecret;
  if (!secret) {
    throw new Error("Set SUPABASE_JWT_SECRET (legacy secret) or SUPABASE_JWT_PRIVATE_KEY");
  }
  jwt.setProtectedHeader({ alg: "HS256", typ: "JWT" });
  return { token: await jwt.sign(new TextEncoder().encode(secret)), expiresAt };
}
