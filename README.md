# schengen-calculator

Rolling-window (Schengen 90/180) and per-entry visa day counting. Zero dependencies, TypeScript,
works in the browser and on the server.

```bash
npm i schengen-calculator
```

```ts
import { countDays, SCHENGEN } from "schengen-calculator";

const result = countDays(
  [
    { start: new Date("2026-01-05"), end: new Date("2026-01-20"), code: "FR" },
    { start: new Date("2026-03-01"), end: new Date("2026-03-14"), code: "IT" },
  ],
  SCHENGEN,
);

result.used;        // 30
result.remaining;   // 60
result.mustLeaveBy; // the date you have to be out by
result.entries;     // continuous presences, after merging
```

## Why this exists

Counting days sounds like subtraction and isn't. These are the cases a home-made calculator gets
wrong, each of which is a real conversation with a border officer:

**Entry and exit days both count.** The 1st to the 10th is ten days, not nine. This single
off-by-one is the most common bug in Schengen calculators.

**Two records of one trip is still one trip.** A flight arrival and a hotel booking describing the
same stay must not bill you twice. The rolling window counts *unique* days.

**Moving inside the zone is one stay.** Paris to Berlin does not start a new entry and does not
double-count the day you travelled.

**The gap between trips is not presence.** If you fly home for February, February is not Schengen
time. A counter that carries your last known country forward will invent weeks you never spent.

**A per-entry allowance resets; a rolling one does not.** US VWP gives you 90 days *each entry*.
Schengen gives you 90 in any rolling 180 *in total*. Summing every past visit is wrong for the
first; counting only the current visit is wrong for the second.

**An arrival with no departure needs a bound.** If all you know is that someone entered, presence
runs to the next position change — capped at one full allowance. Without the cap, one forgotten
arrival implies years of continuous presence.

**Days are UTC.** Local midnight would make the answer depend on the machine's timezone.

## API

### `countDays(spans, allowance, asOf?) → DayCount | null`

`spans` are periods of presence. `end: null` means "arrived, no known departure".

```ts
interface PresenceSpan { start: Date; end: Date | null; code: string }  // ISO 3166-1 alpha-2
```

`null` is returned when there is nothing to count — no presence in the zone inside the window.

### `presenceIntervals(spans, zone, asOf, maxOpenStayDays?)`

The merged continuous presences, if you want them without the counting.

### Built-in allowances

`SCHENGEN` — 29 states, 90 days in any rolling 180.
`CA4` — Guatemala, El Salvador, Honduras, Nicaragua: 90 days pooled, per entry.

Anything else is a literal:

```ts
const US_VWP = { zone: ["US"], allowed: 90 };                          // per entry
const B1B2   = { zone: ["US"], allowed: 180 };                         // per entry
```

## Accuracy

This is arithmetic over dates you supply, not immigration advice. It does not know your visa, your
residence permit, exemptions, or the officer's discretion. Rules change. Check with the authority
that issues the stamp.

## Where it came from

Extracted from [NomadPoint](https://nomadpoint.app), a trip planner that tracks entry rules for
every traveller on a trip, across 39,601 passport-and-destination combinations. The counting engine
is the same one running in the app; publishing it seemed more useful than everyone rewriting the
off-by-one.

MIT.
