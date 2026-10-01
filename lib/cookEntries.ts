// Shared cook-log/calendar domain types and pure helpers. No imports, no side effects, so this
// file is safe to import from both /web (browser bundle) and /api (server).

export type CookEntryStatus = "planned" | "cooked";

export interface CookEntry {
  id: string;
  household_id: string;
  recipe_id: string;
  /** Local calendar date, "YYYY-MM-DD" — not a timestamp, so there's no timezone to get wrong. */
  entry_date: string;
  status: CookEntryStatus;
  created_by: string | null;
  created_at: string;
}

/** The household's local calendar date, as "YYYY-MM-DD". Deliberately not toISOString(), which
 * is UTC and can land on the wrong day near midnight. */
export function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A date logged for today or earlier is immediately "cooked" (fits logging something you've
 * already made); a future date is just a "planned" entry until it's confirmed later.
 */
export function statusForDate(entryDate: string, today: Date = new Date()): CookEntryStatus {
  return entryDate <= toLocalISODate(today) ? "cooked" : "planned";
}

/**
 * A 6-row, 7-column grid of local dates covering the given month, padded with the trailing days
 * of the previous month and the leading days of the next — the usual calendar-grid shape.
 * `month` is 0-indexed (0 = January), matching `Date`.
 */
export function buildMonthGrid(year: number, month: number): Date[][] {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const gridStart = new Date(year, month, 1 - startOffset);

  const weeks: Date[][] = [];
  for (let week = 0; week < 6; week++) {
    const days: Date[] = [];
    for (let day = 0; day < 7; day++) {
      days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + week * 7 + day));
    }
    weeks.push(days);
  }
  return weeks;
}
