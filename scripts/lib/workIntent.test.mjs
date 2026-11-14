// D5580 (#5580 part 2): the WorkIntent view over #5617's claim refs, its determinism rules and the soft recommendation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimMessage, parseClaim } from './claims.mjs';
import { annotate } from './prRisk.mjs';
import { pairs } from './prOverlap.mjs';
import {
  checkSlot, dependenciesOf, deriveIntents, filesFromStatus, pairAction, parseStatus, pathAction, recommend, resolve, registrations,
  walkClaim, workInFlightText, unreadableWork,
} from './workIntent.mjs';
import { readWork, report } from '../pr-overlap.mjs';

const MAIN = 'a'.repeat(40), OLD_MAIN = 'b'.repeat(40);
const hex = n => String(n).padStart(40, 'e');
const NOW = Date.parse('2026-11-14T12:00:00Z');
const claim = (issue, slot, at, ttlHours = 24) => parseClaim(claimMessage({ issue, slot, agent: 'Claude', session: 'sess-1', at, ttlHours }));
/** A walked claim ref: one claim (no renewal) whose parent is main at `baseDate`. */
const ref = (issue, slot, at, { baseDate = '2026-11-14T00:00:00Z', ttlHours = 24, base = MAIN } = {}) => {
  const c = claim(issue, slot, at, ttlHours);
  return { head: { sha: hex(issue), claim: c }, root: { sha: hex(issue), claim: c }, base: { sha: base, date: baseDate } };
};
const status = (issue, slot, state, { agent = 'Claude', files = 'none', pr = 'none yet' } = {}) =>
  ['```text', 'STATUS', `task: #${issue}   slot: ${slot}   agent: ${agent}`, 'branch: b', `state: ${state}`, `files: ${files}`,
    'blockers: none', 'questions: none', 'tests: none', `pr: ${pr}`, '```'].join('\n');
let commentId = 0;
const comment = (created_at, body, author_association = 'MEMBER') => ({ id: ++commentId, created_at, author_association, body });
const openIssue = (number, labels = [], body = '') => ({ number, state: 'open', labels: labels.map(name => ({ name })), body });
const prRow = (number, paths, extra = {}) => ({ number, files: paths.map(filename => ({ filename, status: 'modified' })), head: { sha: hex(9000 + number), ref: 'x' }, body: '', ...extra });

test('STATUS, files line, dependencies and slot checks parse deterministically', () => {
  const st = parseStatus(status(5580, 'S03', 'IN_PROGRESS', { files: '`scripts/lib/workIntent.mjs`, scripts/pr-overlap.mjs; README', pr: 'https://github.com/o/r/pull/5800' }));
  assert.deepEqual({ ...st, files: undefined }, { issue: 5580, slot: 'S03', agent: 'Claude', state: 'IN_PROGRESS', files: undefined, pr: 5800 });
  assert.deepEqual(filesFromStatus(st.files), ['scripts/lib/workIntent.mjs', 'scripts/pr-overlap.mjs']);
  assert.deepEqual(filesFromStatus('../etc/passwd, /abs/x.ts, scripts/*.mjs, none, a.md.'), ['a.md']);
  assert.equal(parseStatus(status(1, 'S01', 'IN_PROGRESS | BLOCKED')).state, null);
  assert.equal(parseStatus('task: #1   slot: S01   agent: x'), null);
  assert.deepEqual(dependenciesOf('Depends on #12. blocked by #7, depends on #12; part of #5577'), [7, 12]);
  assert.deepEqual(checkSlot('s39', new Set(['S39'])), { ok: true, slot: 'S39' });
  assert.deepEqual(checkSlot('slot:S05'), { ok: true, slot: 'S05' });
  assert.equal(checkSlot('Claude').ok, false);
  assert.equal(checkSlot('S00').ok, false);
  assert.match(checkSlot('S40', new Set(['S01'])).reason, /unknown: no slot:S40 label/);
  assert.match(checkSlot('S40', null).note, /not verified/);
});

