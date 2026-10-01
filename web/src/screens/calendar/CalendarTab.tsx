import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMonthGrid, toLocalISODate } from "../../../../lib/cookEntries";
import {
  addCookEntry,
  deleteCookEntry,
  listCookEntriesForDate,
  listCookEntriesInRange,
  markCookEntryCooked,
  type CookEntryWithRecipeTitle,
} from "../../lib/cookEntriesApi";
import { listRecipes, type RecipeWithMeta } from "../../lib/recipesApi";
import { haptic } from "../../telegram";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABEL = (d: Date) => d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
const DAY_LABEL = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

export function CalendarTab({
  db,
  householdId,
  myUserId,
}: {
  db: SupabaseClient;
  householdId: string;
  myUserId: string;
}) {
  const today = useMemo(() => new Date(), []);
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);
  const [countsByDate, setCountsByDate] = useState<Map<string, number>>(new Map());
  const [dayEntries, setDayEntries] = useState<CookEntryWithRecipeTitle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recipeResults, setRecipeResults] = useState<RecipeWithMeta[]>([]);

  const grid = useMemo(() => buildMonthGrid(monthDate.getFullYear(), monthDate.getMonth()), [monthDate]);
  const selectedISO = toLocalISODate(selectedDate);
  const todayISO = toLocalISODate(today);

  function reloadGrid() {
    const from = toLocalISODate(grid[0][0]);
    const to = toLocalISODate(grid[5][6]);
    listCookEntriesInRange(db, from, to)
      .then((entries) => {
        const counts = new Map<string, number>();
        for (const e of entries) counts.set(e.entry_date, (counts.get(e.entry_date) ?? 0) + 1);
        setCountsByDate(counts);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the calendar."));
  }

  function reloadDay() {
    listCookEntriesForDate(db, selectedISO)
      .then(setDayEntries)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load that day."));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reloadGrid, [db, grid]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reloadDay, [db, selectedISO]);

  useEffect(() => {
    if (!pickerOpen) return;
    const t = setTimeout(() => {
      listRecipes(db, { search, cuisine: null, tag: null, favorites: "any", maxMinutes: null, sort: "newest" }, myUserId, null, 0)
        .then(({ rows }) => setRecipeResults(rows))
        .catch(() => setRecipeResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [db, myUserId, pickerOpen, search]);

  async function pickRecipe(recipeId: string) {
    try {
      await addCookEntry(db, householdId, myUserId, recipeId, selectedISO);
      haptic("success");
      setPickerOpen(false);
      setSearch("");
      reloadDay();
      reloadGrid();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that.");
    }
  }

  async function markCooked(entryId: string) {
    haptic("tap");
    await markCookEntryCooked(db, entryId).catch((e) => setError(e instanceof Error ? e.message : "Couldn't update that."));
    reloadDay();
  }

  async function removeEntry(entryId: string) {
    await deleteCookEntry(db, entryId).catch((e) => setError(e instanceof Error ? e.message : "Couldn't remove that."));
    reloadDay();
    reloadGrid();
  }

  function changeMonth(delta: number) {
    haptic("tap");
    setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  return (
    <div className="screen">
      <h1>Calendar</h1>
      {error && <p className="error">{error}</p>}

      <div className="calendar-header">
        <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">
          ‹
        </button>
        <span>{MONTH_LABEL(monthDate)}</span>
        <button type="button" onClick={() => changeMonth(1)} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="calendar-weekdays">
        {WEEKDAY_LABELS.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {grid.flat().map((date) => {
          const iso = toLocalISODate(date);
          const inMonth = date.getMonth() === monthDate.getMonth();
          const count = countsByDate.get(iso) ?? 0;
          const classes = [
            "calendar-cell",
            inMonth ? "" : "outside",
            iso === selectedISO ? "selected" : "",
            iso === todayISO ? "today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button key={iso} type="button" className={classes} onClick={() => setSelectedDate(date)}>
              <span>{date.getDate()}</span>
              {count > 0 && <span className="calendar-dot" />}
            </button>
          );
        })}
      </div>

      <section className="card">
        <div className="row-between">
          <h2>{DAY_LABEL(selectedDate)}</h2>
          {!pickerOpen && (
            <button className="button secondary compact" onClick={() => setPickerOpen(true)}>
              + Add
            </button>
          )}
        </div>

        {pickerOpen && (
          <div className="calendar-picker">
            <input
              className="search-input"
              placeholder="Search recipes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <ul className="picker-list">
              {recipeResults.map((r) => (
                <li key={r.id}>
                  <button type="button" className="list-card compact" onClick={() => pickRecipe(r.id)}>
                    {r.title}
                  </button>
                </li>
              ))}
              {recipeResults.length === 0 && <p className="muted">No matching recipes.</p>}
            </ul>
            <button className="button secondary compact" onClick={() => setPickerOpen(false)}>
              Cancel
            </button>
          </div>
        )}

        {dayEntries === null && <p className="muted">Loading…</p>}
        {dayEntries?.length === 0 && !pickerOpen && <p className="muted">Nothing planned yet.</p>}
        {dayEntries && dayEntries.length > 0 && (
          <ul className="calendar-entry-list">
            {dayEntries.map((entry) => (
              <li key={entry.id} className="calendar-entry">
                <span>{entry.recipe_title}</span>
                <div className="calendar-entry-actions">
                  <span className={entry.status === "cooked" ? "status-chip cooked" : "status-chip"}>
                    {entry.status === "cooked" ? "Cooked" : "Planned"}
                  </span>
                  {entry.status === "planned" && entry.entry_date <= todayISO && (
                    <button type="button" className="button secondary compact" onClick={() => markCooked(entry.id)}>
                      Mark cooked
                    </button>
                  )}
                  <button type="button" className="remove" onClick={() => removeEntry(entry.id)} aria-label="Remove">
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
