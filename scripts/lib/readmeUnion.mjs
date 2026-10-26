/**
 * What `merge=union` can leave in a README.md (`.gitattributes`), and so what
 * `../check-folder-docs.mjs` refuses (its rule 4).
 *
 * WHY UNION. Many branches append a row or a paragraph at the same spot of the
 * same README (a folder's file table, `design/incoming/README.md`'s landings).
 * Git's built-in `union` driver keeps both sides' lines instead of stopping on
 * a conflict, which is right for appends.
 *
 * WHAT IT GETS WRONG. When two branches change the SAME line differently,
 * union keeps both versions one after the other. Three checks:
 *   1. a conflict marker left in the file (a union cannot leave one, a hand
 *      merge can);
 *   2. a table row whose first cell names a file or folder in backticks that
 *      a row of the same table already names — one file, two descriptions.
 *      A table keyed by something else (a decision with one row per issue,
 *      `design/incoming/README.md`'s build tables) may repeat its key;
 *   3. the same substantial line (40 or more characters, not a table rule)
 *      twice within WINDOW lines — union's two copies sit next to each other.
 *      A template line repeated in separate sections, further apart, is not
 *      flagged.
 * Prose rewritten two ways is caught only when a whole line repeats, so a
 * shared README keeps one row per file and leaves a feature's notes to its
 * decision file.
 * Pure: it reads a string and returns findings.
 */

export const WINDOW = 8;
export const MIN_LENGTH = 40;

const RULE = /^\|?[\s:|-]+\|?$/;
const MARKER = /^(<{7}|={7}|>{7})(\s|$)/;

const firstCell = (row) => (row.split('|')[1] ?? '').trim();
const NAMED = /^`[^`]+`$/;

/** Each finding is `{ line, kind: 'marker'|'row'|'repeat', text }`, `line` 1-based. */
export function unionArtifacts(src = '') {
  const lines = String(src).split('\n');
  const out = [];
  let cells = null;
  const seen = new Map();
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (MARKER.test(raw)) out.push({ line: i + 1, kind: 'marker', text: raw.slice(0, 7) });
    if (l.startsWith('|')) {
      if (!cells) cells = new Set();
      const key = firstCell(l);
      if (NAMED.test(key) && !RULE.test(l)) {
        if (cells.has(key)) out.push({ line: i + 1, kind: 'row', text: key.slice(0, 80) });
        cells.add(key);
      }
    } else {
      cells = null;
    }
    if (l.length >= MIN_LENGTH && !RULE.test(l)) {
      const prev = seen.get(l);
      if (prev != null && i - prev <= WINDOW && !l.startsWith('|')) out.push({ line: i + 1, kind: 'repeat', text: l.slice(0, 80) });
      seen.set(l, i);
    }
  });
  return out;
}