test('walkClaim follows renewals to the root claim and takes the first non-claim parent as the base', async () => {
  const c1 = claimMessage({ issue: 7, slot: 'S02', agent: 'A', session: 's', at: '2026-11-13T00:00:00Z' });
  const c2 = claimMessage({ issue: 7, slot: 'S02', agent: 'A', session: 's', at: '2026-11-14T00:00:00Z' });
  const commits = {
    [hex(2)]: { message: c2, parents: [{ sha: hex(1) }] },
    [hex(1)]: { message: c1, parents: [{ sha: MAIN }] },
    [MAIN]: { message: 'Merge (#1)', parents: [{ sha: OLD_MAIN }], committer: { date: '2026-11-12T23:00:00Z' } },
  };
  const read = async sha => commits[sha];
  const walked = await walkClaim(7, hex(2), read);
  assert.equal(walked.root.sha, hex(1));
  assert.equal(walked.root.claim.at, '2026-11-13T00:00:00.000Z');
  assert.equal(walked.head.claim.at, '2026-11-14T00:00:00.000Z');
  assert.deepEqual(walked.base, { sha: MAIN, date: '2026-11-12T23:00:00Z' });
  assert.match((await walkClaim(7, hex(2), read, { maxHops: 1 })).reason, /more than 1 renewals/);
  assert.equal((await walkClaim(8, hex(2), read)).head, null);
  assert.equal((await walkClaim(7, 'nope', read)).head, null);
});

test('duplicate registration: one intent per issue, the earlier claim wins and the loser is noted', () => {
  // The 403 fallback: two STATUS claims, no ref. S05 posted first.
  const records = [{ issue: 10, issueRow: openIssue(10, ['state:in-progress']), comments: [
    comment('2026-11-14T02:00:00Z', status(10, 'S07', 'IN_PROGRESS')),
    comment('2026-11-14T01:00:00Z', status(10, 'S05', 'IN_PROGRESS', { files: 'a/b.ts' })),
  ] }];
  const { intents, notes } = deriveIntents({ records, now: NOW });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].holder.slot, 'S05');
  assert.deepEqual([intents[0].paths, intents[0].pathsSource], [['a/b.ts'], 'status']);
  assert.deepEqual(notes, ['#10: duplicate registration: STATUS claim by S07 (Claude) at 2026-11-14T02:00:00.000Z loses to the earlier STATUS claim by S05 (Claude) at 2026-11-14T01:00:00.000Z']);
  // A claim ref beats a later STATUS by another holder; its own holder's STATUS only adds files; an older one is history.
  const withRef = deriveIntents({ now: NOW, records: [{ issue: 11, ref: ref(11, 'S03', '2026-11-14T05:00:00Z'), issueRow: openIssue(11), comments: [
    comment('2026-11-14T04:00:00Z', status(11, 'S09', 'BLOCKED')),
    comment('2026-11-14T06:00:00Z', status(11, 'S03', 'IN_PROGRESS', { files: 'x/y.ts' })),
    comment('2026-11-14T07:00:00Z', status(11, 'S08', 'IN_PROGRESS')),
  ] }] });
  assert.equal(withRef.intents[0].holder.slot, 'S03');
  assert.equal(withRef.intents[0].registration.source, 'ref');
  assert.deepEqual(withRef.intents[0].paths, ['x/y.ts']);
  assert.deepEqual(withRef.notes, [
    '#11: STATUS claim by S09 (Claude) at 2026-11-14T04:00:00.000Z predates the claim ref by S03 (Claude) at 2026-11-14T05:00:00.000Z; read as history',
    '#11: duplicate registration: STATUS claim by S08 (Claude) at 2026-11-14T07:00:00.000Z loses to the earlier claim ref by S03 (Claude) at 2026-11-14T05:00:00.000Z',
  ]);
  // Untrusted authors and DONE holders register nothing; the order of input rows never changes the winner.
  const quiet = registrations({ issue: 12, comments: [comment('2026-11-14T01:00:00Z', status(12, 'S01', 'IN_PROGRESS'), 'NONE'),
    comment('2026-11-14T01:00:00Z', status(12, 'S02', 'IN_PROGRESS')), comment('2026-11-14T03:00:00Z', status(12, 'S02', 'DONE'))] });
  assert.deepEqual(quiet.regs, []);
  const a = { source: 'status', slot: 'S02', agent: 'x', at: 1 }, b = { source: 'label', slot: 'S01', agent: null, at: 1 };
  assert.equal(resolve(1, [b, a]).winner, a);
  assert.equal(resolve(1, [a, b]).winner, a);
});

