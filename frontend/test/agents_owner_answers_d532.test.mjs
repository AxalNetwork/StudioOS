/**
 * D532 (#1075) — the owner's answer settles a pending question, and a screen
 * no canvas covers waits for one.
 *
 * Two rules joined the task protocol in AGENTS.md on 2026-10-04:
 *
 *   Owner answers. The owner answered #973 with a plain "A" at 09:53Z, and
 *     nothing acted on it until 11:15Z: no rule told a slot to read its own
 *     needs-decision issues, or said what an answer looks like. Each queue
 *     check now does, and a question comes as lettered options so that one
 *     letter answers it.
 *   Missing UI. Nothing sent a screen that no canvas covers back to design.
 *     The task now takes `needs-design`, Session 1 makes the Claude Design
 *     canvas, and the screen is built to it once the owner approves it.
 *
 * Each pin sits on the sentence an agent acts on. Read as text, as
 * agents_protocol_d503.test.mjs reads the same files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDecision } from './_decisions.mjs';

const root = resolve(process.cwd());
const at = (p) => readFileSync(resolve(root, p), 'utf8');

/** One `### <title>` section of AGENTS.md, whitespace collapsed; '' when absent. */
function section(title) {
  const md = at('AGENTS.md');
  const from = md.indexOf(`\n### ${title}\n`);
  if (from === -1) return '';
  const next = md.slice(from + 1).search(/\n#{2,3} /);
  return md.slice(from, next === -1 ? md.length : from + 1 + next).replace(/\s+/g, ' ');
}

/** Step 4 of the task protocol, whitespace collapsed. */
function blockedStep() {
  const md = at('AGENTS.md');
  const from = md.indexOf('\n4. **Blocked.**');
  const to = md.indexOf('\n5. **Finish.**', from);
  return from === -1 || to === -1 ? '' : md.slice(from, to).replace(/\s+/g, ' ');
}

test('labels.yml declares needs-design, so labels-sync creates it', () => {
  const entry = /^- name: "needs-design"\n {2}color: "[0-9A-Fa-f]{6}"\n {2}description: "[^"]+"$/m;
  assert.match(at('.github/labels.yml'), entry,
    'the Missing UI rule tells agents to add needs-design; labels-sync.yml creates only what labels.yml declares');
});

test('AGENTS.md lists needs-design with the other protocol labels', () => {
  assert.match(at('AGENTS.md'), /^\| `needs-design` \| .+ \|$/m,
    'the label table is where an agent learns which labels it may set');
});

test('a blocked question comes as lettered options, and a part that waits does not hold the rest', () => {
  const step = blockedStep();
  assert.match(step, /lettered options \(A, B, C\)/,
    'the owner answers with one letter; a question without options cannot be answered that way');
  assert.match(step, /`Part of #<issue>` instead of `Closes #<issue>`/,
    'a PR that builds only the parts that do not wait must leave the issue open for the part that does');
});

test('AGENTS.md says what an owner answer is, and what to do with one', () => {
  const s = section('Owner answers');
  assert.notEqual(s, '', 'AGENTS.md has no "### Owner answers" section');
  assert.match(s, /labelled `needs-decision` or `state:blocked`/,
    'each queue check must read the issues that wait on the owner');
  assert.match(s, /does not start with `S1:` and carries no STATUS block/,
    'Session 1 and the slots write as the owner account too; this is what tells an answer apart');
  assert.match(s, /Remove `needs-decision`, set `state:in-progress`/,
    'an answered issue must leave the owner\'s queue and go back to work');
});

test('AGENTS.md routes a screen with no canvas through needs-design and design/incoming/', () => {
  const s = section('Missing UI');
  assert.notEqual(s, '', 'AGENTS.md has no "### Missing UI" section');
  assert.match(s, /don't invent the layout/, 'the rule exists to stop agents inventing screens');
  assert.match(s, /Add `needs-design` to the issue/, 'the label is how Session 1 finds the screens to design');
  assert.match(s, /empty, `Not recorded` and `Unreadable` states/,
    'the description must cover the honesty states, or the canvas will draw invented figures');
  assert.match(s, /Session 1 commits its export under `design\/incoming\/`/,
    'an approved canvas must land where every agent can read it, not only on claude.ai');
});

test('both rules sit inside the task protocol, before the house rules', () => {
  const md = at('AGENTS.md');
  const protocol = md.indexOf('\n## Task protocol\n');
  const house = md.indexOf('\n## House rules (StudioOS)\n');
  const answers = md.indexOf('\n### Owner answers\n');
  const missing = md.indexOf('\n### Missing UI\n');
  assert.deepEqual(
    { answers: answers > protocol && answers < house, missing: missing > protocol && missing < house },
    { answers: true, missing: true },
    'an agent reads the task protocol to learn how work moves; a rule outside it is one it may skip',
  );
});

test('D532 records both rules', () => {
  const d = readDecision(532).replace(/\s+/g, ' ');
  assert.match(d, /^## D532 — /);
  assert.match(d, /needs-design/);
  assert.match(d, /#973/);
});
