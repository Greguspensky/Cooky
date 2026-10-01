import Anthropic from "@anthropic-ai/sdk";
import { adminDb } from "../db.js";
import { env } from "../env.js";
import { loadContext } from "./context.js";
import { describeProposedAction } from "./format.js";
import { createPendingAction } from "./pendingActions.js";
import { executeReadTool } from "./readTools.js";
import { isWriteTool, TOOLS } from "./tools.js";

const MAX_TOOL_ITERATIONS = 4;
const HISTORY_LIMIT = 20;

const SYSTEM_PROMPT = `You are Cookie, a cooking assistant for a two-person household. You know their saved
recipes and taste preferences. When asked for meal ideas, always call search_recipes first and offer
matching saved recipes before suggesting anything new. If you suggest a new recipe from general
knowledge, say clearly that it isn't saved yet and offer to save it. Keep replies short and
conversational; this is a chat, not an essay. Never invent a recipe id — only use ids returned by
search_recipes or get_recipe. You also track a cooking calendar: use get_cook_entries for "when did
we last make X" or "what's cooking Friday", and schedule_dish to log a dish as cooked (today or a
past date) or to plan one for a future date. search_cookbook_candidates looks over recipes found in
imported cookbooks that haven't been added to the collection yet — distinct from search_recipes.`;

export interface AssistantTurnResult {
  conversationId: string;
  reply: string;
  pendingAction?: { id: string; prompt: string };
}

/**
 * Runs one turn of the assistant: loads shared history, lets Claude call read-only tools freely,
 * and turns the first write-tool call into a pending_action instead of executing it (plan §6).
 */
export async function runAssistantTurn(
  userId: string,
  householdId: string,
  channel: "app" | "bot",
  userText: string,
  conversationId?: string,
): Promise<AssistantTurnResult> {
  const ctx = await loadContext(userId, householdId);
  const convoId = conversationId ?? (await getOrCreateConversation(userId));

  const history = await loadHistory(convoId);
  await saveMessage(convoId, "user", [{ type: "text", text: userText }], channel);
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: userText }];

  const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
  let finalText = "";
  let pendingAction: AssistantTurnResult["pendingAction"];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: env.claudeModelMain,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const leadingText = textBlocks
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (toolUseBlocks.length === 0) {
      finalText = leadingText || "I'm not sure how to help with that — could you rephrase?";
      break;
    }

    // A write call always wins the round: we don't execute it, and we don't keep going on any
    // read calls made alongside it, to avoid applying half of a mixed batch inconsistently.
    const writeCall = toolUseBlocks.find((b) => isWriteTool(b.name));
    if (writeCall) {
      const action = await createPendingAction(
        userId,
        writeCall.name,
        writeCall.input as Record<string, unknown>,
        householdId,
      );
      const prompt = await describeProposedAction(writeCall.name, writeCall.input as Record<string, unknown>);
      finalText = [leadingText, prompt].filter(Boolean).join("\n\n");
      pendingAction = { id: action.id, prompt };
      break;
    }

    messages.push({ role: "assistant", content: response.content as unknown as Anthropic.ContentBlockParam[] });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolUseBlocks) {
      const result = await executeReadTool(call.name, call.input as Record<string, unknown>, ctx);
      toolResults.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });

    if (i === MAX_TOOL_ITERATIONS - 1) {
      finalText = leadingText || "I looked into that but couldn't quite finish — could you ask again?";
    }
  }

  await saveMessage(convoId, "assistant", [{ type: "text", text: finalText }], channel);
  return { conversationId: convoId, reply: finalText, pendingAction };
}

async function getOrCreateConversation(userId: string): Promise<string> {
  const db = adminDb();
  const existing = await db
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;

  const created = await db.from("conversations").insert({ user_id: userId }).select("id").single();
  if (created.error) throw created.error;
  return created.data.id;
}

async function loadHistory(conversationId: string): Promise<Anthropic.MessageParam[]> {
  const { data, error } = await adminDb()
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return (data ?? [])
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

async function saveMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: unknown,
  channel: "app" | "bot",
): Promise<void> {
  const db = adminDb();
  const { error } = await db.from("messages").insert({ conversation_id: conversationId, role, content, channel });
  if (error) throw error;
  await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
}
