/**
 * D526 — one file per decision from D526 on, and one numbering across both places.
 *
 * `scripts/check-decision-ids.mjs` reads `DECISIONS.md` (D1–D525) and every
 * `decisions/D*.md`. Its run under `test:guards` proves only that today's
 * corpus is clean, so these tests feed its exported rules corpora that are
 * wrong on purpose, one per failure the issue named, and the right-shaped twin
 * of each:
 *
 *   - a number in both places (or twice in either);
 *   - a file whose name and heading differ;
 *   - a heading above D525 in `DECISIONS.md`.
 *
 * Then the helper every later test reads a decision through, `readDecision`,
 * which finds an entry in either place, and the rule as the four rule files
 * now state it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  LAST_IN_DECISIONS_MD, allDecisionProblems, decisionFileProblems, decisionIdProblems,
  decisionIds, fileDecisionId, readDecisionFiles,
} from '../../scripts/check-decision-ids.mjs';
import { entryFrom, readDecision } from './_decisions.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MD = 'documentation/architecture/DECISIONS.md';
const DIR = 'documentation/architecture/decisions';

/** A minimal DECISIONS.md body ending at D525, as the real one does. */
const OLD = '## D524 — a\n\nbody\n\n## D525 — b\n\nbody\n';
const file = (n, heading = `## D${n} — title`) => ({ name: `D${n}.md`, md: `${heading}\n\nbody\n` });

test('D526: the real corpus is clean across both places, and D526 is the first file', () => {
  const md = read(MD);
  const files = readDecisionFiles();
  assert.deepEqual(allDecisionProblems(md, files), []);
  // Not just "no problems": a reader that found nothing would also find none.
  assert.ok(decisionIds(md).length > 400, 'DECISIONS.md no longer reads as the D1–D525 corpus');
  assert.equal(Math.max(...decisionIds(md)), LAST_IN_DECISIONS_MD);
  assert.equal(LAST_IN_DECISIONS_MD, 525);
  assert.ok(files.some((f) => f.name === 'D526.md'), 'D526 is not in the decisions folder');
  assert.ok(existsSync(resolve(process.cwd(), DIR, 'README.md')), 'the decisions folder does not explain itself');
});

test('D526: a number in both places is refused; the same number in one place is not', () => {
  const both = allDecisionProblems(`${OLD}\n## D527 — stray\n`, [file(527)]);
  assert.ok(both.some((p) => /D527 is in DECISIONS\.md and in .*D527\.md/.test(p)),
    `a number in both places was not reported: ${JSON.stringify(both)}`);
  // An old number reappearing as a file is the same collision from the other side.
  const old = allDecisionProblems(OLD, [file(525)]);
  assert.ok(old.some((p) => /D525 is in DECISIONS\.md and in/.test(p)));
  // The right shape: the old range in the file, the new one in files.
  assert.deepEqual(allDecisionProblems(OLD, [file(526), file(527)]), []);
  // Twice inside DECISIONS.md is still refused, as before D526.
  assert.ok(decisionIdProblems('## D1 — a\n\n## D1 — b\n').some((p) => /used twice/.test(p)));
});

test('D526: a file whose name and heading differ is refused; a matching one is not', () => {
  const wrong = decisionFileProblems([file(527, '## D528 — title')]);
  assert.equal(wrong.length, 1, JSON.stringify(wrong));
  assert.match(wrong[0], /D527\.md is headed D528/);
  assert.deepEqual(decisionFileProblems([file(527)]), []);
  // A file with no heading has no second address, but no address in the text either.
  assert.match(decisionFileProblems([{ name: 'D527.md', md: 'no heading here\n' }])[0], /has no `## D527` heading/);
  // One file holds one decision.
  const two = decisionFileProblems([{ name: 'D527.md', md: '## D527 — a\n\n## D528 — b\n' }]);
  assert.ok(two.some((p) => /holds 2 decision headings/.test(p)), JSON.stringify(two));
  // A heading quoted inside a fence is not a second decision.
  assert.deepEqual(decisionFileProblems([{ name: 'D527.md', md: '## D527 — a\n\n```md\n## D528 — quoted\n```\n' }]), []);
});

test('D526: a heading above D525 in DECISIONS.md is refused; D525 itself is not', () => {
  const above = decisionIdProblems(`${OLD}\n## D526 — written in the old place\n`);
  assert.equal(above.length, 1, JSON.stringify(above));
  assert.match(above[0], /D526 is a heading in DECISIONS\.md, which holds D1-D525 only/);
  assert.match(above[0], /decisions\/D526\.md/, 'the refusal does not say where the entry goes');
  assert.deepEqual(decisionIdProblems(OLD), []);
});

