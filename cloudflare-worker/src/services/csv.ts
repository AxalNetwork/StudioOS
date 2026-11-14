/**
 * CSV serialisation, in one place.
 *
 * WHY THIS FILE EXISTS. The worker had three private copies of the same
 * escaper and they had already drifted apart:
 *
 *   · `routes/admin.conversations.helpers.ts` — `/[",\n\r]/`, the correct one
 *   · `routes/financials.ts` `csvEscape`     — `/[",\n]/`
 *   · `routes/events.ts` inline `esc`        — `/[",\n]/`
 *
 * The last two do not quote a value whose only special character is a carriage
 * return, and RFC 4180 readers treat a bare CR inside an unquoted field as a
 * record separator — so one pasted Windows line ending splits a row in half.
 * `admin.conversations.helpers.ts` now imports from here rather than keeping a
 * fourth; the other two are a behaviour change to shipped exports and are left
 * for their own commit, named here so the next reader finds them.
 *
 * NOT A CSV LIBRARY. Fields in, string out, no streaming: every export in this
 * worker materialises its whole body in memory under an explicit `LIMIT`, which
 * is what keeps a Worker's memory envelope predictable.
 */

/**
 * One field. Quoted only when it must be, because an unnecessarily quoted CSV
 * is harder to read by eye and every export here is read by a person before it
 * is read by a spreadsheet.
 *
 * `null` and `undefined` become empty — NOT the string "null". A blank cell is
 * how a CSV says "not recorded"; the four characters `null` are a value.
 */
export function csvEsc(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * A field a spreadsheet must never run (D6103). A cell that starts with `=`,
 * `+`, `-`, `@`, a tab or a carriage return is read by Excel and Sheets as a
 * formula, so text a person typed (a customer's feedback, a KPI's name) gets a
 * leading apostrophe first; a plain number such as `-42` or `-1.5` is left as
 * it is, because it is a value, not a formula. The same rule as
 * `capTableRegister.ts`'s and `fundAdminLpsCsv.ts`'s private `csvCell`, here
 * so a new export reuses it instead of writing a fifth copy.
 */
export function csvSafe(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return csvEsc(/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);
}

/** `toCsv` with every field through `csvSafe`: for an export that carries text people typed. */
export function toSafeCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((cells) => cells.map(csvSafe).join(',')).join('\r\n');
}

/** One row, already escaped. */
export const csvRow = (cells: readonly unknown[]): string => cells.map(csvEsc).join(',');

/**
 * A whole document: a header row, then the body.
 *
 * CRLF, not LF. RFC 4180 specifies it and Excel on Windows is the reader that
 * cares; every parser that accepts LF also accepts CRLF, so this is the choice
 * that is right in both places rather than right in one.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n');
}

/**
 * The response every export returns.
 *
 * `filename` is sanitised because two of them are built from a project name a
 * person typed: `events_public.ts` interpolates an unsanitised slug into this
 * header today, and a name carrying a quote or a newline would let the caller
 * write their own header parameters. The two idioms already in the worker are
 * a sanitised name and an id-plus-datestamp; this supports both by leaving the
 * composition to the caller and only refusing what cannot be in a filename.
 */
export function csvResponse(body: string, filename: string, extraHeaders: Record<string, string> = {}): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}"`,
      ...extraHeaders,
    },
  });
}

/** `2026-09-06` — the datestamp half of the worker's filename convention. */
export const stamp = (now: Date = new Date()): string => now.toISOString().slice(0, 10);
