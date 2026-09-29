import { SignJWT, importJWK, jwtVerify, type JWK } from "jose";
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

/**
 * Verifies a session token this server issued, for /api endpoints the Mini App calls with its
 * Supabase access token (e.g. "send this list to chat") instead of going straight to Supabase.
 * Supabase itself never sees this call, so this checks the same key signSessionToken used.
 */
export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const privateJwk = env.supabaseJwtPrivateKey;
  const { payload } = privateJwk
    ? await jwtVerify(token, await importJWK(toPublicJwk(JSON.parse(privateJwk) as JWK)))
    : await jwtVerify(token, new TextEncoder().encode(requireSecret()), { algorithms: ["HS256"] });

  if (typeof payload.sub !== "string" || typeof payload.household_id !== "string") {
    throw new Error("Session token is missing required claims");
  }
  return {
    userId: payload.sub,
    householdId: payload.household_id,
    telegramId: Number(payload.telegram_id),
  };
}

/** Verifying only needs the public half of a signing key; jose's EC verify rejects a private one. */
function toPublicJwk(jwk: JWK): JWK {
  const { d: _privateExponent, ...publicJwk } = jwk;
  return publicJwk;
}

function requireSecret(): string {
  const secret = env.supabaseJwtSecret;
  if (!secret) throw new Error("Set SUPABASE_JWT_SECRET (legacy secret) or SUPABASE_JWT_PRIVATE_KEY");
  return secret;
}
