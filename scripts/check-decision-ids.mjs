#!/usr/bin/env node
/**
 * Every decision in DECISIONS.md has its own number, and the numbers go up.
 *
 * WHY THIS EXISTS. `documentation/architecture/DECISIONS.md` is append-only by
 * convention: a new decision takes the next free number and cites earlier ones
 * by it ("D42 says the two entities must not drift into each other"). A number
 * is therefore an ADDRESS, and two decisions sharing one makes every citation
 * of it ambiguous — the reader cannot tell which entry was meant, and neither
 * can the next writer.
 *
 * IT HAS ALREADY HAPPENED, WHICH IS WHY THE FILE IS HERE. On 2026-09-08 two
 * commits landed a `D62` each:
 *
 *   1563f0aa8  "The production baseline closes the fresh-build gap D60 recorded"
 *   8aa529425  "The baseline is the same kind of artifact schema.sql was …"
 *
 * The first went straight to `main` with no PR; the second was written against
 * that `main` by an author who read the file for its format, took the next
 * number from the highest heading they had looked at, and did not re-check.
 * Nothing failed. The whole suite stayed green, because the numbering was a
 * convention nobody had written down as a check — and a convention that only
 * lives in reviewers' heads is one that a fast-moving repo loses.
 *
 * THE INVARIANT IS "UNIQUE AND STRICTLY INCREASING", NOT "NO GAPS". A gap is
 * legitimate: a decision can be withdrawn, or a number can be claimed in one
 * branch and abandoned. What can never be right is two entries answering to the
 * same address, or the file reading D60, D62, D61 — which means the next writer
 * cannot find the highest number by looking at the end.
 *
 * D-numbers live at two heading levels: D1-D52 are `###` under "Part 1", D53
 * onwards are `##` under "Part 2". Matching only one level would have missed
 * this collision entirely, since both of its headings are `##`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = 'documentation/architecture/DECISIONS.md';

/**
 * Fenced code blocks are stripped first.
 *
 * DECISIONS.md quotes SQL, shell and JS at length, and a fenced block is free
 * to contain a line starting with `## D…` — a diff hunk of this very file
 * would. Treating that as a heading would fail the build over a quotation,
 * which is the kind of false positive that gets a guard deleted rather than
 * fixed.
 */
const stripFences = (md) => md.replace(/^```[\s\S]*?^```/gm, '');

/** Every `D<n>` heading in file order, at any heading level. */
export function decisionIds(md) {
  return [...stripFences(md).matchAll(/^#{1,6}[ \t]+D(\d+)\b/gm)]
    .map((m) => Number(m[1]));
}

/**
 * The problems in one DECISIONS.md body, as readable lines.
 *
 * EXPORTED SO THE RULE CAN BE TESTED WITHOUT THE REAL FILE. A guard whose only
 * input is the repo's own current state passes for as long as the repo happens
 * to be clean, and says nothing about what it would catch. The test feeds it
 * bodies that are deliberately wrong.
 */
export function decisionIdProblems(md) {
  const ids = decisionIds(md);
  const problems = [];
  const seen = new Map();

  ids.forEach((id, i) => {
    if (seen.has(id)) {
      problems.push(
        `D${id} is used twice — headings ${seen.get(id) + 1} and ${i + 1}.`
        + ' A decision number is an address; two entries cannot share one.',
      );
    } else {
      seen.set(id, i);
    }
    if (i > 0 && id < ids[i - 1]) {
      problems.push(
        `D${id} follows D${ids[i - 1]}, so the numbers go backwards here.`
        + ' The next writer finds the highest number by reading the end.',
      );
    }
  });

  return problems;
}

// Guarded so the two functions can be imported by a test without the scan running.
if (import.meta.url === `file://${process.argv[1]}`) {
  const md = readFileSync(resolve(process.cwd(), FILE), 'utf8');
  const problems = decisionIdProblems(md);

  if (problems.length) {
    console.error('✖ check-decision-ids:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\nIn ${FILE}. Give the new decision the next free number:`);
    console.error('every earlier entry that cites a duplicate is now ambiguous,');
    console.error('and citation by number is how this file is read.');
    process.exit(1);
  }

  const ids = decisionIds(md);
  console.log(
    `✓ check-decision-ids: ${ids.length} decisions, all distinct,`
    + ` D${ids[0]} through D${ids[ids.length - 1]} in increasing order.`,
  );
}
