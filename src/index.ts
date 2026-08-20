/**
 * Rolling-window and per-entry visa day counting.
 *
 * Extracted from NomadPoint (https://nomadpoint.app), where it decides how long each traveller may
 * stay in each country. Published because the naive version of this is wrong in ways that only
 * show up at a border.
 */

/** A period of presence somewhere. `end: null` means "arrived, no known departure". */
export interface PresenceSpan {
  start: Date;
  end: Date | null;
  /** ISO 3166-1 alpha-2, case-insensitive. */
  code: string;
}

export interface Allowance {
  /** Country codes sharing one pooled allowance. Schengen is 29 of them; the US is one. */
  zone: string[];
  /** Days permitted. Schengen 90, US VWP 90, B1/B2 180. */
  allowed: number;
  /**
   * Length of the rolling window in days (Schengen = 180). Omit for a PER-ENTRY allowance, where
   * each fresh entry resets the count.
   */
  rollingWindowDays?: number;
}

export interface DayCount {
  allowed: number;
  used: number;
  remaining: number;
  /** First day counted: the window's earliest counted day, or this entry's arrival. */
  windowStart: Date | null;
  /** Approximate must-leave-by date. */
  mustLeaveBy: Date | null;
  /** Continuous presences in the zone, after merging. */
  entries: Array<{ start: Date; end: Date }>;
}

const DAY = 86_400_000;

/** Midnight UTC. Local midnight would make the answer depend on the machine's timezone. */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const dayIndex = (d: Date) => Math.floor(d.getTime() / DAY);

/**
 * Continuous presences in the zone.
 *
 * A CLOSED span contributes exactly [start, end] — presence ends at checkout, so a gap between two
 * trips is never filled in with the previous country. An OPEN span (a bare arrival) has no known
 * end, so it runs until the next position change, capped at one full allowance: without that cap a
 * single stale arrival implies years of presence.
 *
 * Overlapping or adjacent presences merge, so moving Paris -> Berlin is one entry, not two, and
 * booked nights never double-count. Entry and exit days BOTH count, which is the rule at the
 * border and the most common off-by-one in home-made calculators.
 */
export function presenceIntervals(
  spans: PresenceSpan[],
  zone: Set<string>,
  asOf: Date,
  maxOpenStayDays?: number,
): Array<{ start: Date; end: Date }> {
  const asOfDay = startOfDay(asOf);
  const items = spans
    .map((s) => ({
      start: startOfDay(s.start),
      end: s.end ? startOfDay(s.end) : null,
      code: s.code.toUpperCase(),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (items.length === 0) return [];

  const starts = items.map((i) => i.start);
  const raw: Array<{ start: Date; end: Date }> = [];

  for (const it of items) {
    if (it.start > asOfDay) continue;          // hasn't happened yet
    if (!zone.has(it.code)) continue;          // out of zone: not presence here
    let end: Date;
    if (it.end) {
      end = it.end;
    } else {
      const next = starts.find((s) => s > it.start);
      end = next ?? asOfDay;
      if (maxOpenStayDays != null) {
        const capped = addDays(it.start, Math.max(0, maxOpenStayDays - 1));
        if (capped < end) end = capped;
      }
    }
    if (end > asOfDay) end = asOfDay;
    if (end < it.start) continue;
    raw.push({ start: it.start, end });
  }
  if (raw.length === 0) return [];

  raw.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged = [raw[0]];
  for (const iv of raw.slice(1)) {
    const last = merged[merged.length - 1];
    // <= 1 day gap counts as continuous: leaving on the 3rd and arriving on the 4th is one stay.
    if (iv.start <= addDays(last.end, 1)) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/**
 * Days used and remaining.
 *
 * Rolling (Schengen 90/180): UNIQUE days inside the window. Unique matters — two overlapping
 * records of the same trip must not count that trip twice.
 *
 * Per-entry (US VWP, most visas): only the CURRENT continuous presence. Summing every past visit
 * is the other common mistake; each entry starts a fresh allowance.
 */
export function countDays(spans: PresenceSpan[], allowance: Allowance, asOf: Date = new Date()): DayCount | null {
  const zone = new Set(allowance.zone.map((c) => c.toUpperCase()));
  if (zone.size === 0 || allowance.allowed <= 0) return null;

  const asOfDay = startOfDay(asOf);
  const entries = presenceIntervals(spans, zone, asOfDay, allowance.allowed);
  if (entries.length === 0) return null;

  if (allowance.rollingWindowDays != null) {
    const lowerBound = addDays(asOfDay, -(allowance.rollingWindowDays - 1));
    const days = new Set<number>();
    let firstCounted: Date | null = null;
    for (const iv of entries) {
      let day = iv.start > lowerBound ? iv.start : lowerBound;
      const last = iv.end < asOfDay ? iv.end : asOfDay;
      if (last < day) continue;
      if (firstCounted === null || day < firstCounted) firstCounted = day;
      for (; day <= last; day = addDays(day, 1)) days.add(dayIndex(day));
    }
    if (days.size === 0) return null;
    const remaining = Math.max(0, allowance.allowed - days.size);
    return {
      allowed: allowance.allowed,
      used: days.size,
      remaining,
      windowStart: firstCounted,
      mustLeaveBy: addDays(asOfDay, remaining),
      entries,
    };
  }

  const current =
    entries.find((iv) => iv.start <= asOfDay && asOfDay <= iv.end) ??
    [...entries].reverse().find((iv) => iv.start <= asOfDay) ??
    entries[entries.length - 1];
  const last = current.end < asOfDay ? current.end : asOfDay;
  const used = Math.max(1, Math.round((last.getTime() - current.start.getTime()) / DAY) + 1);
  return {
    allowed: allowance.allowed,
    used,
    remaining: Math.max(0, allowance.allowed - used),
    windowStart: current.start,
    mustLeaveBy: addDays(current.start, allowance.allowed),
    entries,
  };
}

/** The 29 Schengen states, 90 days in any rolling 180. */
export const SCHENGEN: Allowance = {
  zone: ["AT","BE","BG","CH","CZ","DE","DK","EE","ES","FI","FR","GR","HR","HU","IS","IT",
         "LI","LT","LU","LV","MT","NL","NO","PL","PT","RO","SE","SI","SK"],
  allowed: 90,
  rollingWindowDays: 180,
};

/** CA-4 (Guatemala, El Salvador, Honduras, Nicaragua): 90 days pooled, per entry. */
export const CA4: Allowance = { zone: ["GT","SV","HN","NI"], allowed: 90 };