test('stale SHA: a base older than 72 h or off main is stale; an unrecorded base is neither', () => {
  const records = [
    { issue: 1, ref: ref(1, 'S01', '2026-11-14T00:00:00Z', { baseDate: '2026-11-10T00:00:00Z' }), issueRow: openIssue(1), comments: [] },
    { issue: 2, ref: ref(2, 'S02', '2026-11-14T00:00:00Z', { base: OLD_MAIN }), issueRow: openIssue(2), comments: [] },
    { issue: 3, ref: ref(3, 'S03', '2026-11-14T00:00:00Z', { baseDate: '2026-11-11T13:00:00Z' }), issueRow: openIssue(3), comments: [] },
    { issue: 4, issueRow: openIssue(4, ['state:in-progress', 'slot:S04']), comments: [] },
  ];
  const { intents } = deriveIntents({ records, now: NOW, isAncestor: sha => sha === MAIN });
  const by = Object.fromEntries(intents.map(i => [i.issue, i.base]));
  assert.deepEqual([by[1].stale, by[1].staleReason, by[1].ageHours], [true, 'base is 108 h old (over 72 h)', 108]);
  assert.deepEqual([by[2].stale, by[2].staleReason, by[2].onMain], [true, 'base is not an ancestor of main', false]);
  assert.deepEqual([by[3].stale, by[3].ageHours], [false, 71]);
  assert.deepEqual([by[4].sha, by[4].stale], [null, null]);
  // With no claim base, a linked PR's merge base (part 1's evidence) is the base.
  const viaPr = deriveIntents({ now: NOW, records: [{ issue: 5, issueRow: openIssue(5), comments: [comment('2026-11-14T00:00:00Z', status(5, 'S05', 'IN_PROGRESS', { pr: '#77' }))] }],
    prs: [prRow(77, ['p.ts'], { evidence: { baseAge: { mergeBase: OLD_MAIN, mergeBaseDate: '2026-11-14T06:00:00Z' } } })] });
  assert.deepEqual([viaPr.intents[0].base.source, viaPr.intents[0].base.ageHours], ['pr merge base', 6]);
});

test('disappeared PR: a STATUS PR that is no longer open is dropped with a note; body links still count', () => {
  const records = [{ issue: 20, issueRow: openIssue(20), comments: [comment('2026-11-14T00:00:00Z', status(20, 'S06', 'READY_FOR_REVIEW', { files: 'f/g.ts', pr: 'https://github.com/o/r/pull/31' }))] }];
  const prs = [prRow(32, ['k.ts'], { body: 'Part of #20' })];
  const gone = deriveIntents({ records, prs, now: NOW });
  assert.deepEqual(gone.notes, ['#20: PR #31 from STATUS is no longer open (merged, closed or gone); dropped']);
  assert.deepEqual([gone.intents[0].prs, gone.intents[0].paths, gone.intents[0].pathsSource], [[32], ['k.ts'], 'pr']);
  const partial = deriveIntents({ records, prs: [], now: NOW, scanPartial: true });
  assert.deepEqual(partial.notes, ['#20: PR #31 from STATUS is not in the partial scan; not linked']);
  assert.deepEqual([partial.intents[0].paths, partial.intents[0].pathsSource], [['f/g.ts'], 'status']);
});

