import { Bot, InlineKeyboard } from "grammy";
import { runAssistantTurn } from "./assistant/core.js";
import { cancelPendingAction, confirmPendingAction } from "./assistant/confirm.js";
import { env, isAllowed } from "./env.js";
import { ensureUser } from "./users.js";

export const PRIVATE_APP_MESSAGE =
  "Sorry, this is a private app for one household. It isn't open to other Telegram accounts.";

/** Inline button that opens the Mini App, optionally deep-linking via `startapp`. */
export function openAppKeyboard(text = "Open Cookie", startParam?: string): InlineKeyboard {
  const url = new URL(env.miniAppUrl);
  if (startParam) url.searchParams.set("startapp", startParam);
  return new InlineKeyboard().webApp(text, url.toString());
}

let bot: Bot | undefined;

export function getBot(): Bot {
  if (bot) return bot;
  bot = new Bot(env.botToken);

  // Allowlist: everything below this middleware only runs for the household.
  bot.use(async (ctx, next) => {
    if (isAllowed(ctx.from?.id)) return next();
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: PRIVATE_APP_MESSAGE, show_alert: true });
    } else if (ctx.chat?.type === "private") {
      await ctx.reply(PRIVATE_APP_MESSAGE);
    }
  });

  bot.command("start", async (ctx) => {
    const name = ctx.from?.first_name ?? "there";
    await ctx.reply(
      `Hi ${name}! Cookie keeps your recipes, grocery lists and cookbooks in one place.\n\n` +
        "Tap the button below (or the menu button) to open the app.",
      { reply_markup: openAppKeyboard() },
    );
  });

  bot.on("message:document", async (ctx) => {
    await ctx.reply("Cookbook import is coming soon. For now, open the app:", {
      reply_markup: openAppKeyboard(),
    });
  });

  bot.on("message:voice", async (ctx) => {
    await ctx.reply("Voice messages are coming in a later update — for now, type what you'd like.");
  });

  bot.on("message:text", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    const user = await ensureUser(ctx.from);
    const result = await runAssistantTurn(user.id, user.householdId, "bot", ctx.message.text);

    if (result.pendingAction) {
      const keyboard = new InlineKeyboard()
        .text("✅ Confirm", `assistant_confirm:${result.pendingAction.id}`)
        .text("❌ Cancel", `assistant_cancel:${result.pendingAction.id}`);
      await ctx.reply(result.reply, { reply_markup: keyboard });
    } else {
      await ctx.reply(result.reply);
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split(":");
    if (action !== "assistant_confirm" && action !== "assistant_cancel") return;

    const user = await ensureUser(ctx.from);
    const outcome =
      action === "assistant_confirm" ? await confirmPendingAction(id, user.id) : await cancelPendingAction(id, user.id);

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup(); // remove the buttons once acted on
    await ctx.reply(outcome.message);
  });

  return bot;
}
