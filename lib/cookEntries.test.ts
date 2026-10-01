import { describe, expect, it } from "vitest";
import { buildMonthGrid, statusForDate, toLocalISODate } from "./cookEntries.js";

describe("toLocalISODate", () => {
  it("formats using local date parts, not UTC", () => {
    // 11:30pm local time should still be "today", not roll over via toISOString's UTC conversion.
    const date = new Date(2026, 8, 29, 23, 30); // Sep 29, 2026, 23:30 local
    expect(toLocalISODate(date)).toBe("2026-09-29");
  });

  it("pads single-digit months and days", () => {
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("statusForDate", () => {
  const today = new Date(2026, 8, 29); // Sep 29, 2026

  it("treats today and the past as cooked", () => {
    expect(statusForDate("2026-09-29", today)).toBe("cooked");
    expect(statusForDate("2026-09-01", today)).toBe("cooked");
  });

  it("treats the future as planned", () => {
    expect(statusForDate("2026-09-30", today)).toBe("planned");
    expect(statusForDate("2026-12-25", today)).toBe("planned");
  });
});

describe("buildMonthGrid", () => {
  it("returns 6 weeks of 7 days each", () => {
    const grid = buildMonthGrid(2026, 8); // September 2026
    expect(grid).toHaveLength(6);
    for (const week of grid) expect(week).toHaveLength(7);
  });

  it("pads with the trailing/leading days of adjacent months", () => {
    // September 1, 2026 is a Tuesday, so the grid should start on Sunday Aug 30.
    const grid = buildMonthGrid(2026, 8);
    expect(toLocalISODate(grid[0][0])).toBe("2026-08-30");
    expect(toLocalISODate(grid[0][2])).toBe("2026-09-01");
  });

  it("contains every day of the target month exactly once", () => {
    const grid = buildMonthGrid(2026, 1); // February 2026 (28 days)
    const inMonth = grid.flat().filter((d) => d.getMonth() === 1);
    expect(inMonth).toHaveLength(28);
  });
});
