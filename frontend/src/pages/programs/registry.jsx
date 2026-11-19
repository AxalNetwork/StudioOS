/**
 * D6966 (#6966) — the program presentation map, collected: every file under `catalog/` is one
 * program's entry (registry key → canonical page → committed PDF), and every file under
 * `content/` is that program's sections and slides. Adding a program adds files there and edits
 * nothing here (#6965: nine sibling PRs add one program each, in parallel).
 *
 * The entries are eager (small, plain data: the index, the admin links and /events read them);
 * the content is lazy, so a page that only links a presentation does not carry its prose.
 */
import { collectPrograms } from './collect.js';

export const PROGRAMS = collectPrograms(import.meta.glob('./catalog/*.js', { eager: true }));

const CONTENT = import.meta.glob('./content/*.js');

/** The map entry for a registry key, or null when the program has no presentation. */
export function programFor(key) {
  return PROGRAMS.find((p) => p.key === key) || null;
}

/** The canonical page of a program's presentation, or null when it has none. */
export function presentationHref(key) {
  return programFor(key)?.canonical || null;
}

/** A program's content module (`content/<key>.js`), loaded on demand; null when it has none. */
export function loadContent(key) {
  const load = CONTENT[`./content/${key}.js`];
  return load ? load().then((m) => m.default) : Promise.resolve(null);
}
