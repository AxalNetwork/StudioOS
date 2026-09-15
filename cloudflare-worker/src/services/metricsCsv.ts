/**
 * Parse a founder's KPI spreadsheet into `project_metrics` rows, and say what
 * happened to every line.
 *
 * WHAT THIS REPLACES. `/build/kpi`'s `Import CSV` op was registered `unbuilt` —
 * "no importer is built; snapshots are entered one at a time" — which renders
 * NOTHING, so the artboard's second op was invisible. Task #176, FB5. A founder
 * with fourteen months of history in a spreadsheet had to retype it a month at a
 * time into a one-month form.
 *
 * AN IMPORTER THAT SILENTLY DROPS ROWS IS WORSE THAN NO IMPORTER. The failure is
 * not "the import errored" — that is visible and recoverable — it is "the import
 * said OK and eleven of fourteen months are missing", and a founder discovers it
 * six weeks later when a board pack is short. So this returns a verdict PER LINE:
 * every accepted row, and every rejected one with the reason and its line number.
 * The route hands both back and the page prints the rejections.
 *
 * IT PARSES AND VALIDATES; IT DOES NOT WRITE. Returning rows rather than executing
 * them is what lets the whole parser be tested without a database, and it is what
 * makes a dry run possible — the page can show a founder what a file would do
 * before it does it.
 *
 * NOT A CSV LIBRARY, AND THE QUOTING IT DOES HANDLE IS THE QUOTING SPREADSHEETS
 * EMIT: double quotes around a field, `""` for a literal quote inside one, commas
 * and newlines inside quotes. `services/csv.ts` is the other half of this pair —
 * it writes CSV with exactly those rules (RFC 4180, CRLF) — so a file this repo
 * exported is a file this can read back.
 */

/**
 * The columns an import may set, mapped to how each is read.
 *
 * `int` rounds and `real` does not, matching the column types migration 249
 * declares. Getting this backwards would store `headcount = 4.5`, which SQLite
 * accepts in an INTEGER column and nothing downstream would question.
 */
export const IMPORT_COLUMNS: Record<string, 'real' | 'int'> = {
  mrr: 'real',
  arr: 'real',
  cac: 'real',
  ltv: 'real',
  monthly_churn_pct: 'real',
  active_users: 'int',
  new_users: 'int',
  net_burn: 'real',
  cash_balance: 'real',
  headcount: 'int',
  nrr_pct: 'real',
  paying_accounts: 'int',
};

/**
 * Header spellings a spreadsheet actually contains, mapped to the column.
 *
 * A founder's export says "MRR", "Monthly Recurring Revenue" or "mrr"; Excel adds
 * a BOM; Google Sheets keeps the spaces. Refusing all three and demanding
 * `monthly_churn_pct` would make the importer technically correct and useless. The
 * canonical key always works, so this list only ever ADDS acceptance.
 */
const HEADER_ALIASES: Record<string, string> = {
  month: 'snapshot_date',
  date: 'snapshot_date',
  period: 'snapshot_date',
  snapshotdate: 'snapshot_date',
  monthlyrecurringrevenue: 'mrr',
  annualrecurringrevenue: 'arr',
  customeracquisitioncost: 'cac',
  lifetimevalue: 'ltv',
  churn: 'monthly_churn_pct',
  monthlychurn: 'monthly_churn_pct',
  churnpct: 'monthly_churn_pct',
  netburn: 'net_burn',
  burn: 'net_burn',
  cash: 'cash_balance',
  cashbalance: 'cash_balance',
  activeusers: 'active_users',
  newusers: 'new_users',
  nrr: 'nrr_pct',
  nrrpct: 'nrr_pct',
  payingaccounts: 'paying_accounts',
  customers: 'paying_accounts',
};

