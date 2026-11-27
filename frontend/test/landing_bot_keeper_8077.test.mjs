/**
 * #8077 (D6476-p6): at most three branch-keeper attempts per pull request, the count in the sticky comment, and a
 * definitive hand-back on the third. Plain data for the plan, the sticky and the ejection decision.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decide } from '../../scripts/landing-bot/ejection-rules.mjs';
import { attemptLines, composeSticky, conflictOutcome, KEEPER_MAX_ATTEMPTS, keeperAttempts, plan } from '../../scripts/landing-bot/keeper-plan.mjs';

const ROOT = new URL('../../', import.meta.url);
const NOW = Date.parse('2026-11-22T12:00:00Z');
const BOT = 'axal-landing-bot[bot]';
const line = (k, what = 'conflicts in 1 file(s)') => `Keeper attempt ${k} of 3: ${what}`;
const sticky = (...ks) => ['<!-- landing-bot -->', ...ks.map((k) => line(k)), '', 'Merging main into this branch leaves conflicts in:'].join('\n');
const tried = (at, actor = BOT) => ({ at, actor });
const keeperCommit = (i) => ({ sha: String(i).repeat(40).slice(0, 40), parents: [{}, {}], author: { login: BOT }, committer: { login: BOT }, commit: { message: 'Merge main\n\nLanding-Bot-Kind: keeper', committer: { date: '2026-11-22T08:00:00Z' } } });
const work = { sha: 'b'.repeat(40), author: { login: 'someone' }, committer: { login: 'someone' }, commit: { message: 'work', committer: { date: '2026-11-22T09:00:00Z' } } };

function pr(over = {}) {
  return {
    number: 101, state: 'open', draft: false, body: 'Closes #9', labels: [], mergeable: 'CONFLICTING', inMergeQueue: false,
    headChangedAt: '2026-11-22T10:00:00Z', handedBackAt: null, keeperTriedEvents: [], stickyBody: '',
    head: { ref: 'agent/x/9-a', sha: 'b'.repeat(40), repo: { full_name: 'AxalNetwork/StudioOS' } },
    base: { repo: { full_name: 'AxalNetwork/StudioOS' } },
    files: [{ path: 'frontend/src/pages/A.jsx' }], commits: [work],
    ...over,
  };
}
const ctx = (over = {}) => ({
  env: { LANDING_BOT_ENABLED: 'true', LANDING_BOT_KEEPER_PER_SWEEP: '3', LANDING_BOT_DAILY_PUSHES: '10' },
  event: 'schedule', repo: 'AxalNetwork/StudioOS', breakers: { open: false, reasons: [] }, botLogin: BOT, now: NOW, pushesToday: [],
  ...over,
});
const planned = (p, c = ctx()) => plan([p], c).act.map((x) => x.number);
const why = (p, c = ctx()) => plan([p], c).skipped.map((s) => s.reasons.join('; ')).join(' | ');

test('#8077: the cap is three', () => {
  assert.equal(KEEPER_MAX_ATTEMPTS, 3);
});

test('#8077: 0 prior attempts is planned as attempt 1', () => {
  assert.deepEqual(keeperAttempts(pr(), BOT), { used: 0, reasons: [] });
  assert.deepEqual(planned(pr()), [101]);
});

test('#8077: 2 prior attempts (each record type) is planned as attempt 3', () => {
  // A conflict hand-back the session pushed past, then a keeper merge commit.
  const a = pr({ keeperTriedEvents: [tried('2026-11-22T07:00:00Z')], commits: [keeperCommit(1), work], labels: ['bot:keeper-tried'], handedBackAt: '2026-11-22T07:00:00Z' });
  assert.equal(keeperAttempts(a, BOT).used, 2);
  assert.deepEqual(planned(a), [101]);
  // Only the sticky lines (the label was already on, so GitHub wrote no second event).
  const b = pr({ keeperTriedEvents: [tried('2026-11-22T07:00:00Z')], stickyBody: sticky(1, 2), labels: ['bot:keeper-tried'], handedBackAt: '2026-11-22T07:00:00Z' });
  assert.equal(keeperAttempts(b, BOT).used, 2);
  assert.deepEqual(planned(b), [101]);
});

test('#8077: 3 prior attempts refuses a fourth, after a push and on a dispatch', () => {
  const three = pr({ stickyBody: sticky(1, 2, 3), labels: ['bot:keeper-tried', 'needs-session'], handedBackAt: '2026-11-22T07:00:00Z' });
  assert.equal(keeperAttempts(three, BOT).used, 3);
  // The session pushed at 10:00, after the hand-back: the old hand-back rule would plan it again; the cap does not.
  assert.deepEqual(planned(three), []);
  assert.match(why(three), /used 3 of 3 attempts on this pull request: handed back for good/);
  // A dispatch names this PR: still refused.
  const d = ctx({ env: { LANDING_BOT_ENABLED: 'dispatch', LANDING_BOT_DAILY_PUSHES: '10' }, event: 'workflow_dispatch', dispatchPr: 101 });
  assert.deepEqual(planned(three, d), []);
  assert.match(why(three, d), /handed back for good/);
  // Three from label events and commits together.
  const mixed = pr({ keeperTriedEvents: [tried('2026-11-22T06:00:00Z'), tried('2026-11-22T07:00:00Z')], commits: [keeperCommit(1), work] });
  assert.equal(keeperAttempts(mixed, BOT).used, 3);
  assert.deepEqual(planned(mixed), []);
});

test('#8077: only the App counts, and an unread record plans nothing', () => {
  const others = pr({ keeperTriedEvents: [tried('2026-11-22T06:00:00Z', 'a-person'), tried('2026-11-22T07:00:00Z', 'other[bot]'), tried('2026-11-22T07:30:00Z', null)] });
  assert.equal(keeperAttempts(others, BOT).used, 0);
  assert.deepEqual(planned(others), [101]);
  const personMerge = { ...keeperCommit(1), author: { login: 'a-person' }, committer: { login: 'a-person' } };
  assert.equal(keeperAttempts(pr({ commits: [personMerge, work] }), BOT).used, 0);
  for (const [name, over] of [['events', { keeperTriedEvents: null }], ['sticky', { stickyBody: null }], ['commits', { commits: null }]]) {
    assert.equal(keeperAttempts(pr(over), BOT).used, null, name);
    assert.deepEqual(planned(pr(over)), [], name);
  }
  assert.match(why(pr({ stickyBody: null })), /keeper attempt record could not be read/);
  assert.equal(keeperAttempts(pr(), undefined).used, null, 'no bot login');
});

test('#8077: the sticky comment keeps every attempt line, one per attempt, and says so at the third', () => {
  const first = composeSticky('', 1, 'conflicts in 2 file(s)', ['detail']);
  assert.deepEqual(first, ['Keeper attempt 1 of 3: conflicts in 2 file(s)', '', 'detail']);
  const body2 = ['<!-- landing-bot -->', ...first].join('\n');
  const second = composeSticky(body2, 2, 'merged main (abcdef0123)');
  assert.deepEqual(second.slice(0, 2), ['Keeper attempt 1 of 3: conflicts in 2 file(s)', 'Keeper attempt 2 of 3: merged main (abcdef0123)']);
  // A rerun of attempt 2 replaces its line, never adds a second one.
  const again = composeSticky(['<!-- landing-bot -->', ...second].join('\n'), 2, 'merged main (1111111111)');
  assert.equal(attemptLines(again.join('\n')).length, 2);
  assert.match(again.join('\n'), /attempt 2 of 3: merged main \(1111111111\)/);
  assert.doesNotMatch(again.join('\n'), /abcdef0123/);
  const third = composeSticky(['<!-- landing-bot -->', ...second].join('\n'), 3, 'conflicts in 1 file(s); handed back', ['x']);
  assert.deepEqual(attemptLines(third.join('\n')).map((l) => l.slice(0, 20)), ['Keeper attempt 1 of ', 'Keeper attempt 2 of ', 'Keeper attempt 3 of ']);
  assert.match(third.at(-1), /last of 3 keeper attempts: the keeper hands this pull request back to its session for good/);
  assert.doesNotMatch(second.join('\n'), /last of 3/);
  // Lines from another bot's sticky text are not attempts.
  assert.deepEqual(attemptLines('Keeper attempt one of 3: x\nkeeper attempt 1 of 3: y'), []);
});

test('#8077: a conflict on attempts 1 and 2 asks the resolver; on attempt 3 it hands back and asks no one', () => {
  for (const k of [1, 2]) {
    const c = conflictOutcome(k, ['a.js']);
    assert.equal(c.dispatch, true, `attempt ${k}`);
    assert.deepEqual(c.labels, ['conflict', 'bot:keeper-tried'], `attempt ${k}`);
    assert.match(c.lines.at(-1), /conflict resolver is asked/);
  }
  const last = conflictOutcome(3, ['a.js', 'b.js']);
  assert.equal(last.dispatch, false);
  assert.deepEqual(last.labels, ['conflict', 'bot:keeper-tried', 'needs-session']);
  assert.equal(last.outcome, 'conflicts in 2 file(s); handed back');
  assert.doesNotMatch(last.lines.join('\n'), /resolver/);
});

test('#8077: the ejection handler treats an exhausted keeper as the owner\'s, not a wait', () => {
  const base = { klass: 'conflict', mergeable: false, keeperMerged: false, removedAt: '2026-11-22T11:50:00Z', now: NOW, consent: { valid: true }, pr: 101, env: {} };
  // Inside the keeper's dispatch window, below the cap: the keeper is asked, as before.
  assert.equal(decide({ ...base, keeperAttempts: 2 }).action, 'keeper');
  assert.equal(decide({ ...base, keeperAttempts: null }).action, 'keeper', 'unknown changes nothing');
  const d = decide({ ...base, keeperAttempts: 3 });
  assert.equal(d.action, 'label');
  assert.equal(d.label, 'ejected');
  assert.match(d.reasons.join(' '), /used all 3 of its attempts/);
  // After the window, below the cap, it waits for the keeper's schedule; at the cap it never waits.
  const later = { ...base, removedAt: '2026-11-22T10:00:00Z' };
  assert.equal(decide({ ...later, keeperAttempts: 1 }).action, 'wait');
  assert.equal(decide({ ...later, keeperAttempts: 3 }).action, 'label');
});

test('#8077: keeper.mjs writes the attempt line on every outcome and never dispatches on the last', () => {
  const src = readFileSync(new URL('scripts/landing-bot/keeper.mjs', ROOT), 'utf8');
  // Every sticky write in the apply stage carries the attempt.
  const apply = src.slice(src.indexOf('export async function applyStage'));
  const writes = apply.match(/upsertSticky\([^;]*;/g) || [];
  assert.equal(writes.length, 5, "merged, update-branch, both refused, protected, conflicts");
  for (const w of writes) assert.match(w, /\{ k, outcome:/, w);
  assert.match(apply, /const c = conflictOutcome\(k, files\);[\s\S]*if \(c\.dispatch\) dispatch\.push\(planned\.number\);/);
  // The plan file carries the attempt number; the reader collects the App's label events and the sticky body.
  assert.match(src, /attempt: keeperAttempts\(p, env\.LANDING_BOT_LOGIN\)\.used \+ 1/);
  assert.match(src, /LabeledEvent\{createdAt actor\{login\} label\{name\}\}/);
  assert.match(src, /pr\.stickyBody = stickyComment\(/);
});
