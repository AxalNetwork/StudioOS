#!/usr/bin/env node
/**
 * Every `unbuilt` control now DRAWS, disabled, with its reason on hover — so
 * every one of those reasons is customer-facing copy, and this is the gate that
 * keeps it readable.
 *
 * THE FAILURE THIS EXISTS TO PREVENT HAS ALREADY HAPPENED ONCE, in the other
 * direction. The field began as `note`, drawn INLINE beside the control, and
 * the design's `Comparables` chip shipped to customers as "Comparables — no
 * competitor can be filed as a comparable: the form offers direct or adjacent,
 * and every writer coerces anything else to direct". Five zone headers became
 * essays. The correction was to render nothing, which made 170 canvas controls
 * invisible and produced five "elements are missing" reports in a week.
 *
 * Drawing them disabled with an opt-in tooltip is the third position. It only
 * works while the tooltip is a SENTENCE. Feed the same 189-character paragraph
 * into a `title` and the essay is back — hidden behind a hover, which is better,
 * but still a paragraph of design-review commentary aimed at a reader who
 * cannot act on any of it.
 *
 * SO THE TWO STRINGS HAVE TWO JOBS, and this asserts the split:
 *
 *   `unbuilt:` is the ENGINEERING reason. It may be as long as it needs to be
 *              and may name tables and columns — the person who can build the
 *              store reads it, in this file.
 *   `hover:`   is what a CUSTOMER reads. Required whenever `unbuilt` is longer
 *              than a tooltip should be, and held to the same bar when present:
 *              short, plain, and free of identifiers nobody outside this repo
 *              can resolve.
 *
 * When `hover` is absent the builders fall back to `unbuilt`, which is correct
 * for the ~140 reasons that are already one short sentence.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = 'frontend/src/workspaces';
const FILES = readdirSync(resolve(process.cwd(), DIR))
  .filter((f) => /^(founder|investor|advisor|partner)Zone(Actions|Filters)\.js$/.test(f));

/** The longest a tooltip may be before it stops being read. */
const CAP = 120;

/**
 * Identifiers a reader outside this repo cannot resolve. Backticked spans are
 * the giveaway — the tables carry `interview_pain_severities`, `updated_at`,
 * `loadEvidenceBase` and a dozen more, every one of them correct in an
 * engineering reason and meaningless in a tooltip.
 */
const JARGON = /`[^`]+`|\b[a-z]+_[a-z_]+\b/;

const problems = [];
let checked = 0;
let withHover = 0;

for (const file of FILES) {
  const src = readFileSync(resolve(process.cwd(), DIR, file), 'utf8');
  // One object literal per entry. `unbuilt` and `hover` are always plain
  // single-quoted strings in these tables, so a brace-balanced slice is enough
  // and there is no need to evaluate the module.
  for (const m of src.matchAll(/\{[^{}]*\bunbuilt: '((?:[^'\\]|\\.)*)'[^{}]*\}/gs)) {
    checked += 1;
    const entry = m[0];
    const label = (entry.match(/(?:label|canvas): '([^']+)'/) || [])[1] || '(unlabelled)';
    const unbuilt = m[1].replace(/\s+/g, ' ').trim();
    const hoverMatch = entry.match(/\bhover: '((?:[^'\\]|\\.)*)'/s);
    const hover = hoverMatch ? hoverMatch[1].replace(/\s+/g, ' ').trim() : null;
    if (hover) withHover += 1;

    const shown = hover ?? unbuilt;
    if (shown.length > CAP) {
      problems.push(
        `${file} · ${label} — the hover is ${shown.length} chars (cap ${CAP}). `
        + (hover ? 'Shorten it.' : 'Add a `hover:` beside the `unbuilt:` reason.'),
      );
    }
    if (JARGON.test(shown)) {
      problems.push(
        `${file} · ${label} — the hover names an identifier a reader cannot resolve: "${shown}". `
        + (hover ? 'Rewrite it in the reader\'s terms.' : 'Add a `hover:` that says it without the identifier.'),
      );
    }
  }
}

if (problems.length) {
  console.error('✖ check-zone-hover-copy:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nAn `unbuilt` control renders disabled with this text as its tooltip. The\n'
    + '`unbuilt:` string stays the engineering reason; add or shorten `hover:` for\n'
    + 'what the customer reads. See this file\'s header.',
  );
  process.exit(1);
}

console.log(
  `✓ check-zone-hover-copy: ${checked} unbuilt controls across ${FILES.length} tables all carry a `
  + `tooltip a reader can use (${withHover} needed their own \`hover:\`; the rest are already one sentence).`,
);
