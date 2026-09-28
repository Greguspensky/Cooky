# Cooky

A private Telegram Mini App and bot for one household: shared recipes, cookbook PDF import,
grocery lists, cooking mode and an AI assistant. See the project plan for the full spec.

**Status: phase 1 (foundation).** Both allowlisted people can open an (empty) app from the bot;
nobody else can.

## Layout

| Path | What |
| --- | --- |
| `web/` | Mini App front end (Vite + React + TypeScript) |
| `api/` | Vercel serverless functions: `auth`, `bot` (Telegram webhook), `setup` |
| `lib/` | Server code shared by the functions: env, initData validation, JWT, users, bot |
| `supabase/migrations/` | SQL schema with row level security |
| `scripts/` | Local helpers (dev initData, signing key) |

### How login works

1. The Mini App posts `Telegram.WebApp.initData` to `POST /api/auth`.
2. The server checks Telegram's HMAC signature with the bot token, that it's under 24 hours old,
   and that the user is in `ALLOWED_TELEGRAM_IDS`. Otherwise it answers 403 and the app shows
   "Private app".
3. The first allowlisted user to open the app creates the household; the second joins it.
4. The server returns a 1-hour Supabase JWT with `sub` = user id and a `household_id` claim.
   Row level security scopes every table to that household. The app refreshes the token
   automatically.

The bot rejects anyone outside the allowlist before any handler runs.

## Setup (one time)

### 1. Supabase schema

Supabase → **SQL Editor** → New query → paste `supabase/migrations/0001_init.sql` → **Run**.

It creates all tables from the plan, RLS policies, full-text search on recipes, Realtime for
grocery items and a private `cookbooks` storage bucket.

### 2. Supabase JWT

`/api/auth` signs tokens that Supabase must accept. Open Supabase → **Settings → JWT Keys**:

- **If there's a "Legacy JWT Secret" tab with a secret:** copy it into `SUPABASE_JWT_SECRET`.
- **If not:** run `npm install && npm run gen:signing-key` on your computer. Paste the printed JSON
  into Supabase → JWT Keys → **Import** (as a new signing key), and paste the same JSON (one line)
  into the Vercel variable `SUPABASE_JWT_PRIVATE_KEY`. Check that its `kid` appears at
  `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`; if it doesn't, rotate to make it
  the current key.

Set only one of the two. If it's wrong, the app still opens, but the **Household** card on the
Recipes tab shows "Database check failed".

### 3. Vercel environment variables

Vercel → Project → **Settings → Environment Variables** (Production and Preview):

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random string of letters, digits, `_` or `-`, e.g. `openssl rand -hex 32` |
| `ALLOWED_TELEGRAM_IDS` | Both Telegram user IDs, comma-separated |
| `SUPABASE_URL` | Supabase → Settings → Data API |
| `SUPABASE_ANON_KEY` | anon / publishable key (it's sent to the browser; that's fine) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key (server only) |
| `SUPABASE_JWT_SECRET` or `SUPABASE_JWT_PRIVATE_KEY` | See step 2 |
| `MINI_APP_URL` | Optional. Defaults to the production domain (or the branch URL on previews) |

The Anthropic and OpenAI keys aren't needed until later phases. Redeploy after changing variables.

### 4. Register the bot

After deploying, open once in a browser:

```
https://<your-app>.vercel.app/api/setup?secret=<TELEGRAM_WEBHOOK_SECRET>
```

It sets the webhook to `<app>/api/bot`, the chat menu button to open the Mini App, and the
`/start` command. It returns JSON with the webhook status. Safe to run again.

A bot has only one webhook, so calling `/api/setup` on a preview deployment moves the bot to that
preview. Call it on production again afterwards.

**Previews:** Vercel protects preview deployments with a login by default, which Telegram can't
pass. To test a preview inside Telegram, turn off Vercel → Settings → **Deployment Protection**
for previews, or test after merging to production.

Optional: in @BotFather, `/newapp` creates a `t.me/<bot>/<app>` link for sharing and deep links.

### 5. Test on a phone

- [ ] You and your wife: `/start` in the bot replies with an **Open Cooky** button.
- [ ] The menu button and the Open button both open the app and show your name.
- [ ] The **Household** card lists both of you (proves the JWT and RLS work).
- [ ] The app follows Telegram's light/dark theme.
- [ ] Any other account: the bot replies "private app", and the Mini App shows **Private app**.

## Local development

```sh
npm install
npm test            # unit tests
npm run typecheck
npm run build
```

To run the full stack in a browser, create `.env` from `.env.example`, then:

```sh
npm run dev:initdata   # prints VITE_DEV_INIT_DATA=… (valid 24h); add it to .env
npx vercel link        # once: connect this folder to the Vercel project
npx vercel dev         # serves /api on :3000
npm run dev            # front end on :5173, proxies /api to :3000
```

Outside Telegram the app uses that signed test data to log in as the first allowlisted user.
