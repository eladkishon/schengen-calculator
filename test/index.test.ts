import { describe, it, expect } from "vitest";
import { countDays, presenceIntervals, SCHENGEN, CA4 } from "../src/index.js";

const d = (s: string) => new Date(s + "T00:00:00Z");

describe("rolling window (Schengen 90/180)", () => {
  it("counts entry and exit day both", () => {
    // 1st to 10th inclusive is 10 days, not 9. This is the off-by-one at the border.
    const r = countDays([{ start: d("2026-01-01"), end: d("2026-01-10"), code: "FR" }],
      SCHENGEN, d("2026-01-10"))!;
    expect(r.used).toBe(10);
    expect(r.remaining).toBe(80);
  });

  it("does not double-count overlapping records of the same trip", () => {
    // A flight arrival and a hotel booking describing one stay.
    const r = countDays([
      { start: d("2026-01-01"), end: d("2026-01-10"), code: "FR" },
      { start: d("2026-01-03"), end: d("2026-01-08"), code: "FR" },
    ], SCHENGEN, d("2026-01-10"))!;
    expect(r.used).toBe(10);
  });

  it("treats movement inside the zone as one continuous stay", () => {
    const r = countDays([
      { start: d("2026-01-01"), end: d("2026-01-05"), code: "FR" },
      { start: d("2026-01-05"), end: d("2026-01-10"), code: "DE" },
    ], SCHENGEN, d("2026-01-10"))!;
    expect(r.used).toBe(10);
    expect(r.entries).toHaveLength(1);
  });

  it("does not fill the gap between two trips", () => {
    // Home for February. A naive counter that carries the last country forward bills you for it.
    const r = countDays([
      { start: d("2026-01-01"), end: d("2026-01-10"), code: "FR" },
      { start: d("2026-03-01"), end: d("2026-03-05"), code: "FR" },
    ], SCHENGEN, d("2026-03-05"))!;
    expect(r.used).toBe(15);
    expect(r.entries).toHaveLength(2);
  });

  it("drops days that have aged out of the window", () => {
    const r = countDays([{ start: d("2025-01-01"), end: d("2025-01-10"), code: "FR" }],
      SCHENGEN, d("2026-01-10"));
    expect(r).toBeNull(); // a year later, nothing is inside the 180-day window
  });

  it("ignores time outside the zone", () => {
    const r = countDays([
      { start: d("2026-01-01"), end: d("2026-01-10"), code: "FR" },
      { start: d("2026-01-11"), end: d("2026-01-20"), code: "GB" }, // not Schengen
    ], SCHENGEN, d("2026-01-20"))!;
    expect(r.used).toBe(10);
  });
});

describe("per-entry allowance", () => {
  it("resets on each entry rather than summing visits", () => {
    const r = countDays([
      { start: d("2026-01-01"), end: d("2026-01-30"), code: "GT" },
      { start: d("2026-06-01"), end: d("2026-06-10"), code: "GT" },
    ], CA4, d("2026-06-10"))!;
    expect(r.used).toBe(10); // not 40
  });
});

describe("open spans", () => {
  it("runs an arrival with no departure up to today", () => {
    const r = countDays([{ start: d("2026-01-01"), end: null, code: "FR" }],
      SCHENGEN, d("2026-01-10"))!;
    expect(r.used).toBe(10);
  });

  it("stops an open span at the next position change", () => {
    const r = countDays([
      { start: d("2026-01-01"), end: null, code: "FR" },
      { start: d("2026-01-05"), end: d("2026-01-20"), code: "GB" },
    ], SCHENGEN, d("2026-01-20"))!;
    expect(r.used).toBe(5); // Jan 1-5, then you left
  });

  it("caps a stale lone arrival at one allowance", () => {
    // Without the cap, one forgotten arrival implies years of presence.
    const r = countDays([{ start: d("2020-01-01"), end: null, code: "FR" }],
      SCHENGEN, d("2026-01-10"));
    expect(r).toBeNull(); // capped at 90 days back in 2020, long outside the window
  });
});

describe("presenceIntervals", () => {
  it("merges a one-day gap as continuous", () => {
    const iv = presenceIntervals([
      { start: d("2026-01-01"), end: d("2026-01-03"), code: "FR" },
      { start: d("2026-01-04"), end: d("2026-01-06"), code: "FR" },
    ], new Set(["FR"]), d("2026-01-06"));
    expect(iv).toHaveLength(1);
  });

  it("ignores future spans", () => {
    const iv = presenceIntervals([{ start: d("2026-12-01"), end: d("2026-12-10"), code: "FR" }],
      new Set(["FR"]), d("2026-01-01"));
    expect(iv).toHaveLength(0);
  });
});