test('D526: the folder holds only new numbers, named D<n>.md', () => {
  assert.equal(fileDecisionId('D526.md'), 526);
  for (const bad of ['README.md', 'd526.md', 'D0526.md', 'D526-retro.md', 'D526.MD', 'D.md']) {
    assert.equal(fileDecisionId(bad), null, `${bad} was read as a decision file name`);
  }
  assert.match(decisionFileProblems([{ name: 'D526-retro.md', md: '## D526 — a\n' }])[0], /is not named D<n>\.md/);
  // D1–D525 live in DECISIONS.md, even where it has a gap at that number.
  assert.match(decisionFileProblems([file(511)])[0], /D1-D525 live in DECISIONS\.md/);
  assert.deepEqual(decisionFileProblems([file(526)]), []);
});

test('D526: readDecision finds an entry in either place, and only that entry', () => {
  const old = readDecision(510);
  assert.match(old, /^## D510\n/, 'an entry in DECISIONS.md does not start at its heading');
  assert.doesNotMatch(old, /^## D512\b/m, 'the entry ran on into the next decision');
  const fresh = readDecision(526);
  assert.match(fresh, /^## D526 — /);
  assert.match(fresh, /decisions\/D<n>\.md/, 'D526 does not record the rule it makes');
  assert.throws(() => readDecision(9999), /in neither/);
  assert.throws(() => readDecision('D12'), /not a decision number/);
  // A fenced `## D…` inside an entry does not end it, as the checker reads it.
  const md = '## D1 — a\n\n```md\n## D2 — quoted\n```\nstill D1\n\n## D2 — b\n';
  assert.equal(entryFrom(md, 1), '## D1 — a\n\n```md\n## D2 — quoted\n```\nstill D1');
  assert.equal(entryFrom(md, 2), '## D2 — b');
  assert.equal(entryFrom(md, 3), null);
});

test('D526: the rule files state the new rule, and none still says "in numeric position"', () => {
  const agents = read('AGENTS.md');
  const house = agents.slice(agents.indexOf('## House rules'));
  assert.match(house, /documentation\/architecture\/decisions\/D<n>\.md/, 'AGENTS.md does not say where a decision goes');
  assert.match(house, /`DECISIONS\.md` keeps D1 to D525 and\s+takes no new entries/);
  assert.match(house, /node scripts\/check-decision-ids\.mjs/);
  const claude = read('CLAUDE.md');
  assert.match(claude, /documentation\/architecture\/decisions\/D<n>\.md/, 'CLAUDE.md does not say where a decision goes');
  assert.match(claude, /`DECISIONS\.md` keeps D1 to D525 and takes no new entries/);
  for (const p of ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', '.github/pull_request_template.md']) {
    assert.doesNotMatch(read(p), /DECISIONS\.md` in numeric position|D-entry to\s+`?documentation\/architecture\/DECISIONS\.md/,
      `${p} still tells a PR to add its entry to DECISIONS.md`);
  }
  const readme = read(`${DIR}/README.md`);
  assert.match(readme, /keeps D1 to D525 and takes no new entries/);
  assert.match(readme, /`## D<n> — <title>`/);
});

/** A throwaway repo root holding a DECISIONS.md and a decisions/ folder. */
function fixtureRoot(md, files) {
  const root = mkdtempSync(join(tmpdir(), 'd526-'));
  mkdirSync(join(root, DIR), { recursive: true });
  writeFileSync(join(root, MD), md);
  for (const f of files) writeFileSync(join(root, DIR, f.name), f.md);
  return root;
}

test('D526: readDecision refuses a number found in both places, rather than picking one', () => {
  const root = fixtureRoot(`${OLD}\n## D527 — stray\n`, [file(527)]);
  try {
    assert.throws(() => readDecision(527, root), /D527 is in .*DECISIONS\.md and in .*D527\.md/);
    assert.match(readDecision(524, root), /^## D524 — a/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('D526: the script itself reads the folder, and fails the run on a collision', () => {
  // The exported rules are tested above; this is the wiring. A script that
  // checked DECISIONS.md alone would pass the colliding root.
  const script = resolve(process.cwd(), 'scripts/check-decision-ids.mjs');
  const bad = fixtureRoot(`${OLD}\n## D527 — stray\n`, [file(527)]);
  const good = fixtureRoot(OLD, [file(526)]);
  try {
    const r = spawnSync(process.execPath, [script], { cwd: bad, encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'a number in both places did not fail the run');
    assert.match(r.stderr, /D527 is in DECISIONS\.md and in/);
    const ok = spawnSync(process.execPath, [script], { cwd: good, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /1 in documentation\/architecture\/decisions\/, D526 through D526/);
  } finally {
    rmSync(bad, { recursive: true, force: true });
    rmSync(good, { recursive: true, force: true });
  }
});
