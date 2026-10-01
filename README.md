# Cookie

A private Telegram Mini App and bot for one household: shared recipes, cookbook PDF import,
grocery lists, cooking mode, a cooking calendar, and an AI assistant. See the project plan for the
full spec (the calendar is an addition beyond the original plan).

**Status: phases 1–2, 4–6, plus a Calendar tab.** Recipes, shared grocery lists, step-by-step
cooking mode, a cooking assistant, and a calendar for scheduling and logging what's been cooked.
Phase 3 (cookbook import) is still skipped.

## Layout

| Path | What |
| --- | --- |
| `web/` | Mini App front end (Vite + React + TypeScript) |
| `api/` | Vercel serverless functions: `auth`, `bot` (Telegram webhook), `setup`, `lists/send`, `assistant/message`, `assistant/confirm` |
| `lib/` | Code shared by the server *and* the front end: env, initData validation, JWT, users, bot, the recipe/grocery/calendar types and helpers (`recipe.ts`, `grocery.ts`, `cookEntries.ts`), and the assistant core in `assistant/` |
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

Tools it can call: `search_recipes`, `get_recipe`, `get_preferences`, `open_in_app`,
`get_cook_entries` (the cooking calendar — "when did we last make X", "what's cooking Friday") run
immediately (read-only). `save_recipe`, `create_grocery_list`, `add_to_grocery_list`,
`schedule_dish` and `propose_preference_update` change data, so each one becomes a **pending
action** instead of running right away — you see a summary with Confirm/Cancel (inline buttons in
the bot, a card in the Mini App), and it expires after 15 minutes if you ignore it.
`search_cookbook_candidates` from the plan isn't included: it needs the cookbook importer
(phase 3), which is skipped for now.

`schedule_dish`'s default "today" is computed on the server (Vercel, which runs in UTC), not your
phone's timezone — it can be off by a day right around UTC midnight if you don't give it an
explicit date. Give an explicit `YYYY-MM-DD` for anything date-sensitive near that boundary; the
Calendar tab itself is unaffected, since it always uses your phone's own local date.

`propose_preference_update` only ever changes the preferences of whoever is chatting, never their
partner's, and only adds to your likes/dislikes rather than replacing them outright.

### How cooking mode works

**▶ Start cooking** on a recipe with steps opens one step per screen, at the servings shown on the
page. **Next step**/**Finish** is the MainButton; **‹ Previous** is an on-page button; Telegram's
BackButton exits cooking mode back to the recipe.

A step shows only the ingredients tagged to it in the Edit form's "Uses" chips. If a recipe has no
tagging at all, every step falls back to showing the full ingredient list; if some steps are tagged
and others aren't, an untagged step just shows none (it's assumed to genuinely need nothing new,
like "let it rest"). Tagging is optional — untagged recipes still work in cooking mode, just
without per-step filtering.

Each step can have an optional timer (set in minutes on the Edit form). Starting one adds it to a
tray that stays visible across every step, not just the one it was started on, so a "simmer 20 min"
timer from step 2 is still counting down when you're reading step 4. A finished timer triggers a
haptic and a short beep; multiple timers can run at once. Timers are only kept in the page's memory
— leaving cooking mode (or the app) clears them, there's no background/notification-based timer yet.

**💬 Ask the assistant** exits cooking mode and switches to the Assistant tab with a starter message
like `About "Lasagna", step 3 ("Bake for 20 min"): ` already typed in, so you just finish the
question (e.g. "what can I use instead of ricotta?").

The screen-wake-lock (keeping the phone's screen on) uses the standard browser API and is
best-effort: it works on Chromium-based clients (most Android Telegram) but may silently do nothing
on older WebKit-based ones (some iOS Telegram versions) — worth checking on both of your phones.

### How the calendar works

Not in the original plan — added afterward. One table, `cook_entries`, backs both the Calendar tab
and the "Cooking history" card on a recipe's page: a row dated today or earlier is immediately
**cooked** (fits logging something you've already made); a future-dated row is **planned**, shown
on the Calendar, until you tap **Mark cooked** on it (only offered once its date has arrived — a
plan that never happened doesn't inflate the count).

The Calendar tab is a month grid (dot = at least one entry that day) with the selected day's dishes
listed below it; **+ Add** searches your recipes and logs the pick for that day. A recipe's own page
shows how many times it's been cooked, its most recent date, and its last 5 dates, with shortcuts to
log it for today or schedule it for a future date.

Multiple dishes can be logged on the same day — there's no separate "meal type" (breakfast/lunch/
dinner) concept, just a list per day.

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
4. `supabase/migrations/0004_cook_entries.sql` — the `cook_entries` table backing the Calendar tab
   and each recipe's cooking history.

If you've already run the earlier ones, you only need to add whichever are new to you.

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
- [ ] Ask it to log a saved dish as cooked today; confirm it, then check the recipe's Cooking
      history and the Calendar tab both show it.
- [ ] Ask it "what's cooking [a day you've scheduled something for]"; confirm it answers correctly.

**Calendar:**
- [ ] On the Calendar tab, tap today, **+ Add**, and log a dish; confirm a dot appears on that day
      and the dish is listed below with a "Cooked" chip.
- [ ] Tap a future day, add a dish there; confirm it shows a "Planned" chip and no **Mark cooked**
      button yet (only offered once the date arrives).
- [ ] On a recipe's page, use **Log as cooked today** and **Schedule for later**; confirm the
      Cooking history count, last-cooked date and date list all update correctly.
- [ ] Add a dish from the Calendar tab on one phone; confirm it shows up for your wife too (it's
      shared household data, like grocery lists).

**Phase 5 (cooking mode):**
- [ ] Edit a recipe, tag a couple of ingredients to specific steps, and set a timer (minutes) on
      one step; save.
- [ ] Tap **▶ Start cooking**; confirm each step shows only its own tagged ingredients, and an
      untagged step shows none (not the full list).
- [ ] Start that step's timer, then move to a later step; confirm the timer tray is still visible
      and counting down. Let it finish and confirm you feel/hear the alert.
- [ ] Start cooking a recipe that has steps but no ingredient tagging at all; confirm every step
      shows the full ingredient list instead.
- [ ] Tap **💬 Ask the assistant** mid-recipe; confirm it switches to the Assistant tab with the
      recipe and step already typed into the message box.
- [ ] Leave the phone idle for a minute or two while cooking mode is open; check whether the screen
      stays on (note which of your two phones it works on, since this varies by platform).
- [ ] Tap **‹ Previous** and the phone's own back gesture/BackButton; confirm one moves a step back
      and the other exits cooking mode to the recipe.

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