/** Header cell → column name, or null when nothing recognises it. */
export function headerToColumn(cell: string): string | null {
  // `trim()` ALREADY STRIPS EXCEL'S BYTE-ORDER MARK, and this line used to strip it
  // again. `\uFEFF` is <ZWNBSP>, which is in the spec's WhiteSpace production, so
  // `'\uFEFFmonth'.trim()` is `'month'` — verified against node rather than
  // assumed, the same way the `AVG`-skips-NULLs claim in `founder_cadence.ts` was.
  //
  // The redundant `.replace()` is gone for a second reason worth stating: it held
  // the BOM as a LITERAL INVISIBLE CHARACTER in the source, which is the kind of
  // byte an editor, a copy-paste or a reformat silently eats — leaving a regex that
  // looks like `/^/` and matches everything. A mutation sweep found it.
  const raw = String(cell ?? '').trim();
  const lower = raw.toLowerCase();
  if (lower === 'snapshot_date') return 'snapshot_date';
  if (Object.prototype.hasOwnProperty.call(IMPORT_COLUMNS, lower)) return lower;
  if (lower === 'notes') return 'notes';
  const squashed = lower.replace(/[\s_\-.()$%]/g, '');
  if (Object.prototype.hasOwnProperty.call(HEADER_ALIASES, squashed)) return HEADER_ALIASES[squashed];
  if (Object.prototype.hasOwnProperty.call(IMPORT_COLUMNS, squashed)) return squashed;
  return null;
}

/** One record: a `\r\n`/`\n`-delimited CSV split into rows of fields. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = String(text ?? '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        // `""` is one literal quote; a lone `"` closes the field.
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') {
      // CRLF is one break, not two. Counting it twice would insert a blank row
      // between every real one, and every other line would be rejected as empty.
      if (src[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
      continue;
    }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  // A file without a trailing newline still has a last row — dropping it would
  // silently lose whichever month a founder typed last.
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * A number from a spreadsheet cell, or null.
 *
 * WHAT IT STRIPS AND WHY EACH ONE HAD TO BE. `$104,800` is what a founder's sheet
 * holds; `1.2%` is how churn is written; `(61,200)` is accounting notation for
 * negative; `—` and `n/a` are how a person writes "not recorded". Every one of
 * these read as NaN before, and a NaN silently became a rejected row on a file
 * that was perfectly clear to a human.
 *
 * EMPTINESS IS CHECKED BEFORE `Number()`. `Number('')` is 0 and finite, so a blank
 * cell coerced first becomes a REAL ZERO in the series — "MRR was $0 in March" —
 * and every derived figure above it is then wrong. The trap #203 shipped once.
 */
export function cellToNumber(cell: unknown): number | null | 'bad' {
  const raw = String(cell ?? '').trim();
  if (raw === '' || raw === '—' || raw === '-' || /^n\/?a$/i.test(raw)) return null;
  let s = raw.replace(/[$£€\s,]/g, '').replace(/%$/, '');
  let negative = false;
  if (/^\((.*)\)$/.test(s)) { negative = true; s = s.replace(/^\((.*)\)$/, '$1'); }
  if (s === '' || !/^[-+]?\d*\.?\d+$/.test(s)) return 'bad';
  const n = Number(s);
  if (!Number.isFinite(n)) return 'bad';
  return negative ? -n : n;
}

/**
 * A month cell to `YYYY-MM-DD`.
 *
 * `2026-08` and `2026-08-01` both mean August, and a spreadsheet's month column
 * usually holds the former — so a bare month becomes the FIRST of it rather than
 * being rejected. `Aug 2026` and `08/2026` are accepted too; anything else is
 * refused rather than guessed, because a date the platform invented is a row
 * filed against a month that did not happen.
 *
 * NEVER `Date.parse`. A bare `YYYY-MM-DD` parses as UTC midnight, so west of
 * Greenwich re-formatting it lands a day early — and `08/02/2026` is February in
 * one country and August in another, which is exactly the ambiguity this refuses
 * instead of resolving.
 */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function cellToDay(cell: unknown): string | null {
  const raw = String(cell ?? '').trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return validDay(iso[1], iso[2], iso[3]) ? raw : null;
  const month = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (month) {
    const mm = String(Number(month[2])).padStart(2, '0');
    return validDay(month[1], mm, '01') ? `${month[1]}-${mm}-01` : null;
  }
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slash) {
    const mm = String(Number(slash[1])).padStart(2, '0');
    return validDay(slash[2], mm, '01') ? `${slash[2]}-${mm}-01` : null;
  }
  const named = /^([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(raw);
  if (named) {
    const idx = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
    if (idx >= 0) return `${named[2]}-${String(idx + 1).padStart(2, '0')}-01`;
  }
  return null;
}

/** Month 1–12 and a day that exists in it, without constructing a Date. */
function validDay(y: string, m: string, d: string): boolean {
  const year = Number(y); const month = Number(m); const day = Number(d);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1];
}

