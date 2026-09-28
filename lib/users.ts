import { adminDb } from "./db.js";
import type { TelegramUser } from "./initData.js";

export interface AppUser {
  id: string;
  householdId: string;
  householdName: string;
  telegramId: number;
  displayName: string;
}

const DEFAULT_HOUSEHOLD_NAME = "Our kitchen";

function displayNameOf(user: Pick<TelegramUser, "first_name" | "last_name">): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "Cook";
}

/**
 * Finds or creates the app user for an allowlisted Telegram account. The app has a single
 * household: the first allowlisted person to open it creates it, the second one joins it.
 * Call only after the allowlist check.
 */
export async function ensureUser(tg: TelegramUser): Promise<AppUser> {
  const db = adminDb();

  const existing = await db
    .from("users")
    .select("id, household_id, telegram_id, display_name, households(name)")
    .eq("telegram_id", tg.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const row = existing.data as unknown as UserRow;
    return toAppUser(row);
  }

  const householdId = await getOrCreateHouseholdId();
  const inserted = await db
    .from("users")
    .upsert(
      {
        household_id: householdId,
        telegram_id: tg.id,
        display_name: displayNameOf(tg),
        locale: tg.language_code ?? null,
        photo_url: tg.photo_url ?? null,
      },
      { onConflict: "telegram_id" },
    )
    .select("id, household_id, telegram_id, display_name, households(name)")
    .single();
  if (inserted.error) throw inserted.error;
  return toAppUser(inserted.data as unknown as UserRow);
}

interface UserRow {
  id: string;
  household_id: string;
  telegram_id: number;
  display_name: string;
  households: { name: string } | null;
}

function toAppUser(row: UserRow): AppUser {
  return {
    id: row.id,
    householdId: row.household_id,
    householdName: row.households?.name ?? DEFAULT_HOUSEHOLD_NAME,
    telegramId: Number(row.telegram_id),
    displayName: row.display_name,
  };
}

async function getOrCreateHouseholdId(): Promise<string> {
  const db = adminDb();
  const found = await db
    .from("households")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return found.data.id as string;

  const created = await db
    .from("households")
    .insert({ name: DEFAULT_HOUSEHOLD_NAME })
    .select("id")
    .single();
  // The schema allows one household; if both of you opened the app at the same moment,
  // the other request created it first.
  if (created.error?.code === "23505") return getOrCreateHouseholdId();
  if (created.error) throw created.error;
  return created.data.id as string;
}