test('invalid slot: a malformed or unknown slot is refused with a note and forms no intent', () => {
  const bad = { issue: 30, ref: { head: { sha: hex(30), claim: claim(30, 'Claude', '2026-11-14T00:00:00Z') }, root: { sha: hex(30), claim: claim(30, 'Claude', '2026-11-14T00:00:00Z') }, base: null }, issueRow: openIssue(30), comments: [] };
  const unknown = { issue: 31, ref: ref(31, 'S41', '2026-11-14T00:00:00Z'), issueRow: openIssue(31), comments: [] };
  const invalidMeta = { issue: 32, ref: { head: null, sha: hex(32), reason: 'claim metadata invalid (D5617 treats it as expired)' }, issueRow: openIssue(32), comments: [] };
  const { intents, refused } = deriveIntents({ records: [bad, unknown, invalidMeta], knownSlots: new Set(['S39']), now: NOW });
  assert.deepEqual(intents, []);
  assert.deepEqual(refused, ['#30: claim ref refused: slot "Claude" is not slot:SNN', '#31: claim ref refused: slot S41 is unknown: no slot:S41 label',
    '#32: claim ref refused: claim metadata invalid (D5617 treats it as expired)']);
  // The later slot's label exists: accepted. A valid later claim on the same issue still wins over a refused one.
  assert.equal(deriveIntents({ records: [unknown], knownSlots: new Set(['S41']), now: NOW }).intents[0].holder.slot, 'S41');
  const fallback = deriveIntents({ records: [{ ...bad, comments: [comment('2026-11-14T03:00:00Z', status(30, 'S12', 'IN_PROGRESS'))] }], now: NOW });
  assert.deepEqual([fallback.intents[0].holder.slot, fallback.refused.length], ['S12', 1]);
});

test('concurrent lease expiry: ordered by expiry, then issue number; unrecorded expiry last; expired stays held', () => {
  const records = [
    { issue: 44, ref: ref(44, 'S04', '2026-11-14T00:00:00Z'), issueRow: openIssue(44), comments: [] },
    { issue: 43, ref: ref(43, 'S03', '2026-11-14T00:00:00Z'), issueRow: openIssue(43), comments: [] },
    { issue: 41, issueRow: openIssue(41, ['state:in-progress', 'slot:S01']), comments: [] },
    { issue: 45, ref: ref(45, 'S05', '2026-11-13T06:00:00Z'), issueRow: openIssue(45), comments: [] },
  ];
  for (const order of [records, [...records].reverse()]) {
    const { intents } = deriveIntents({ records: order, now: NOW });
    assert.deepEqual(intents.map(i => i.issue), [45, 43, 44, 41]);
  }
  const { intents } = deriveIntents({ records, now: Date.parse('2026-11-15T00:00:00Z') });
  assert.deepEqual(intents.filter(i => i.registration.expired).map(i => i.issue), [45, 43, 44]);
  assert.match(intents[0].notes[0], /expired; still held/);
  assert.equal(intents.find(i => i.issue === 41).registration.expired, null);
});

test('the WorkItem projection keeps what the claim does not record as null', () => {
  const { intents } = deriveIntents({ now: NOW, depStates: new Map([[9, 'open']]),
    records: [{ issue: 50, ref: ref(50, 'S05', '2026-11-14T00:00:00Z'), issueRow: openIssue(50, ['slot:S06'], 'Depends on #9'), comments: [
      comment('2026-11-14T01:00:00Z', status(50, 'S05', 'IN_PROGRESS', { files: '.github/workflows/ci.yml' }))] }] });
  const i = intents[0];
  assert.deepEqual(i.workItem, { id: 'issue:50', scope: null, deliverableAssetId: null,
    modifies: [{ assetId: null, versionId: null, unit: { kind: 'path', id: '.github/workflows/ci.yml' } }], baseVersionId: null,
    dependsOn: ['issue:9'], author: null, priority: null, risk: 'high', idempotencyKey: `claim/50/${hex(50)}` });
  assert.deepEqual([i.override, i.lease.status], [null, 'not read']);
  assert.deepEqual(i.holder, { slot: 'S05', agent: 'Claude', session: 'sess-1' });
  assert.deepEqual(i.notes, ["holder S05 does not match the issue's slot label S06"]);
});

