import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, jwtVerify, decodeProtectedHeader } from "jose";
import { signSessionToken, verifySessionToken } from "./jwt.js";
import { signInitData } from "./initData.js";
import { POST as auth } from "../api/auth.js";

const BOT_TOKEN = "123456:TEST-token";
const claims = { userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", householdId: "hh", telegramId: 1 };
const saved = { ...process.env };

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.ALLOWED_TELEGRAM_IDS = "1,2";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  delete process.env.SUPABASE_JWT_SECRET;
  delete process.env.SUPABASE_JWT_PRIVATE_KEY;
});

afterEach(() => {
  process.env = { ...saved };
});

describe("signSessionToken", () => {
  it("signs HS256 with the legacy secret", async () => {
    process.env.SUPABASE_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters";
    const { token } = await signSessionToken(claims);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET), {
      audience: "authenticated",
    });
    expect(payload).toMatchObject({ sub: claims.userId, role: "authenticated", household_id: "hh" });
  });

  it("signs with an imported private JWK and sets kid", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    process.env.SUPABASE_JWT_PRIVATE_KEY = JSON.stringify({ ...(await exportJWK(privateKey)), alg: "ES256", kid: "k1" });
    const { token } = await signSessionToken(claims);
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "ES256", kid: "k1" });
    const { payload } = await jwtVerify(token, publicKey, { issuer: "https://example.supabase.co/auth/v1" });
    expect(payload.sub).toBe(claims.userId);
  });

  it("fails clearly when no key is configured", async () => {
    await expect(signSessionToken(claims)).rejects.toThrow(/SUPABASE_JWT_SECRET/);
  });
});

describe("verifySessionToken", () => {
  it("round-trips a token signed with the legacy secret", async () => {
    process.env.SUPABASE_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters";
    const { token } = await signSessionToken(claims);
    await expect(verifySessionToken(token)).resolves.toEqual(claims);
  });

  it("round-trips a token signed with an imported private key", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    process.env.SUPABASE_JWT_PRIVATE_KEY = JSON.stringify({ ...(await exportJWK(privateKey)), alg: "ES256", kid: "k1" });
    const { token } = await signSessionToken(claims);
    await expect(verifySessionToken(token)).resolves.toEqual(claims);
  });

  it("rejects a token signed with a different secret", async () => {
    process.env.SUPABASE_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters";
    const { token } = await signSessionToken(claims);
    process.env.SUPABASE_JWT_SECRET = "a-completely-different-secret-value-1234567890";
    await expect(verifySessionToken(token)).rejects.toThrow();
  });
});

describe("POST /api/auth", () => {
  const post = (body: unknown) =>
    auth(new Request("http://localhost/api/auth", { method: "POST", body: JSON.stringify(body) }));
  const authDate = () => String(Math.floor(Date.now() / 1000));

  it("rejects missing initData", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("rejects a bad signature", async () => {
    const initData = signInitData({ auth_date: authDate(), user: JSON.stringify({ id: 1, first_name: "A" }) }, "0:x");
    expect((await post({ initData })).status).toBe(401);
  });

  it("rejects users outside the allowlist", async () => {
    const initData = signInitData({ auth_date: authDate(), user: JSON.stringify({ id: 3, first_name: "C" }) }, BOT_TOKEN);
    const response = await post({ initData });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_allowed" });
  });
});
