/**
 * The DECISIONS.md numbering rule, tested against bodies that are wrong on
 * purpose.
 *
 * `scripts/check-decision-ids.mjs` runs under `test:guards` against the real
 * file, and that run only proves the file is clean TODAY. It says nothing about
 * what the rule would catch — a predicate loosened to `return []` would keep
 * that run green forever. These tests feed the exported function the shapes it
 * exists to refuse.
 *
 * The collision it was written for is real: `1563f0aa8` and `8aa529425` each
 * landed a `## D62` on 2026-09-08, and the whole suite stayed green.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  allDecisionProblems, decisionFileProblems, decisionIds, decisionIdProblems, filePart, readDecisionFiles,
} from '../../scripts/check-decision-ids.mjs';

const DECISIONS = resolve(process.cwd(), 'documentation/architecture/DECISIONS.md');

test('the real file is clean, and has decisions to be clean about', () => {
  const ids = decisionIds(readFileSync(DECISIONS, 'utf8'));
  // Not just "no problems" — a regex that matched nothing would also report no
  // problems, and would be the silent way for this guard to stop working.
  assert.ok(ids.length > 50, `expected the corpus of decisions, saw ${ids.length}`);
  assert.deepEqual(decisionIdProblems(readFileSync(DECISIONS, 'utf8')), []);
});

test('both heading levels count, because D1-D52 are ### and D53+ are ##', () => {
  assert.deepEqual(decisionIds('### D1 — a\n\n## D2 — b\n'), [1, 2]);
  // The collision that prompted this guard was between two `##` headings; a
  // rule that only read `###` would have passed it.
  assert.equal(decisionIdProblems('## D62 — one\n\n## D62 — two\n').length, 1);
});

test('a duplicate is refused at either level', () => {
  for (const md of [
    '## D1 — a\n\n## D1 — b\n',
    '### D7 — a\n\n### D7 — b\n',
    '### D9 — a\n\n## D9 — b\n',
  ]) {
    const problems = decisionIdProblems(md);
    assert.equal(problems.length, 1, `expected one problem for ${JSON.stringify(md)}`);
    assert.match(problems[0], /used twice/);
  }
});

test('numbers going backwards are refused, separately from duplication', () => {
  const problems = decisionIdProblems('## D60 — a\n\n## D62 — b\n\n## D61 — c\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /backwards/);
  // D61 after D62 is out of order but not a duplicate — the two failures are
  // distinct, and reporting one as the other would mislead whoever fixes it.
  assert.doesNotMatch(problems[0], /used twice/);
});

test('a gap is allowed — a withdrawn decision must not fail the build', () => {
  assert.deepEqual(decisionIdProblems('## D1 — a\n\n## D5 — b\n\n## D9 — c\n'), []);
});

test('a fenced code block is not a heading, even when it contains one', () => {
  // A diff of this very file, quoted in a decision, starts lines with `## D…`.
  const md = [
    '## D1 — a',
    '',
    '```md',
    '## D1 — quoted, not declared',
    '## D0 — also quoted',
    '```',
    '',
    '## D2 — b',
  ].join('\n');
  assert.deepEqual(decisionIds(md), [1, 2]);
  assert.deepEqual(decisionIdProblems(md), []);
});

test('a D-number that is not a heading is not counted', () => {
  // Prose cites decisions constantly ("D42 says …"); only headings declare one.
  const md = '## D1 — a\n\nThis follows D1 and refines D40 without replacing it.\n';
  assert.deepEqual(decisionIds(md), [1]);
});

test('the heading marker must START the line, not merely appear in it', () => {
  // Found by mutation: dropping the `^` anchor broke nothing any other test
  // could see, because every case above puts its hashes at column zero. Prose
  // in this file does quote heading markers inline — a decision explaining a
  // renumber says so by writing the old heading mid-sentence — and counting
  // those would invent decisions that were never declared.
  const md = '## D1 — a\n\nIt renamed the second ## D62 — heading to D63.\n';
  assert.deepEqual(decisionIds(md), [1]);
  assert.deepEqual(decisionIdProblems(md), []);
});

test('hashes with no space after them are not a heading, because Markdown says so', () => {
  // Also found by mutation. CommonMark requires whitespace after the `#` run,
  // so `##D9` renders as literal text — counting it would declare a decision
  // that no reader of the rendered file can see.
  assert.deepEqual(decisionIds('## D1 — a\n##D9 not a heading\n'), [1]);
});

test('D followed by more digits is one number, not a prefix match', () => {
  // `## D6` must not match the heading `## D62`, or every decision above 9
  // would collide with its own prefix.
  assert.deepEqual(decisionIds('## D6 — a\n\n## D62 — b\n'), [6, 62]);
  assert.deepEqual(decisionIdProblems('## D6 — a\n\n## D62 — b\n'), []);
});

// ── D5615 (#5615): a later part of a multi-part issue is its own file ────────

const parent = { name: 'D4589.md', md: '## D4589 — Build the thing (#4589)\n\nBody.\n' };
const part = (name, first) => ({ name, md: `${first}\n\nWhat part 2 decided.\n` });

test('D5615: a part file is read as its decision and part, and nothing else is', () => {
  assert.deepEqual(filePart('D4589-p2.md'), { id: 4589, part: 2 });
  for (const bad of ['D4589.md', 'D4589-p0.md', 'D4589-p02.md', 'D4589-part2.md', 'D4589-P2.md', 'd4589-p2.md', 'D4589-p2.MD']) {
    assert.equal(filePart(bad), null, `${bad} was read as a part file`);
  }
});

test('D5615: D<n>-p2.md is accepted beside its parent D<n>.md', () => {
  assert.deepEqual(decisionFileProblems([parent, part('D4589-p2.md', '## D4589 part 2 — The second part (#4589)')]), []);
  // And through the whole check, beside DECISIONS.md.
  assert.deepEqual(allDecisionProblems('## D1 — a\n', [parent, part('D4589-p2.md', '## D4589 part 2 — The second part (#4589)')]), []);
});

test('D5615: a part file with no parent fails, naming the parent it lacks', () => {
  const problems = decisionFileProblems([part('D4589-p2.md', '## D4589 part 2 — The second part (#4589)')]);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^D4589-p2\.md has no parent: D4589\.md is not in the folder/);
});

test('D5615: a part heading citing another issue, or none, fails', () => {
  const wrong = decisionFileProblems([parent, part('D4589-p2.md', '## D4589 part 2 — The second part (#4590)')]);
  assert.equal(wrong.length, 1, wrong.join('\n'));
  assert.match(wrong[0], /a part's heading cites its own issue, #4589.*It cites #4590/);
  assert.match(decisionFileProblems([parent, part('D4589-p2.md', '## D4589 part 2 — The second part')])[0], /It cites no issue/);
});

test('D5615: the heading names the same decision and part as the file, in the part shape', () => {
  assert.match(decisionFileProblems([parent, part('D4589-p2.md', '## D4589 part 3 — Off by one (#4589)')]).join('\n'),
    /D4589-p2\.md is headed D4589 part 3/);
  assert.match(decisionFileProblems([parent, part('D4589-p2.md', '## D4589 — Not a part heading (#4589)')]).join('\n'),
    /does not start with `## D4589 part 2 — <title> \(#4589\)`/);
  assert.match(decisionFileProblems([parent, part('D4589-p2.md', '## D4589 part 2 — Two (#4589)\n\n## D4590 — b')]).join('\n'),
    /holds 2 decision headings/);
  // Parts are for decisions numbered by their issue.
  const old = { name: 'D1650.md', md: '## D1650 — An older number\n' };
  assert.match(decisionFileProblems([old, part('D1650-p2.md', '## D1650 part 2 — Later (#1650)')]).join('\n'),
    /parts are for decisions numbered by their issue, D4000 up/);
});

test('D5615: a misnamed file is still refused, and the refusal names both shapes', () => {
  const problems = decisionFileProblems([{ name: 'D4589-part2.md', md: '## D4589 part 2 — x (#4589)\n' }]);
  assert.match(problems[0], /is not named D<n>\.md.*D<n>-p<k>\.md/);
});

test('D5615: the real folder is clean, parts included', () => {
  assert.deepEqual(allDecisionProblems(readFileSync(DECISIONS, 'utf8'), readDecisionFiles()), []);
});
