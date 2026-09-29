# Cookie

A private Telegram Mini App and bot for one household: shared recipes, cookbook PDF import,
grocery lists, cooking mode and an AI assistant. See the project plan for the full spec.

**Status: phase 6 (assistant).** Recipes, favorites and shared grocery lists from phase 4, plus a
cooking assistant in both the bot and the Mini App, with shared history between the two. Phases 3
(cookbook import) and 5 (cooking mode) are skipped for now.

## Layout

| Path | What |
| --- | --- |
| `web/` | Mini App front end (Vite + React + TypeScript) |
| `api/` | Vercel serverless functions: `auth`, `bot` (Telegram webhook), `setup`, `lists/send`, `assistant/message`, `assistant/confirm` |
| `lib/` | Code shared by the server *and* the front end: env, initData validation, JWT, users, bot, the recipe/grocery types and helpers (`recipe.ts`, `grocery.ts`), and the assistant core in `assistant/` |
| `supabase/migrations/` | SQL schema, storage buckets and RLS, applied in order |
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

### How grocery lists work

Recipe CRUD and grocery-list edits go straight from the browser to Supabase, scoped by RLS, same
as recipes. "Send to chat" is the one exception: it needs the bot token, so the Mini App calls
`POST /api/lists/send` with its Supabase access token in an `Authorization: Bearer` header, and
the server verifies that token itself (`verifySessionToken` in `lib/jwt.ts`) before using the
service role to fetch the list and message both of your Telegram chats.

Ingredient merging is exact-match only (same name and unit, case-insensitive) — "2 cloves garlic"
and "1 tsp minced garlic" stay as two lines rather than being guessed into one. The plan's
LLM-assisted fuzzy merge arrives with the assistant (phase 6), which needs `ANTHROPIC_API_KEY`
anyway. Each item's store aisle is a keyword guess (`guessStoreSection` in `lib/grocery.ts`,
English-only for now); tap its dropdown to fix a wrong guess.

### How the assistant works

One conversation history per person, shared between the bot and the Mini App (`conversations` /
`messages`), so you can start asking in one and keep going in the other. The assistant always
searches your saved recipes first and says clearly when it's suggesting something new instead.

Tools it can call: `search_recipes`, `get_recipe`, `get_preferences`, `open_in_app` run immediately
(read-only). `save_recipe`, `create_grocery_list`, `add_to_grocery_list` and
`propose_preference_update` change data, so each one becomes a **pending action** instead of
running right away — you see a summary with Confirm/Cancel (inline buttons in the bot, a card in
the Mini App), and it expires after 15 minutes if you ignore it. `search_cookbook_candidates` from
the plan isn't included: it needs the cookbook importer (phase 3), which is skipped for now.

`propose_preference_update` only ever changes the preferences of whoever is chatting, never their
partner's, and only adds to your likes/dislikes rather than replacing them outright.

## Setup (one time)

### 1. Supabase schema

Supabase → **SQL Editor** → New query → paste each file below **in order**, running each before
pasting the next:

1. `supabase/migrations/0001_init.sql` — all tables from the plan, RLS policies, full-text search
   on recipes, Realtime for grocery items and a private `cookbooks` storage bucket.
2. `supabase/migrations/0002_recipe_photos.sql` — a private `recipe-photos` storage bucket for
   photos of dishes you've cooked, scoped to your household.
3. `supabase/migrations/0003_recipe_total_minutes.sql` — a generated `total_minutes` column
   (prep + cook time), used by the "under N minutes" filter.

If you already ran `0001_init.sql` for phase 1, you only need to add `0002` and `0003` now.

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
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `CLAUDE_MODEL_MAIN` | A current Claude model id, e.g. `claude-sonnet-5` — check Anthropic's docs for the latest, since names change over time |
| `MINI_APP_URL` | Optional. Defaults to the production domain (or the branch URL on previews) |

The OpenAI key isn't needed until phase 7 (voice). Redeploy after changing variables.

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

**Phase 1 (foundation):**
- [ ] You and your wife: `/start` in the bot replies with an **Open Cookie** button.
- [ ] The menu button and the Open button both open the app and show your name.
- [ ] The app follows Telegram's light/dark theme.
- [ ] Any other account: the bot replies "private app", and the Mini App shows **Private app**.

**Phase 2 (recipes):**
- [ ] Add a recipe with a few ingredients and steps; it shows up in the list.
- [ ] Search by a word from the title, then by a word from an ingredient.
- [ ] Filter by cuisine, by tag, by "under 30 min", and by favorites; each narrows the list.
- [ ] Favorite a recipe and rate it on your phone; open the app on your wife's phone and confirm
      her card shows *your* heart/stars, and vice versa.
- [ ] Open a recipe, change the servings, and check the ingredient quantities scale.
- [ ] Tap the photo area on a recipe you've cooked, take or pick a photo, and confirm it shows on
      both the detail screen and the list card.
- [ ] Edit a recipe and confirm the changes stick; delete a test recipe and confirm it's gone.
- [ ] Once you have more than 20 recipes, confirm **Load more** appears and works.

**Phase 4 (grocery lists):**
- [ ] From Lists → "+ New list", pick two recipes, adjust one's servings, and create the list.
- [ ] Confirm an ingredient shared by both recipes (at matching servings) merges into one line
      with the summed quantity.
- [ ] Check an item off on your phone; confirm it updates live on your wife's phone without
      reopening the list (Realtime).
- [ ] Add a manual item and confirm it lands in a sensible aisle; correct one item's aisle with
      its dropdown.
- [ ] Delete an item, then tap **Send to chat** and confirm the bot messages both of your chats
      with the list, grouped by aisle.
- [ ] Tap **Mark as done**; confirm it moves to the "Done" section on the Lists tab, and
      **Reopen** brings it back.
- [ ] On a recipe's page, tap **+ Add to list** and add it to an existing active list; confirm the
      ingredients land there at the servings shown on the page.
- [ ] From the same panel, add a recipe as a **new list** and confirm it's named after the recipe.

**Phase 6 (assistant):**
- [ ] In the bot, ask "what can I make with [an ingredient from a saved recipe]?" — it should
      mention that saved recipe by name before suggesting anything new.
- [ ] Ask it to suggest something new; it should say clearly that it isn't saved yet.
- [ ] Ask it to save that suggestion. Confirm you get Confirm/Cancel buttons in the bot, and
      tapping **Confirm** adds it to your Recipes tab.
- [ ] Start a conversation in the bot, then open the Assistant tab in the Mini App and confirm
      the same messages are there; reply from the app and check the bot sees it too.
- [ ] Ask it to build a grocery list from two saved recipes; confirm, then check the list appears
      under Lists.
- [ ] Tell it "I don't like cilantro"; confirm the preference update, then ask it "what do I not
      like?" and confirm it remembers.
- [ ] Ask for something, then leave the confirmation unanswered for 15+ minutes; confirm it says
      the suggestion expired rather than going ahead.

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
Since there's no native Telegram UI in a plain browser, a small on-page bar stands in for the
MainButton/BackButton ("Save", "+ Add recipe", "← Back") so you can still add and edit recipes
locally. It never appears when the app is actually running inside Telegram.
