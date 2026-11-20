/**
 * D7125 (#7125): `[alert] merge queue stalled` opens when one failure identity fails in candidates of two different
 * merge-queue chains, and names where it starts. The annotation half is `scripts/test-drift-parts.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { safeHealthFacts } from '../../scripts/health-alert-episodes.mjs';
import {
  message, possibleRepairs, queueChains, queueStallState, safeStallIdentities, stallEvidence, stallIdentities,
  stallRunsToRead, transition,
} from '../../scripts/lib/githubAlerts.mjs';
import { failureAnnotation, runPart } from '../../scripts/test-drift-parts.mjs';

const sha = (n) => n.toString(16).padStart(40, 'a');
const MAIN = sha(1);
const PROMO = 'cloudflare-worker/test/promo_5949.test.ts › the read says reported';
const ROUTES = 'frontend/test/section_coverage_5682.test.mjs › the route table matches';
const OTHER = 'guard › npm run test:guards';
const suite = (part, ids, id = 1) => ({
  id, name: `suite (${part})`, conclusion: 'failure', html_url: `https://github.com/o/r/actions/runs/9/job/${id}`,
  steps: [{ name: `Run node scripts/test-drift-parts.mjs ${part} --plan-file suite-plan.json`, conclusion: 'failure' }],
  annotations: ids,
});
const summaries = [
  { name: 'test:drift (full suite)', conclusion: 'failure', steps: [{ name: 'Every part of test:drift passed', conclusion: 'failure' }] },
  { name: 'landing gate', conclusion: 'failure', steps: [{ name: 'Required fast checks and full suite passed', conclusion: 'failure' }] },
];
let nextId = 100;
/** One queue candidate: PR `pr` on `parent`, head `head`, failing `jobs` (or green). */
const run = (pr, parent, head, minute, jobs = [], conclusion = jobs.length ? 'failure' : 'success') => ({
  id: nextId++, event: 'merge_group', status: 'completed', conclusion, head_sha: head,
  head_branch: `gh-readonly-queue/main/pr-${pr}-${parent}`, created_at: `2026-11-17T10:${String(minute).padStart(2, '0')}:00Z`,
  html_url: `https://github.com/o/r/actions/runs/${nextId}`, jobs: conclusion === 'failure' ? [...jobs, ...summaries] : [],
});
/** A chain: PRs in order on `base`, each candidate failing what `fails(pr)` returns. */
const chain = (base, prs, minute, fails, salt) => {
  let parent = base;
  return prs.map((pr, i) => {
    const head = sha(salt * 1000 + i);
    const ids = fails(pr);
    const r = run(pr, parent, head, minute, ids.length ? [suite(`worker-${(i % 6) + 1}-of-6`, ids)] : []);
    parent = head;
    return r;
  });
};

test('five failed candidates of one chain sharing a failure are an ordinary ejection: null', () => {
  const one = chain(MAIN, [11, 12, 13, 14, 15], 1, () => [ROUTES], 1);
  assert.deepEqual(queueStallState(one), { active: null, fingerprint: null });
  assert.equal(stallEvidence(one).identities[0].chains, 1);
});

test('the same failure in two chains on three heads opens, whatever shard ran it, and a later green run clears', () => {
  const first = chain(MAIN, [11, 12], 1, () => [PROMO], 1);
  const second = chain(MAIN, [13, 14], 5, () => [PROMO], 2);
  const twoOnly = queueStallState([first[0], second[0]]);
  assert.equal(twoOnly.active, null, 'two heads are not enough');
  const state = queueStallState([...first, ...second]);
  assert.equal(state.active, true);
  assert.equal(state.fingerprint, null);
  assert.deepEqual(state.identities.map(i => [i.id, i.candidates, i.chains, i.heads]), [[PROMO, 4, 2, 4]]);
  assert.equal(transition(state.active, false), 'open');
  const shards = new Set([...first, ...second].map(r => r.jobs[0].name));
  assert.ok(shards.size >= 2, `the identity matched across ${[...shards].join(', ')}`);
  const green = run(16, MAIN, sha(77), 9);
  assert.deepEqual(queueStallState([...first, ...second, green]), { active: false, fingerprint: null });
  assert.equal(transition(queueStallState([...first, ...second, green]).active, true), 'close');
  // A green run created before the failures does not clear them.
  const earlier = run(10, MAIN, sha(78), 0);
  assert.equal(queueStallState([earlier, ...first, ...second]).active, true);
});

