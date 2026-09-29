import { adminDb } from "../db.js";

export interface PendingActionPayload {
  input: Record<string, unknown>;
  householdId: string;
}

export interface PendingAction {
  id: string;
  user_id: string;
  action_type: string;
  payload: PendingActionPayload;
  status: "pending" | "confirmed" | "cancelled" | "expired";
  expires_at: string;
}

export async function createPendingAction(
  userId: string,
  toolName: string,
  input: Record<string, unknown>,
  householdId: string,
): Promise<PendingAction> {
  const { data, error } = await adminDb()
    .from("pending_actions")
    .insert({ user_id: userId, action_type: toolName, payload: { input, householdId } })
    .select()
    .single();
  if (error) throw error;
  return data as PendingAction;
}

/** Fetches a pending action, first lazily expiring it if its 15-minute window has passed. */
export async function getPendingAction(id: string): Promise<PendingAction | null> {
  const db = adminDb();
  const { data, error } = await db.from("pending_actions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  if (data.status === "pending" && new Date(data.expires_at).getTime() < Date.now()) {
    await db.from("pending_actions").update({ status: "expired" }).eq("id", id);
    return { ...(data as PendingAction), status: "expired" };
  }
  return data as PendingAction;
}

export async function setPendingActionStatus(
  id: string,
  status: "confirmed" | "cancelled",
): Promise<void> {
  const { error } = await adminDb().from("pending_actions").update({ status }).eq("id", id);
  if (error) throw error;
}
