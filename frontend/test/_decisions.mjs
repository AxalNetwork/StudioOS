/**
 * `readDecision(id)` — one decision's text, wherever it lives (D526).
 *
 * D1 to D525 are entries in `documentation/architecture/DECISIONS.md`. From
 * D526 on each decision is its own file, `documentation/architecture/decisions/D<n>.md`.
 * A test that pins what a decision says should not have to know which side of
 * that line it is on, so it asks for the number and gets the entry: the heading
 * line and everything up to the next decision heading.
 *
 * A number found in both places, or in neither, throws. Either is a broken
 * corpus, and a test reading the wrong one would pass on text nobody meant.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DECISIONS_MD = 'documentation/architecture/DECISIONS.md';
const DECISIONS_DIR = 'documentation/architecture/decisions';

/** A `D<n>` heading at any level, at the start of a line, with whitespace after the hashes. */
const HEADING = /^#{1,6}[ \t]+D(\d+)\b/;

/**
 * The entry for `id` in one Markdown body, or null.
 *
 * Fenced blocks are skipped when looking for headings, as `check-decision-ids`
 * skips them: an entry quoting `## D62` inside a fence has not started D62, and
 * cutting it there would hand a test half an entry.
 */
export function entryFrom(md, id) {
  const lines = md.split('\n');
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = HEADING.exec(lines[i]);
    if (!m) continue;
    if (start >= 0) return lines.slice(start, i).join('\n').trimEnd();
    if (Number(m[1]) === id) start = i;
  }
  return start >= 0 ? lines.slice(start).join('\n').trimEnd() : null;
}

/** Decision `id`'s text, from `DECISIONS.md` or from its own file. Throws if it is in neither, or both. */
export function readDecision(id, root = process.cwd()) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw new Error(`readDecision: ${id} is not a decision number`);
  const fromMd = entryFrom(readFileSync(resolve(root, DECISIONS_MD), 'utf8'), n);
  const file = resolve(root, DECISIONS_DIR, `D${n}.md`);
  const fromFile = existsSync(file) ? readFileSync(file, 'utf8').trimEnd() : null;
  if (fromMd != null && fromFile != null) {
    throw new Error(`readDecision: D${n} is in ${DECISIONS_MD} and in ${DECISIONS_DIR}/D${n}.md`);
  }
  if (fromMd == null && fromFile == null) {
    throw new Error(`readDecision: D${n} is in neither ${DECISIONS_MD} nor ${DECISIONS_DIR}/D${n}.md`);
  }
  return fromMd ?? fromFile;
}