export type ImportRow = {
  line: number;
  snapshot_date: string;
  values: Record<string, number | null>;
  notes: string | null;
};
export type ImportReject = { line: number; reason: string };
export type ImportPlan = {
  rows: ImportRow[];
  rejected: ImportReject[];
  columns: string[];
  /** Header cells nothing recognised, so a reader can see what was ignored. */
  ignored: string[];
};

/** How many data lines one request may carry. */
export const IMPORT_MAX_ROWS = 240;

/**
 * A CSV to a plan: which rows to write, which to refuse and why.
 *
 * `line` is the 1-based line in the FILE, header included, so a founder can find
 * the row the message is about. Reporting a zero-based index into the data rows
 * would name a different line than the one their editor shows.
 */
export function planImport(text: string): ImportPlan {
  const grid = splitCsv(text).filter((r) => r.some((cell) => String(cell).trim() !== ''));
  if (!grid.length) return { rows: [], rejected: [{ line: 1, reason: 'the file is empty' }], columns: [], ignored: [] };

  const header = grid[0];
  const mapped = header.map(headerToColumn);
  const ignored = header.filter((cell, i) => mapped[i] === null && String(cell).trim() !== '');
  const columns = mapped.filter((x): x is string => x !== null);
  if (!columns.includes('snapshot_date')) {
    return {
      rows: [], columns, ignored,
      rejected: [{ line: 1, reason: 'no month column — name one of: month, date, period, snapshot_date' }],
    };
  }
  if (!columns.some((k) => Object.prototype.hasOwnProperty.call(IMPORT_COLUMNS, k))) {
    return {
      rows: [], columns, ignored,
      rejected: [{ line: 1, reason: `no metric column recognised — one of: ${Object.keys(IMPORT_COLUMNS).join(', ')}` }],
    };
  }

  const rows: ImportRow[] = [];
  const rejected: ImportReject[] = [];
  const seen = new Map<string, number>();

  for (let r = 1; r < grid.length; r += 1) {
    const line = r + 1;
    if (rows.length >= IMPORT_MAX_ROWS) {
      // THE CAP IS REPORTED, NOT APPLIED QUIETLY. A truncation nobody is told
      // about is the exact failure this module's docblock is about.
      rejected.push({ line, reason: `over the ${IMPORT_MAX_ROWS}-row limit for one import — split the file` });
      continue;
    }
    const cells = grid[r];
    const values: Record<string, number | null> = {};
    let day: string | null = null;
    let notes: string | null = null;
    let bad: string | null = null;

    for (let cIdx = 0; cIdx < mapped.length; cIdx += 1) {
      const col = mapped[cIdx];
      if (!col) continue;
      const cell = cells[cIdx];
      if (col === 'snapshot_date') {
        day = cellToDay(cell);
        if (!day) bad = bad || `"${String(cell ?? '').trim()}" is not a month the importer can read`;
        continue;
      }
      if (col === 'notes') {
        const s = String(cell ?? '').trim();
        notes = s ? s.slice(0, 4000) : null;
        continue;
      }
      const n = cellToNumber(cell);
      if (n === 'bad') { bad = bad || `${col} is not a number: "${String(cell ?? '').trim()}"`; continue; }
      values[col] = IMPORT_COLUMNS[col] === 'int' && n != null ? Math.round(n) : n;
    }

    if (bad) { rejected.push({ line, reason: bad }); continue; }
    if (!day) { rejected.push({ line, reason: 'no month on this row' }); continue; }
    // EVERY METRIC BLANK IS A REJECTION, not a row of nulls. Writing one would
    // add a month to "months on record" that says nothing about that month, and
    // the KPI page's "missing cells" count would then be counting rows the import
    // created rather than data a founder owes.
    if (!Object.values(values).some((v) => v != null)) {
      rejected.push({ line, reason: 'every metric on this row is blank' });
      continue;
    }
    // A FILE THAT NAMES ONE MONTH TWICE IS REFUSED, NOT LAST-WINS. Both lines
    // look deliberate and the importer cannot know which the founder meant; a
    // silent last-wins would drop a figure they can see in their own file.
    const already = seen.get(day);
    if (already != null) {
      rejected.push({ line, reason: `${day} is already on line ${already} — one row per month` });
      continue;
    }
    seen.set(day, line);
    rows.push({ line, snapshot_date: day, values, notes });
  }

  return { rows, rejected, columns, ignored };
}
