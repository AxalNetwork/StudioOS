/**
 * Five-field cron matching over UTC minutes, in CLOUDFLARE'S dialect, in both
 * directions: the next minute an expression fires, and the last minute it did.
 *
 * WHY CLOUDFLARE'S DIALECT AND NOT THE FAMILIAR ONE. Cloudflare numbers the
 * weekday field 1 = Sunday through 7 = Saturday. Its own cron-triggers page
 * says so in a note: "Days of the week go from 1 = Sunday to 7 = Saturday,
 * which is different on some other cron systems (where 0 = Sunday and
 * 6 = Saturday)". This repo learned it the expensive way. The trigger declared
 * as `0 9 * * 1` and commented "weekly digest emails (Monday)" fired on
 * SUNDAYS: its last row in production before D201 was 2026-08-23 09:00:24, a
 * Sunday. A matcher in the familiar dialect expects Monday, and would report a
 * trigger that fired on time as silent six days in seven.
 *
 * WHAT IT PARSES, AND WHAT IT REFUSES. Every field takes a star, a number, a
 * range `a-b`, a stepped star or range (`0-59/15`, or a star followed by
 * `/15`), and comma lists of those. Everything else Cloudflare accepts returns
 * null rather than a guess: month and weekday names, `L`, `W`, `#`, `?`, and a
 * bare `a/n`. So does an expression that restricts BOTH day of month and day
 * of week. Cloudflare's syntax is Quartz-like, and Quartz forbids setting both,
 * while Cloudflare documents no rule for combining them. The familiar
 * dialect's OR rule would be an assumption, and assumptions are what this file
 * exists to replace. Every declared trigger parses, and
 * `cron_record_d201.test.ts` fails the day one does not.
 *
 * Both directions answer in the store's own format, `YYYY-MM-DD HH:MM:SS`,
 * because the only thing they are ever compared against is a
 * `cron_run_history` column written in that format.
 */

/** A parsed expression. Weekdays are JS `getUTCDay()` numbers (0 = Sunday). */
export interface CronSpec {
  minutes: readonly number[];
  hours: readonly number[];
  /** null when the field is `*`: any day of the month. */
  doms: readonly number[] | null;
  months: readonly number[];
  /** null when the field is `*`: any day of the week. */
  dows: readonly number[] | null;
}

/** Field bounds, in Cloudflare's numbering: the weekday field runs 1–7. */
const BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [1, 7], //  day of week, 1 = Sunday
];

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * How far either search walks before giving up. Eight years covers the rarest
 * expression this parser accepts that can fire at all (the 29th of February),
 * and it is still under three thousand iterations: the walk is by DAY, and a
 * minute is only tried on a day that matches.
 */
const SEARCH_DAYS = 366 * 8;

/** One item of one field: `*`, `n`, `a-b`, each optionally `/step`. */
const ITEM = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/;

function parseField(text: string, min: number, max: number): number[] | null {
  const values = new Set<number>();
  for (const item of text.split(',')) {
    const m = ITEM.exec(item);
    if (!m) return null;
    const [, star, a, b, stepText] = m;
    // `5/15` is Quartz for "from 5, every 15". Cloudflare may read it that
    // way, but it does not say so, and a guessed reading is the defect this
    // file replaces. A range with a step (`5-59/15`) says the same thing
    // unambiguously.
    if (!star && b === undefined && stepText !== undefined) return null;
    const lo = star ? min : Number(a);
    const hi = star ? max : b !== undefined ? Number(b) : lo;
    const step = stepText !== undefined ? Number(stepText) : 1;
    if (!Number.isSafeInteger(step) || step < 1) return null;
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi)) return null;
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return [...values].sort((x, y) => x - y);
}

/** Parse an expression, or null when it uses anything this file does not read. */
export function parseCron(expr: string): CronSpec | null {
  if (typeof expr !== 'string') return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const parsed = parseField(parts[i], BOUNDS[i][0], BOUNDS[i][1]);
    if (!parsed) return null;
    fields.push(parsed);
  }
  const anyDom = parts[2] === '*';
  const anyDow = parts[4] === '*';
  if (!anyDom && !anyDow) return null;
  return {
    minutes: fields[0],
    hours: fields[1],
    doms: anyDom ? null : fields[2],
    months: fields[3],
    // Cloudflare's 1 = Sunday is `getUTCDay()`'s 0.
    dows: anyDow ? null : fields[4].map((d) => d - 1),
  };
}

function dayMatches(spec: CronSpec, dayStartMs: number): boolean {
  const d = new Date(dayStartMs);
  if (!spec.months.includes(d.getUTCMonth() + 1)) return false;
  if (spec.doms && !spec.doms.includes(d.getUTCDate())) return false;
  if (spec.dows && !spec.dows.includes(d.getUTCDay())) return false;
  return true;
}

/** `YYYY-MM-DD HH:MM:SS`, UTC — the format `cron_run_history` stores. */
export function sqlStamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * The first minute STRICTLY AFTER `from`'s minute at which `expr` fires, or
 * null when it cannot be parsed or does not fire within the search window.
 */
export function nextCronRun(expr: string, from: Date = new Date()): string | null {
  const spec = parseCron(expr);
  if (!spec || !Number.isFinite(from.getTime())) return null;
  const start = new Date(Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
  let dayStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (let i = 0; i < SEARCH_DAYS; i++, dayStart += DAY_MS) {
    if (!dayMatches(spec, dayStart)) continue;
    const firstDay = i === 0;
    for (const h of spec.hours) {
      if (firstDay && h < start.getUTCHours()) continue;
      const floor = firstDay && h === start.getUTCHours() ? start.getUTCMinutes() : 0;
      for (const m of spec.minutes) {
        if (m >= floor) return sqlStamp(dayStart + h * 3_600_000 + m * MINUTE_MS);
      }
    }
  }
  return null;
}

/**
 * The last minute AT OR BEFORE `from`'s minute at which `expr` fired, or null
 * when it cannot be parsed or has not fired within the search window.
 *
 * "At or before" because a trigger scheduled for 03:00 has fired by any second
 * of 03:00: the question this answers is which scheduled time a record should
 * already show.
 */
export function prevCronRun(expr: string, from: Date = new Date()): string | null {
  const spec = parseCron(expr);
  if (!spec || !Number.isFinite(from.getTime())) return null;
  const start = new Date(Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS);
  let dayStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (let i = 0; i < SEARCH_DAYS; i++, dayStart -= DAY_MS) {
    if (!dayMatches(spec, dayStart)) continue;
    const firstDay = i === 0;
    for (let hi = spec.hours.length - 1; hi >= 0; hi--) {
      const h = spec.hours[hi];
      if (firstDay && h > start.getUTCHours()) continue;
      const ceiling = firstDay && h === start.getUTCHours() ? start.getUTCMinutes() : 59;
      for (let mi = spec.minutes.length - 1; mi >= 0; mi--) {
        const m = spec.minutes[mi];
        if (m <= ceiling) return sqlStamp(dayStart + h * 3_600_000 + m * MINUTE_MS);
      }
    }
  }
  return null;
}