test('unread annotations make a run unknown: it never opens, and never counts for a chain', () => {
  const first = chain(MAIN, [11, 12], 1, () => [PROMO], 1);
  const second = chain(MAIN, [13, 14], 5, () => [PROMO], 2);
  for (const r of second) r.jobs[0].annotations = null;
  assert.deepEqual(queueStallState([...first, ...second]), { active: null, fingerprint: null });
  assert.equal(stallEvidence([...first, ...second]).unknown, 2);
  for (const r of second) delete r.jobs[0].annotations;
  assert.equal(queueStallState([...first, ...second]).active, null, 'an unread (absent) list is unknown too');
  assert.equal(stallIdentities({ jobs: undefined }), null);
});

test('a job with no annotation falls back to job and step; setup and ejected-ref steps give no identity', () => {
  const guard = { name: 'api ↔ worker drift', conclusion: 'failure', steps: [{ name: 'Run drift checker', conclusion: 'failure' }], annotations: [] };
  const sharded = { ...suite('worker-3-of-6', []), steps: [{ name: 'Lint', conclusion: 'failure' }] };
  const ejected = { name: 'frontend (build)', conclusion: 'failure', steps: [{ name: 'Check merge queue ref still exists', conclusion: 'failure' }], annotations: [] };
  const setup = { name: 'suite (worker-1-of-6)', conclusion: 'failure', steps: [{ name: 'Install age', conclusion: 'failure' }], annotations: [] };
  assert.deepEqual(stallIdentities({ jobs: [guard, sharded, ejected, setup, ...summaries] }), ['api ↔ worker drift › Run drift checker', 'suite › Lint']);
  const a = chain(MAIN, [11, 12], 1, () => [], 1).map(r => ({ ...r, conclusion: 'failure', jobs: [guard] }));
  const b = chain(MAIN, [13], 5, () => [], 2).map(r => ({ ...r, conclusion: 'failure', jobs: [guard] }));
  assert.equal(queueStallState([...a, ...b]).identities[0].id, 'api ↔ worker drift › Run drift checker');
  const ej = [...a, ...b].map(r => ({ ...r, jobs: [ejected] }));
  assert.equal(queueStallState(ej).active, null, 'candidates GitHub ejected are not a shared failure');
});

test('chains link through parent shas; roots that differ in PR or base are different chains', () => {
  const first = chain(MAIN, [11, 12, 13], 1, () => [PROMO], 1);
  const rebuilt = chain(MAIN, [12, 13], 5, () => [PROMO], 2);
  const chains = queueChains([...first, ...rebuilt]);
  assert.deepEqual([...new Set([...chains.values()].map(c => c.key))], [`pr-11@${MAIN}`, `pr-12@${MAIN}`]);
  assert.deepEqual(first.map(r => chains.get(r.id).depth), [0, 1, 2]);
  // A link through a candidate still running keeps one chain.
  const running = { ...first[1], status: 'in_progress', conclusion: null, jobs: undefined };
  assert.equal(new Set([...queueChains([first[0], running, first[2]]).values()].map(c => c.key)).size, 1);
  // The same root PR on the same base, rebuilt with new heads, is the same chain.
  const again = chain(MAIN, [11, 12], 7, () => [PROMO], 3);
  assert.equal(stallEvidence([...first, ...again]).identities[0].chains, 1);
});

