// Generates an ES256 key pair for Supabase "JWT signing keys" (only needed if your project
// has no legacy JWT secret; see README → Supabase JWT).
//
// Usage: npm run gen:signing-key
//   1. Supabase → Settings → JWT Keys → "Import signing key": paste the private JWK.
//   2. Vercel env var SUPABASE_JWT_PRIVATE_KEY: paste the same private JWK (one line).
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), alg: "ES256", kid: randomUUID(), use: "sig" };
console.log(JSON.stringify(jwk));
