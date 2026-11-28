/**
 * D9276 (#9276): the composer's command grammar, a pure parser over the
 * registry (`./registry.js`). It answers one of three shapes and nothing else:
 *   - `{ entry }`: the text named one listed entry the viewer may see;
 *   - `{ suggestions }`: the closest entries, best first, for anything else;
 *   - `{ unknown }`: nothing listed comes close.
 *
 * Grammar:
 *   - `/<section>/<module>` opens a module;
 *   - `/<section>/<module><action>` starts an action; the angle brackets are
 *     optional to type, so `/<section>/<module> <action>` is the same;
 *   - `/<alias>` or `/<shortcut>` (`/segment`, `/record`) names its entry;
 *   - anything else is a fuzzy search over labels, module titles and aliases.
 *
 * A typed path resolves only to a listed entry. It is never turned into an
 * address, an API path or an instruction: the caller opens `entry.href()`,
 * which the registry builds from the entry's own fields.
 */
import { ENTRIES, visibleTo } from './registry.js';

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const PATH = new RegExp(`^/(${SLUG})/(${SLUG})(?:\\s*<\\s*(${SLUG})\\s*>|\\s+(${SLUG}))?$`);
const ALIAS = new RegExp(`^/(${SLUG})$`);

/** How many suggestions a search answers at most. */
export const MAX_SUGGESTIONS = 5;

/** The words of a string, lower-cased, split on anything not a letter or digit. */
export const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Edit distance with adjacent swaps (optimal string alignment). */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** How well one typed word matches one listed word: 3 exact, 2 prefix or one typo, 1 two typos, else 0. */
export function wordScore(typed, listed) {
  if (typed === listed) return 3;
  if (typed.length >= 3 && listed.startsWith(typed)) return 2;
  if (typed.length < 4) return 0;
  const n = distance(typed, listed);
  if (n <= 1) return 2;
  if (n <= 2 && typed.length >= 6) return 1;
  return 0;
}

/** The words an entry is searched by: its label, module title, section, aliases and path. */
const searchWords = (e) => [...new Set([
  ...words(e.label), ...words(e.moduleTitle), ...words(e.sectionTitle), ...e.aliases.flatMap(words), ...words(e.path),
])];

/** An entry's score for a query: each typed word's best match, summed; 0 when no word matched. */
export function score(entry, query) {
  const typed = words(query);
  if (!typed.length) return 0;
  const listed = searchWords(entry);
  let total = 0;
  for (const t of typed) total += Math.max(0, ...listed.map((l) => wordScore(t, l)));
  return total;
}

/** The best entries for a query, at most `limit`, best first; ties keep the registry's order. */
export function search(query, entries, limit = MAX_SUGGESTIONS) {
  return entries.map((entry, i) => ({ entry, i, s: score(entry, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.entry);
}

const answer = (text, entries) => {
  const suggestions = search(text, entries);
  return suggestions.length ? { suggestions } : { unknown: text };
};

/**
 * Parse what was typed. `viewer` is `{ role, spinoutLabActive }`; an entry
 * the viewer may not see is never answered, suggested or hinted at.
 */
export function parse(input, { viewer, entries = ENTRIES } = {}) {
  const text = String(input ?? '').trim();
  const visible = entries.filter((e) => visibleTo(e, viewer));
  if (!text) return { unknown: '' };
  const lower = text.toLowerCase();
  const path = PATH.exec(lower);
  if (path) {
    const [, section, module, bracketed, spaced] = path;
    const action = bracketed || spaced || null;
    const entry = visible.find((e) => e.kind !== 'shortcut' && e.section === section && e.module === module && e.action === action);
    return entry ? { entry } : answer(text, visible);
  }
  const alias = ALIAS.exec(lower);
  if (alias) {
    const entry = visible.find((e) => e.aliases.includes(alias[1]));
    if (entry) return { entry };
  }
  return answer(text, visible);
}
