import { adminDb } from "../db.js";
import { describeAppliedAction } from "./format.js";
import { getPendingAction, setPendingActionStatus } from "./pendingActions.js";
import { applyWriteTool } from "./writeTools.js";

export type ConfirmOutcome =
  | { status: "applied"; message: string }
  | { status: "cancelled"; message: string }
  | { status: "not_found" | "expired" | "already_handled" | "forbidden"; message: string };

/** Only the person who triggered a proposal can confirm or cancel it. */
export async function confirmPendingAction(id: string, requestingUserId: string): Promise<ConfirmOutcome> {
  const action = await getPendingAction(id);
  if (!action) return { status: "not_found", message: "I couldn't find that suggestion anymore." };
  if (action.user_id !== requestingUserId) return { status: "forbidden", message: "That wasn't your suggestion to confirm." };
  if (action.status === "expired") return { status: "expired", message: "That suggestion expired after 15 minutes — ask me again?" };
  if (action.status !== "pending") return { status: "already_handled", message: "That's already been handled." };

  const result = await applyWriteTool(action);
  await setPendingActionStatus(id, "confirmed");
  const message = describeAppliedAction(action.action_type, result);
  await appendAssistantNote(requestingUserId, message);
  return { status: "applied", message };
}

export async function cancelPendingAction(id: string, requestingUserId: string): Promise<ConfirmOutcome> {
  const action = await getPendingAction(id);
  if (!action) return { status: "not_found", message: "I couldn't find that suggestion anymore." };
  if (action.user_id !== requestingUserId) return { status: "forbidden", message: "That wasn't your suggestion to cancel." };
  if (action.status !== "pending") return { status: "already_handled", message: "That's already been handled." };

  await setPendingActionStatus(id, "cancelled");
  const message = "Okay, cancelled.";
  await appendAssistantNote(requestingUserId, message);
  return { status: "cancelled", message };
}

async function appendAssistantNote(userId: string, text: string): Promise<void> {
  const db = adminDb();
  const convo = await db
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!convo.data) return;
  await db.from("messages").insert({
    conversation_id: convo.data.id,
    role: "assistant",
    content: [{ type: "text", text }],
    channel: "app",
  });
}