test('recommendations: proceed, coordinate, wait and serialize from part 1 classes, paths and dependencies', () => {
  const route = 'cloudflare-worker/src/foo/bar.ts';
  assert.equal(pathAction(['a/x.ts'], ['b/y.ts']).action, 'proceed');
  assert.deepEqual(pathAction(['a/x.ts'], ['a/y.ts']), { action: 'coordinate', rule: 'same module', path: 'a' });
  assert.equal(pathAction(['scripts/lib/a.mjs'], ['scripts/lib/b.mjs']).action, 'proceed');
  assert.equal(pathAction(['documentation/architecture/decisions/D1.md'], ['documentation/architecture/decisions/D2.md']).action, 'proceed');
  assert.deepEqual(pathAction([route], [route]), { action: 'coordinate', rule: 'same path; hunks not known', path: route });
  assert.deepEqual(pathAction(['package.json'], ['package.json']).action, 'wait');
  assert.deepEqual(pathAction(['.github/workflows/ci.yml'], ['.github/workflows/ci.yml']), { action: 'serialize', rule: 'CI/CD workflow', path: '.github/workflows/ci.yml' });
  assert.equal(pathAction(['cloudflare-worker/sql/schema_baseline.sql'], ['cloudflare-worker/sql/schema_baseline.sql']).rule, 'D1 schema');
  assert.equal(pathAction(['cloudflare-worker/src/contracts/x.ts'], ['cloudflare-worker/src/contracts/x.ts']).rule, 'API contract');
  assert.equal(pathAction(['CHANGELOG.md'], ['CHANGELOG.md']).rule, 'release pointer');
  assert.deepEqual(pathAction(['cloudflare-worker/sql/migrations/202611141200_1_a.sql'], ['cloudflare-worker/sql/migrations/202611141200_2_b.sql']).rule, 'shared migration stamp 202611141200');
  assert.equal(pathAction(['README.md'], ['README.md']).action, 'proceed');

  // Measured hunks: intents whose PRs part 1 classified.
  const hunk = (start, del) => `@@ -${start},${del} +${start},${del} @@\n${Array.from({ length: del }, () => '-o').join('\n')}\n${Array.from({ length: del }, () => '+n').join('\n')}`;
  const mk = (n, start, issue) => ({ number: n, body: `Closes #${issue}`, head: { sha: hex(n), ref: 'x' }, base: { ref: 'main', sha: MAIN },
    evidence: { baseAge: { status: 'measured', mergeBase: MAIN } }, files: [{ filename: route, status: 'modified', patch: hunk(start, 2) }] });
  const prs = [mk(101, 10, 61), mk(102, 50, 62), mk(103, 11, 63), { number: 104, files: [{ filename: 'z/q.ts', status: 'modified' }], head: { sha: hex(104) }, body: '' }];
  const overlaps = annotate(pairs(prs));
  const records = [61, 62, 63, 64].map(n => ({ issue: n, ref: ref(n, `S${n - 50}`, '2026-11-14T00:00:00Z'), issueRow: openIssue(n, [], n === 64 ? 'Depends on #61' : ''),
    comments: n === 64 ? [comment('2026-11-14T01:00:00Z', status(64, 'S14', 'IN_PROGRESS', { files: 'z/other.ts' }))] : [] }));
  const { intents } = deriveIntents({ records, prs, now: NOW, depStates: new Map([[61, 'open']]) });
  recommend(intents, { prs, overlaps });
  const by = Object.fromEntries(intents.map(i => [i.issue, i.recommendation]));
  assert.deepEqual(by[61], { action: 'wait', reasons: [
    { action: 'wait', with: '#63', rule: 'overlapping hunks', path: route },
    { action: 'coordinate', with: '#62', rule: 'same path, disjoint hunks', path: route }] });
  assert.equal(by[62].action, 'coordinate');
  // #64 predicts z/other.ts: same module as the unowned PR #104, and waits on open #61.
  assert.deepEqual(by[64].reasons, [
    { action: 'wait', with: '#61', rule: 'depends on an open issue', path: null },
    { action: 'coordinate', with: 'PR #104', rule: 'same module', path: 'z' }]);
  const unread = deriveIntents({ records: [records[3]], now: NOW });
  recommend(unread.intents, {});
  assert.deepEqual(unread.intents[0].recommendation, { action: 'coordinate', reasons: [{ action: 'coordinate', with: '#61', rule: 'dependency state not read', path: null }] });
  // Part 1's critical class and a shared new migration stamp serialize measured pairs too.
  const wf = '.github/workflows/ci.yml', mig = n => `cloudflare-worker/sql/migrations/202611141200_${n}_m.sql`;
  const pair = annotate(pairs([mk(201, 10, 1), mk(202, 300, 2)].map(p => ({ ...p, files: [{ ...p.files[0], filename: wf }] }))))[0];
  assert.deepEqual(pairAction(pair), { action: 'serialize', rule: 'CI/CD workflow', path: wf });
  const stamp = annotate(pairs([{ number: 203, files: [{ filename: mig(1), status: 'added', patch: '@@ -0,0 +1 @@\n+x' }] }, { number: 204, files: [{ filename: mig(2), status: 'added', patch: '@@ -0,0 +1 @@\n+y' }] }]))[0];
  assert.deepEqual(pairAction(stamp), { action: 'serialize', rule: 'shared migration stamp 202611141200', path: null });
  const alone = deriveIntents({ records: [records[1]], now: NOW });
  assert.equal(recommend(alone.intents, {})[0].recommendation.action, 'proceed');
});

