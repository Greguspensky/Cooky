import { Bot, InlineKeyboard } from "grammy";
import { env, isAllowed } from "./env.js";

export const PRIVATE_APP_MESSAGE =
  "Sorry, this is a private app for one household. It isn't open to other Telegram accounts.";

/** Inline button that opens the Mini App, optionally deep-linking via `startapp`. */
export function openAppKeyboard(text = "Open Cooky", startParam?: string): InlineKeyboard {
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
      `Hi ${name}! Cooky keeps your recipes, grocery lists and cookbooks in one place.\n\n` +
        "Tap the button below (or the menu button) to open the app.",
      { reply_markup: openAppKeyboard() },
    );
  });

  bot.on("message:document", async (ctx) => {
    await ctx.reply("Cookbook import is coming soon. For now, open the app:", {
      reply_markup: openAppKeyboard(),
    });
  });

  bot.on(["message:voice", "message:text"], async (ctx) => {
    await ctx.reply("The assistant isn't ready yet — it's coming in a later update. Open the app:", {
      reply_markup: openAppKeyboard(),
    });
  });

  return bot;
}
