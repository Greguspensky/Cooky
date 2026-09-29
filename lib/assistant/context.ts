import { adminDb } from "../db.js";

export interface AssistantContext {
  householdId: string;
  userId: string;
  /** The other household member, if they've opened the app yet. */
  partnerId: string | null;
}

export async function loadContext(userId: string, householdId: string): Promise<AssistantContext> {
  const { data, error } = await adminDb()
    .from("users")
    .select("id")
    .eq("household_id", householdId)
    .neq("id", userId);
  if (error) throw error;
  return { householdId, userId, partnerId: data[0]?.id ?? null };
}

/** Resolves the tool-facing "me" / "partner" / "either" language to an actual user id, or undefined for "either". */
export function resolveWho(ctx: AssistantContext, who: string | undefined): string | undefined {
  if (who === "partner") return ctx.partnerId ?? undefined;
  if (who === "me") return ctx.userId;
  return undefined;
}