test('the Work in flight section escapes every external string and says Unreadable, never empty, when unread', () => {
  const { intents, notes, refused } = deriveIntents({ now: NOW, records: [{ issue: 70, ref: ref(70, 'S07', '2026-11-14T00:00:00Z'), issueRow: openIssue(70), comments: [
    comment('2026-11-14T01:00:00Z', status(70, 'S07', 'IN_PROGRESS', { files: 'a/x.ts' })),
    comment('2026-11-14T02:00:00Z', status(70, 'S08', 'IN_PROGRESS', { agent: '@other* <b>|x' }))] }] });
  recommend(intents, {});
  const text = workInFlightText({ status: 'read', partial: false, intents, refused, notes });
  assert.match(text, /^### Work in flight\n\n- #70 · S07 · Claude · claim ref, registered 2026-11-14T00:00:00\.000Z, expires 2026-11-15T00:00:00\.000Z · base aaaaaaa \(12 h\) · no PR · 1 path\(s\) from STATUS files → \*\*proceed\*\*/);
  assert.match(text, /\n- #70: duplicate registration: STATUS claim by S08 \(&#64;other&#42; &lt;b&gt;&#124;x\)/);
  assert.doesNotMatch(text, /@other|<b>/);
  const odd = deriveIntents({ now: NOW, records: [{ issue: 71, issueRow: openIssue(71), comments: [comment('2026-11-14T01:00:00Z', status(71, 'S09', 'IN_PROGRESS', { agent: '@x [y]' }))] }] });
  assert.match(workInFlightText({ status: 'read', partial: false, intents: recommend(odd.intents, {}), refused: [], notes: [] }), /- #71 · S09 · &#64;x &#91;y&#93; · STATUS claim/);
  assert.match(workInFlightText(unreadableWork('claim refs <unreadable>')), /Unreadable: claim refs &lt;unreadable&gt;\. This is not "no work"\./);
  assert.match(workInFlightText({ status: 'read', partial: false, intents: [], refused: [], notes: [] }), /No claimed work found\./);
});

/** A read-only GitHub fixture with claim refs, labelled issues, STATUS comments and slot labels. */
function workApi({ labels = [{ name: 'slot:S03' }, { name: 'slot:S39' }], cap = Infinity } = {}) {
  const c1 = claimMessage({ issue: 5580, slot: 'S03', agent: 'Claude', session: 's1', at: '2026-11-14T00:00:00Z' });
  const commits = { [hex(1)]: { message: c1, parents: [{ sha: MAIN }] }, [MAIN]: { message: 'main', parents: [], committer: { date: '2026-11-14T00:00:00Z' } } };
  const calls = [];
  const api = async (method, path) => {
    calls.push(path);
    if (calls.length > cap) throw Object.assign(new Error('request/rate limit cap'), { partial: true });
    assert.equal(method, 'GET');
    if (path === 'git/matching-refs/heads/claim/') return [{ ref: 'refs/heads/claim/5580', object: { sha: hex(1) } }, { ref: 'refs/heads/claim/9999', object: { sha: hex(2) } }, { ref: 'refs/heads/claim/x', object: { sha: hex(3) } }];
    if (path.startsWith('git/commits/')) { const c = commits[path.split('/')[2]]; if (!c) throw Object.assign(new Error('gone'), { status: 404 }); return c; }
    if (path.startsWith('issues?labels=state%3Ain-progress')) return [openIssue(5590, ['state:in-progress', 'slot:S39'], 'Depends on #5580'), { number: 5591, pull_request: {} }];
    if (path.startsWith('issues?labels=')) return [];
    if (path.startsWith('labels?')) return labels;
    if (path === 'issues/5580') return openIssue(5580, ['slot:S03', 'state:in-progress']);
    if (path === 'issues/5580/comments?per_page=100&page=1') return [comment('2026-11-14T01:00:00Z', status(5580, 'S03', 'IN_PROGRESS', { files: 'scripts/pr-overlap.mjs' }))];
    if (path === 'issues/5590/comments?per_page=100&page=1') return [];
    if (path.startsWith('pulls?')) return [];
    throw new Error(`unexpected ${path}`);
  };
  return { api, calls };
}

test('readWork reads claims, labelled issues, STATUS and labels; a gone ref is noted, a cap is partial', async () => {
  const { api } = workApi();
  const raw = await readWork(api);
  assert.deepEqual(raw.records.map(r => r.issue), [5580, 5590, 9999]);
  assert.deepEqual(raw.records[2], { issue: 9999, unreadable: 'issue or claim gone' });
  assert.deepEqual([...raw.knownSlots].sort(), ['S03', 'S39']);
  assert.equal(raw.depStates.get(5580), 'open');
  assert.equal(raw.partial, false);
  const { intents, notes } = deriveIntents({ ...raw, now: NOW });
  assert.deepEqual(intents.map(i => [i.issue, i.holder.slot, i.registration.source]), [[5580, 'S03', 'ref'], [5590, 'S39', 'label']]);
  assert.deepEqual(notes, ['#9999: issue or claim gone; not read']);
  assert.equal(intents[0].base.sha, MAIN);
  const capped = await readWork(workApi().api, { maxRequests: 4 });
  assert.equal(capped.partial, true);
  assert.deepEqual(capped.notes, ['work read budget reached; later claims not read']);
  const noLabels = await readWork(workApi({ labels: { message: 'no' } }).api);
  assert.equal(noLabels.knownSlots, null);
  await assert.rejects(readWork(async () => ({})), /claim refs unreadable/);
});

test('the scan adds Work in flight to the summary and workInFlight to the v2 snapshot', async () => {
  const { api } = workApi();
  const written = [], logs = [];
  const result = await report({ api, dryRun: true, now: NOW, log: l => logs.push(l), snapshotPath: 's.json', write: (p, body) => written.push(body), isAncestor: () => true });
  assert.deepEqual(result.notes, []);
  assert.match(logs[0], /### Work in flight\n\n- #5580 · S03 · Claude · claim ref/);
  assert.match(logs[0], /- #5590 · S39 · label claim, expiry not recorded · base not recorded · no PR · paths not recorded → \*\*wait\*\*: wait with #5580 \(depends on an open issue\)/);
  const snap = JSON.parse(written[0]);
  assert.equal(snap.schema, 'studioos-pr-overlap-snapshot/v2');
  assert.deepEqual(snap.workInFlight.intents.map(i => [i.issue, i.recommendation.action]), [[5580, 'proceed'], [5590, 'wait']]);
  const off = await report({ api, dryRun: true, now: NOW, log() {}, readClaims: false });
  assert.equal(off.work, null);
});
