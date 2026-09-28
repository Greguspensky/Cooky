// Prints signed Telegram initData for local development, so the app can be opened in a
// normal browser with `vercel dev` + `npm run dev`. Reads TELEGRAM_BOT_TOKEN and
// ALLOWED_TELEGRAM_IDS from .env and signs as the first allowlisted user.
//
// Usage: npm run dev:initdata  → copy the printed line into .env
import { createHmac } from "node:crypto";

const token = process.env.TELEGRAM_BOT_TOKEN;
const firstId = Number((process.env.ALLOWED_TELEGRAM_IDS ?? "").split(/[\s,]+/)[0]);
if (!token || !firstId) {
  console.error("Set TELEGRAM_BOT_TOKEN and ALLOWED_TELEGRAM_IDS in .env first.");
  process.exit(1);
}

const fields = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: "dev",
  user: JSON.stringify({ id: firstId, first_name: "Dev", language_code: "en" }),
};
const dataCheckString = Object.keys(fields)
  .sort()
  .map((key) => `${key}=${fields[key]}`)
  .join("\n");
const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

// Valid for 24 hours.
console.log(`VITE_DEV_INIT_DATA=${new URLSearchParams({ ...fields, hash })}`);
