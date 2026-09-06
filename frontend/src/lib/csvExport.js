/**
 * CSV from rows the page already has.
 *
 * WHY THIS EXISTS BESIDE `api._downloadCsv`. The Validate exports are
 * server-side because each one reaches past the screen: every interview rather
 * than the first twenty-five, the whole pain map, the founder's decision. Most
 * zone-header "Export" actions do not need that. They need the rows in front of
 * the reader, and building a worker route for each of the twenty-odd zones that
 * asks for one would be twenty routes, twenty tests and twenty chances for a
 * count on screen to disagree with a count in a file.
 *
 * WHAT THAT COSTS, AND WHY IT IS SAID OUT LOUD. This exports the LOADED rows,
 * which on most zones is a capped page rather than the whole table. So the
 * button is labelled "Export this view" and the file's name carries the count.
 * "Export" over a truncated list, with no hint of the truncation, is how a
 * founder pastes twenty-five of two hundred rows into an investor update.
 *
 * THE ESCAPING IS THE WORKER'S, DELIBERATELY. `cloudflare-worker/src/services/csv.ts`
 * quotes on `[",\n\r]`; two older copies in that codebase quote on `[",\n]` and
 * leave a bare carriage return unquoted, which splits a record for any RFC 4180
 * reader. A fourth variant here, drifting a fifth way, is exactly the failure
 * consolidating those three was meant to end — so this matches the one that is
 * right, and `frontend/test/zone_actions.test.mjs` holds them to the same rule.
 */

/** One cell. `null` and `undefined` are an EMPTY cell, never the text "null". */
export function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells) => cells.map(csvCell).join(',');

/** RFC 4180 line endings, which is what the worker's `toCsv` emits too. */
export function toCsv(header, rows) {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n');
}

/** `2026-09-06`, for a filename. */
export const stamp = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Hand the browser a file.
 *
 * A blob and an object URL rather than a `data:` URI: a data URI carries the
 * whole payload in the address and browsers cap that, so a long table would
 * fail silently at some size nobody would find until it happened. The URL is
 * revoked on the next frame — revoking it synchronously races the download in
 * Safari and the file arrives empty.
 */
export function downloadCsv(filename, header, rows) {
  const body = toCsv(header, rows);
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
  // A BOM, so Excel opens UTF-8 as UTF-8. Without it an interviewee called
  // Aoife Brennan arrives as AoifeÂ Brennan, which looks like the product
  // mangled their name. Written as an escape rather than as the character
  // itself: a literal U+FEFF is invisible in every editor and diff, and the
  // first tool that trims it silently drops the fix with no test to notice.
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/**
 * The export a zone-header button performs: name the file for the venture, the
 * zone and the day, and say how many rows went into it.
 *
 * Returns false when there is nothing loaded, so the caller can say "nothing to
 * export yet" rather than handing over a file with a header row and no body —
 * which reads as "there is no data" when the truth may be "it has not loaded".
 */
export function exportView({ scope, zone, header, rows }) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return false;
  const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const name = [slug(scope), slug(zone), `${list.length}-rows`, stamp()].filter(Boolean).join('-');
  return downloadCsv(`${name}.csv`, header, list);
}
