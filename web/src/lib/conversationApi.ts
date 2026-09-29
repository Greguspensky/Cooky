import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}

/** Loads the user's ongoing conversation (shared with the bot) plus any action still awaiting confirmation. */
export async function loadLatestConversation(
  db: SupabaseClient,
): Promise<{ conversationId: string | null; messages: ChatMessage[]; pendingActionId: string | null }> {
  const convo = await db.from("conversations").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (convo.error) throw convo.error;
  if (!convo.data) return { conversationId: null, messages: [], pendingActionId: null };

  const msgs = await db
    .from("messages")
    .select("id, role, content")
    .eq("conversation_id", convo.data.id)
    .order("created_at", { ascending: true });
  if (msgs.error) throw msgs.error;

  const messages: ChatMessage[] = (msgs.data ?? []).map((m) => ({ id: m.id, role: m.role, text: extractText(m.content) }));

  const pending = await db
    .from("pending_actions")
    .select("id, expires_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pendingActionId =
    pending.data && new Date(pending.data.expires_at).getTime() > Date.now() ? pending.data.id : null;

  return { conversationId: convo.data.id, messages, pendingActionId };
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
}