test('on the root candidate of two chains with different root PRs: it fails on the base, main at that sha', () => {
  const state = queueStallState([...chain(MAIN, [11, 12], 1, () => [PROMO], 1), ...chain(MAIN, [12, 13], 5, () => [PROMO], 2)]);
  assert.deepEqual(state.identities[0].start, { kind: 'base', sha: MAIN });
  const text = message('queue-stalled', 'open', safeHealthFacts({ ...state, identityCount: 1 }));
  assert.ok(text.includes(`Fails on the base: main at \`${MAIN.slice(0, 12)}\`. Reproduce with \`node --test cloudflare-worker/test/promo_5949.test.ts\` on that sha. One repair, linked here (D5398).`), text);
});

test('starting at PR k in both chains with a clean candidate ahead: remove #k; otherwise not determined', () => {
  // Candidates ahead of #13 fail too, on another failure, so no green queue run clears the evidence.
  const fails = (pr) => (pr >= 13 ? [ROUTES] : [OTHER]);
  const first = chain(MAIN, [11, 12, 13, 14], 1, fails, 1);
  const second = chain(MAIN, [12, 13, 14, 15], 5, fails, 2);
  const state = queueStallState([...first, ...second]);
  assert.deepEqual(state.identities.find(i => i.id === ROUTES).start, { kind: 'pr', pr: 13 });
  assert.match(message('queue-stalled', 'open', safeHealthFacts(state)), /Starts at #13: remove #13 from the queue and do not re-queue it\./);
  // #13 failed first on another identity in one chain (the queue stops at the first failure): still #13.
  const masked = chain(MAIN, [11, 12, 13, 14], 1, (pr) => (pr === 13 ? [PROMO] : pr > 13 ? [ROUTES] : [OTHER]), 3);
  assert.deepEqual(queueStallState([...masked, ...second]).identities.find(i => i.id === ROUTES).start, { kind: 'pr', pr: 13 });
  // #21 starts it in both chains, but nothing ahead of it was read clean (an unread run is unknown): not determined.
  const lead = chain(MAIN, [21, 22], 1, () => [ROUTES], 7);
  const behind = chain(MAIN, [20, 21], 5, (pr) => (pr === 20 ? [OTHER] : [ROUTES]), 8);
  assert.deepEqual(queueStallState([...lead, ...behind]).identities.find(i => i.id === ROUTES).start, { kind: 'pr', pr: 21 });
  behind[0].jobs[0].annotations = null;
  assert.deepEqual(queueStallState([...lead, ...behind]).identities.find(i => i.id === ROUTES).start, { kind: 'undetermined', prs: [21, 22] });
  // The first PR failing it differs between chains, and neither is in every chain: not determined.
  const a = chain(MAIN, [21, 22], 1, (pr) => (pr === 21 ? [PROMO] : [ROUTES]), 4);
  const b = chain(MAIN, [31, 22], 5, (pr) => (pr === 31 ? [PROMO] : [ROUTES]), 5);
  const c = chain(MAIN, [41, 42], 6, (pr) => (pr === 41 ? [PROMO] : [ROUTES]), 6);
  const undecided = queueStallState([...a, ...b, ...c]).identities.find(i => i.id === ROUTES);
  assert.deepEqual(undecided.start, { kind: 'undetermined', prs: [22, 42] });
  assert.match(message('queue-stalled', 'open', safeHealthFacts({ identities: [undecided] })), /Candidates: #22, #42; the start is not determined\./);
});

test('replay of 2026-11-17: promo-clock fails on the base, the route table starts at #6531', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/queue_stall_7125.json', import.meta.url), 'utf8'));
  const runs = fx.runs.map(([id, createdAt, conclusion, branch, head, jobs]) => ({
    id, event: 'merge_group', status: 'completed', created_at: createdAt, conclusion, head_sha: head,
    head_branch: `gh-readonly-queue/main/${branch}`,
    jobs: jobs.map(([jobId, name, step, ids]) => ({ id: jobId, name, conclusion: 'failure', steps: [{ name: fx.steps[step], conclusion: 'failure' }], annotations: (ids || []).map(i => fx.identities[i]) })),
  }));
  assert.equal(runs.length, 61);
  assert.equal(runs.filter(r => r.created_at < '2026-11-17T10:00').length, 31);
  const state = queueStallState(runs);
  assert.equal(state.active, true);
  const by = Object.fromEntries(state.identities.map(i => [i.id.split(' › ')[0], i]));
  const promo = by['cloudflare-worker/test/promo_issued_report_5949.test.ts'];
  assert.deepEqual(promo.start, { kind: 'base', sha: '5d14c9b38e0acaf74b41f65931feb31cf949b8bc' });
  assert.equal(promo.chains, 2);
  assert.deepEqual(by['frontend/test/section_coverage_5682.test.mjs'].start, { kind: 'pr', pr: 6531 });
  assert.deepEqual(by['cloudflare-worker/test/formation_gates_6693.test.ts'].start, { kind: 'pr', pr: 6964 });
  assert.equal(by.guard.start.kind, 'undetermined');
  // Either window alone is one chain of candidates (plus a one-run chain ejected by its ref): no alert.
  assert.equal(queueStallState(runs.filter(r => r.created_at > '2026-11-17T12:00')).active, null);
  assert.equal(queueStallState(runs.filter(r => r.created_at < '2026-11-17T12:00')).active, null);
});

test('the stall check reads at most 15 failed runs, all created after the newest green queue run', () => {
  const failed = chain(MAIN, Array.from({ length: 20 }, (_, i) => 100 + i), 5, () => [PROMO], 9);
  failed.forEach((r, i) => { r.created_at = `2026-11-17T11:${String(i + 10).padStart(2, '0')}:00Z`; });
  const green = { ...run(99, MAIN, sha(5), 0), created_at: '2026-11-17T11:14:30Z' };
  const read = stallRunsToRead([...failed, green]);
  assert.equal(read.length, 15);
  assert.ok(read.every(r => r.created_at > green.created_at));
  assert.equal(read[0].created_at, '2026-11-17T11:29:00Z');
  const later = { ...green, created_at: '2026-11-17T11:24:30Z' };
  assert.deepEqual(stallRunsToRead([...failed, later]).map(r => r.created_at.slice(11, 16)), ['11:29', '11:28', '11:27', '11:26', '11:25']);
});

test('alert text is safe: identity text from test names cannot link, mention or break code spans', () => {
  const [safe] = safeStallIdentities([{ id: 'a.test.mjs › <!channel> `x` @owner & \\n', candidates: 3, chains: 2, start: { kind: 'pr', pr: 7 }, jobUrl: 'https://evil.example/' }]);
  assert.doesNotMatch(safe.id, /[<>`&\\]|@/);
  assert.equal(safe.jobUrl, undefined);
  assert.deepEqual(safeStallIdentities([{ id: 'x', candidates: -1, chains: 2 }]), []);
  const facts = safeHealthFacts({ identities: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, candidates: 3, chains: 2, start: { kind: 'base', sha: MAIN } })), identityCount: 8 });
  assert.equal(facts.identities.length, 5);
  assert.match(message('queue-stalled', 'open', facts), /…and 3 more failure\(s\)\.\nUntil a queue CI run passes: add no queue entries and do not re-queue an ejected PR\. The one repair linked on the alert is the exception/);
  // The D5604 setup-step alert keeps its own text.
  assert.match(message('queue-stalled', 'open', { fingerprint: 'suite/Install age' }), /failed during suite\/Install age/);
});

test('possible repairs: open PRs changing the failing test file with every required check green', () => {
  const ids = [{ id: PROMO, candidates: 3, chains: 2 }];
  const ok = (name) => ({ name, status: 'completed', conclusion: 'success' });
  const prs = [
    { number: 1, files: ['cloudflare-worker/test/promo_5949.test.ts'], checks: [ok('fast'), ok('suite')] },
    { number: 2, files: ['cloudflare-worker/test/promo_5949.test.ts'], checks: [ok('fast'), { name: 'suite', status: 'completed', conclusion: 'failure' }] },
    { number: 3, files: ['other.test.mjs'], checks: [ok('fast'), ok('suite')] },
  ];
  assert.deepEqual(possibleRepairs(ids, prs, ['fast', 'suite'])[0].repairs, [1]);
  assert.equal(possibleRepairs(ids, prs, [])[0].repairs, undefined, 'unknown required checks call nothing green');
  assert.match(message('queue-stalled', 'open', safeHealthFacts({ identities: [{ ...ids[0], start: { kind: 'base', sha: MAIN }, repairs: [1] }] })), /Possible repairs \(open, required checks green\): #1\./);
});

/** A fake `sh` for runPart: answers each command with a status and writes the failed-test reporter's file. */
const fakeSh = (answers) => (command) => {
  const next = answers.shift();
  const out = /--test-reporter-destination='([^']+\.jsonl)'/.exec(command)?.[1];
  if (out && next.failures) writeFileSync(out, next.failures.map(f => JSON.stringify(f)).join('\n'));
  return { status: next.status };
};
const drive = (event, commands, answers, flaky = []) => {
  const lines = [];
  const status = runPart({ commands, env: { GITHUB_EVENT_NAME: event }, root: process.cwd(), sh: fakeSh(answers), log: (l) => lines.push(l), error: () => {},
    flakyList: () => flaky, changedFiles: () => [] });
  return { status, annotations: lines.filter(l => l.startsWith('::error title=ci-failure-id::')) };
};
const NODE = "node --test 'a.test.mjs' 'b.test.mjs'";
const fail = (n) => Array.from({ length: n }, (_, i) => ({ file: 'a.test.mjs', test: `t${i}%\r\n,:` }));

test('under merge_group a failing node:test command annotates each failed test, escaped, at most 5', () => {
  const { status, annotations } = drive('merge_group', [NODE], [{ status: 3, failures: fail(7) }]);
  assert.equal(status, 3, 'the exit status is unchanged');
  assert.equal(annotations.length, 5);
  assert.equal(annotations[0], '::error title=ci-failure-id::a.test.mjs › t0%25%0D%0A,:');
  assert.equal(failureAnnotation('x'), '::error title=ci-failure-id::x');
});

test('a failing guard annotates once; pull_request annotates nothing; a rescued flaky test annotates nothing', () => {
  const guard = drive('merge_group', ['npm run test:guards', NODE], [{ status: 2 }]);
  assert.deepEqual(guard, { status: 2, annotations: ['::error title=ci-failure-id::guard › npm run test:guards'] });
  const long = drive('merge_group', [`npm run x ${'y'.repeat(200)}`], [{ status: 1 }]).annotations[0];
  assert.equal(long.length, '::error title=ci-failure-id::guard › '.length + 120);
  assert.deepEqual(drive('pull_request', [NODE], [{ status: 1 }]), { status: 1, annotations: [] });
  assert.deepEqual(drive('pull_request', ['npm run test:guards'], [{ status: 4 }]), { status: 4, annotations: [] });
  const flaky = [{ file: 'a.test.mjs', test: 't0' }];
  assert.deepEqual(drive('merge_group', [NODE], [{ status: 1, failures: flaky }, { status: 0 }], flaky), { status: 0, annotations: [] });
  const stillFailing = drive('merge_group', [NODE], [{ status: 1, failures: flaky }, { status: 1 }], flaky);
  assert.deepEqual(stillFailing, { status: 1, annotations: ['::error title=ci-failure-id::a.test.mjs › t0'] });
});

test('the CLI reads annotations of the newest 15 failed runs, logs identities and chains, and opens the alert', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/queue_stall_7125.json', import.meta.url), 'utf8'));
  // 12:21Z: the second chain's first five candidates have finished; the rest still run.
  const second = fx.runs.filter(r => r[1] > '2026-11-17T12:00').sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const done = new Set([...fx.runs.filter(r => r[1] < '2026-11-17T12:00'), ...second.slice(0, 5)].map(r => r[0]));
  const runs = fx.runs.map(([id, createdAt, conclusion, branch, head]) => ({
    id, event: 'merge_group', created_at: createdAt, head_sha: head, head_branch: `gh-readonly-queue/main/${branch}`,
    html_url: `https://github.com/AxalNetwork/StudioOS/actions/runs/${id}`,
    ...(done.has(id) ? { status: 'completed', conclusion } : { status: 'in_progress', conclusion: null }),
  })).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const jobs = Object.fromEntries(fx.runs.map(([id, , , , , list]) => [id, list.map(([jobId, name, step]) => ({
    id: jobId, name, conclusion: 'failure', html_url: `https://github.com/AxalNetwork/StudioOS/actions/runs/${id}/job/${jobId}`,
    steps: [{ name: fx.steps[step], conclusion: 'failure' }] }))]));
  const notes = Object.fromEntries(fx.runs.flatMap(r => r[5]).map(([jobId, , , ids]) => [jobId, [
    { title: null, message: 'Process completed with exit code 1.' },
    ...(ids || []).map(i => ({ title: 'ci-failure-id', message: fx.identities[i] })),
  ]]));
  // One annotation read fails: that run is unknown, left out, and the rest still decide.
  const unread = jobs[second[4][0]].find(j => j.name.startsWith('suite')).id;
  notes[unread] = 'fail';
  const code = `
    const { runs, jobs, notes } = JSON.parse(process.env.Q7125_FIXTURE);
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      if (init.method === 'POST' && u.pathname.endsWith('/issues')) { console.log('ISSUE_BODY ' + JSON.stringify(JSON.parse(init.body).body)); return Response.json({ number: 1, state: 'open', title: JSON.parse(init.body).title, body: JSON.parse(init.body).body, user: { login: 'github-actions[bot]' } }); }
      if (init.method) return Response.json({ number: 1, state: 'open', body: JSON.parse(init.body).body || '' });
      let m;
      if (u.pathname.endsWith('/actions/workflows/ci.yml/runs')) { console.log('LIST ' + u.search); return Response.json({ workflow_runs: runs }); }
      if ((m = /actions\\/runs\\/(\\d+)\\/jobs$/.exec(u.pathname))) { console.log('JOBS ' + m[1]); return Response.json({ jobs: jobs[m[1]] }); }
      if ((m = /check-runs\\/(\\d+)\\/annotations$/.exec(u.pathname))) return notes[m[1]] === 'fail' ? new Response('', { status: 502 }) : Response.json(notes[m[1]] || []);
      if (u.pathname.endsWith('/issues')) return Response.json([]);
      return Response.json({});
    };`;
  const child = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(code), 'scripts/github-alerts.mjs', 'queue-stalled'], {
    encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'AxalNetwork/StudioOS', GITHUB_TOKEN: 'fixture', SLACK_GITHUB_WEBHOOK_URL: '', Q7125_FIXTURE: JSON.stringify({ runs, jobs, notes }) },
  });
  assert.match(child.stdout, /LIST \?event=merge_group&per_page=100\n/, 'every status, so chains link through running candidates');
  assert.equal(child.stdout.match(/^JOBS /gm).length, 15);
  const log = JSON.parse(child.stdout.split('\n').find(l => l.startsWith('{"kind":"queue-stalled"')));
  assert.equal(log.read, 15);
  assert.equal(log.unknown, 1);
  assert.deepEqual(log.chains.sort(), ['pr-6778@5d14c9b38e0acaf74b41f65931feb31cf949b8bc', 'pr-7055@5d14c9b38e0acaf74b41f65931feb31cf949b8bc']);
  assert.ok(!log.identities.some(i => /Process completed/.test(i.id)), 'only ci-failure-id annotations are identities');
  const guard = log.identities.find(i => i.id === 'guard › npm run test:guards');
  assert.deepEqual([guard.active, guard.chains], [true, 2]);
  const body = JSON.parse(child.stdout.split('\n').find(l => l.startsWith('ISSUE_BODY ')).slice('ISSUE_BODY '.length));
  assert.match(body, /\*Merge queue stalled\.\*[\s\S]*• `guard › npm run test:guards`: failed \d+ candidate\(s\) in 2 queue chains\. Candidates: [#\d, ]+; the start is not determined\. <https:\/\/github\.com\/AxalNetwork\/StudioOS\/actions\/runs\/\d+\/job\/\d+\|job>/);
});
