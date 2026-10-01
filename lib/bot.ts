import { Bot, InlineKeyboard } from "grammy";
import { runAssistantTurn } from "./assistant/core.js";
import { cancelPendingAction, confirmPendingAction } from "./assistant/confirm.js";
import { startCookbookImport } from "./cookbookImport.js";
import { adminDb } from "./db.js";
import { env, isAllowed } from "./env.js";
import { ensureUser } from "./users.js";

/** Telegram's Bot API can only download files up to this size (plan §4.2). */
const MAX_BOT_DOWNLOAD_BYTES = 20 * 1024 * 1024;

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
    const doc = ctx.message.document;
    if (doc.mime_type !== "application/pdf") {
      await ctx.reply("I can only import PDF cookbooks right now.");
      return;
    }
    if (doc.file_size && doc.file_size > MAX_BOT_DOWNLOAD_BYTES) {
      await ctx.reply("That PDF is too large for me to download here (Telegram caps bots at 20 MB) — please upload it from the app's Import tab instead:", { reply_markup: openAppKeyboard() });
      return;
    }

    await ctx.replyWithChatAction("upload_document");
    const user = await ensureUser(ctx.from);
    const title = doc.file_name?.replace(/\.pdf$/i, "").trim() || "Untitled cookbook";

    const file = await ctx.api.getFile(doc.file_id);
    const response = await fetch(`https://api.telegram.org/file/bot${env.botToken}/${file.file_path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    const db = adminDb();
    const cookbook = await db
      .from("cookbooks")
      .insert({ household_id: user.householdId, title, storage_path: "", uploaded_by: user.id })
      .select("id")
      .single();
    if (cookbook.error) throw cookbook.error;

    const path = `${user.householdId}/${cookbook.data.id}.pdf`;
    const upload = await db.storage.from("cookbooks").upload(path, bytes, { contentType: "application/pdf" });
    if (upload.error) throw upload.error;
    await db.from("cookbooks").update({ storage_path: path }).eq("id", cookbook.data.id);

    const { jobCount } = await startCookbookImport(db, cookbook.data.id);
    if (jobCount === 0) {
      await ctx.reply(`"${title}" doesn't seem to have any pages I could read.`);
      return;
    }

    await ctx.reply(
      `Got it — importing "${title}" (${jobCount} chunk${jobCount === 1 ? "" : "s"} to process). Open the app to run the import and review the recipes it finds:`,
      { reply_markup: openAppKeyboard("Open Cookie", `review_${cookbook.data.id}`) },
    );
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
