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
 *
 * TWO PLACES SINCE D526. `DECISIONS.md` changed in 130 of 624 commits between
 * 2 August and 3 October 2026, and every PR inserted its entry "in numeric
 * position", so two open PRs almost always collided there. From D526 on each
 * decision is its own file, `decisions/D<n>.md`, and `DECISIONS.md` keeps
 * D1-D525. The number is still one address across both places, so this check
 * reads both, and it refuses the three ways the split can go wrong:
 *
 *   - the same number in both places (or twice in either);
 *   - a file whose name and heading disagree, which makes the file name a
 *     second, contradicting address (`D527.md` headed `## D528`);
 *   - a heading above D525 in `DECISIONS.md`, which is the old habit
 *     reopening the collision the split exists to end.
 *
 * Alongside those, the same boundary from the other side: a file numbered at
 * or below D525 (that range lives in `DECISIONS.md`), a file that is not named
 * `D<n>.md` (every file in the folder but its README is read, so a misnamed
 * one is refused rather than skipped), a file with no heading or whose first
 * line is not `## D<n> — <title>`, and a file holding more than one decision.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const FILE = 'documentation/architecture/DECISIONS.md';
const DIR = 'documentation/architecture/decisions';
/** The last number `DECISIONS.md` holds; D526 onwards are files in `DIR` (D526). */
export const LAST_IN_DECISIONS_MD = 525;

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
    if (id > LAST_IN_DECISIONS_MD) {
      problems.push(
        `D${id} is a heading in DECISIONS.md, which holds D1-D${LAST_IN_DECISIONS_MD} only.`
        + ` From D${LAST_IN_DECISIONS_MD + 1} on each decision is its own file: ${DIR}/D${id}.md.`,
      );
    }
  });

  return problems;
}

/** `D527.md` → 527; anything else (README.md, d527.md, D0527.md, D527-x.md) → null. */
export function fileDecisionId(name) {
  const m = /^D([1-9]\d*)\.md$/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * The first line of a decision file: `## D<n> — <title>`, at exactly that
 * level, with the em dash and a title. The folder README and AGENTS.md both
 * state this shape, so a reader can find an entry by its first line.
 */
const FIRST_LINE = /^## D([1-9]\d*) — \S/;

/**
 * The problems in the per-decision files, as readable lines.
 *
 * `files` is `[{ name, md }]` for every entry in the folder except its
 * README, so a misnamed file is reported instead of skipped. Exported for the
 * same reason as `decisionIdProblems`: the test feeds it folders that are
 * wrong on purpose.
 */
export function decisionFileProblems(files) {
  const problems = [];
  for (const { name, md } of files) {
    const n = fileDecisionId(name);
    if (n == null) {
      problems.push(`${name} is not named D<n>.md, so its number cannot be read from its name.`);
      continue;
    }
    if (n <= LAST_IN_DECISIONS_MD) {
      problems.push(
        `${name} is numbered D${n}, but D1-D${LAST_IN_DECISIONS_MD} live in DECISIONS.md.`
        + ` A new decision takes a number above D${LAST_IN_DECISIONS_MD}, from the issue.`,
      );
    }
    const heads = decisionIds(md);
    if (!heads.length) {
      problems.push(`${name} has no \`## D${n}\` heading. The heading is how a reader finds the entry.`);
    } else if (!FIRST_LINE.test(md.split(/\r?\n/, 1)[0])) {
      problems.push(
        `${name} does not start with \`## D${n} — <title>\`. The first line is the heading,`
        + ' at level 2, with an em dash and a title, as the folder README says.',
      );
    } else if (heads[0] !== n) {
      problems.push(
        `${name} is headed D${heads[0]}. A file's name and its heading are the same number,`
        + ' or the entry has two addresses that disagree.',
      );
    }
    if (heads.length > 1) {
      problems.push(`${name} holds ${heads.length} decision headings; one file holds one decision.`);
    }
  }
  return problems;
}

/**
 * Everything wrong across both places: `DECISIONS.md`'s own rules, the files'
 * rules, and any number that appears in both.
 */
export function allDecisionProblems(md, files) {
  const problems = [...decisionIdProblems(md), ...decisionFileProblems(files)];
  const inMd = new Set(decisionIds(md));
  for (const { name, md: body } of files) {
    for (const id of decisionIds(body)) {
      if (inMd.has(id)) {
        problems.push(
          `D${id} is in DECISIONS.md and in ${DIR}/${name}.`
          + ' A decision number is an address; two entries cannot share one.',
        );
      }
    }
  }
  return problems;
}

/**
 * Everything in the decisions folder but its README, as `[{ name, md }]`;
 * none when the folder does not exist.
 *
 * NOTHING IS PRE-FILTERED BY NAME. A `d527.md` or `D527.MD` left out here would
 * never reach the name check, so the run would pass with a decision nobody can
 * find by number, and a later `D527.md` could take the same number. Every entry
 * is returned and `decisionFileProblems` refuses the misnamed ones. Dotfiles
 * (an editor's or the OS's own) are skipped. A subfolder is returned with a
 * trailing `/` and no text, so it is refused by name as well.
 */
export function readDecisionFiles(root = process.cwd()) {
  const dir = resolve(root, DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.name !== 'README.md' && !e.name.startsWith('.'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => (e.isFile()
      ? { name: e.name, md: readFileSync(join(dir, e.name), 'utf8') }
      : { name: `${e.name}/`, md: '' }));
}

// Guarded so the functions can be imported by a test without the scan running.
if (import.meta.url === `file://${process.argv[1]}`) {
  const md = readFileSync(resolve(process.cwd(), FILE), 'utf8');
  const files = readDecisionFiles();
  const problems = allDecisionProblems(md, files);

  if (problems.length) {
    console.error('✖ check-decision-ids:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\nIn ${FILE} and ${DIR}/. A new decision is its own file there,`);
    console.error('named and headed with the number its issue gives: every earlier');
    console.error('entry that cites a duplicate is now ambiguous, and citation by');
    console.error('number is how these files are read.');
    process.exit(1);
  }

  const ids = decisionIds(md);
  const fileIds = files.map((f) => fileDecisionId(f.name)).sort((a, b) => a - b);
  console.log(
    `✓ check-decision-ids: ${ids.length} decisions in DECISIONS.md, D${ids[0]} through D${ids[ids.length - 1]}`
    + ' in increasing order, and '
    + (fileIds.length
      ? `${fileIds.length} in ${DIR}/, D${fileIds[0]} through D${fileIds[fileIds.length - 1]}`
      : `none yet in ${DIR}/`)
    + '; all distinct.',
  );
}
