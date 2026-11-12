// D5666: observational lifecycle/ownership adapter uses existing digest authority and runtime ruleset contexts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { routeObservation, ownership, canonicalSlot, RoutingHistory } from '../../scripts/lib/notificationRouting.mjs';
import { readRoutingContext, readOnlyGithub } from '../../scripts/notification-routing-context.mjs';
import { claimMessage } from '../../scripts/lib/claims.mjs';
import { digest } from '../../scripts/lib/ciDigest.mjs';
const now = Date.parse('2026-11-12T10:00:00Z'), head = 'a'.repeat(40), newer = 'b'.repeat(40), base = 'c'.repeat(40);
const ruleset = { id: 25309597, enforcement: 'active', rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'required-old', integration_id: 15368 }, { context: 'typecheck', integration_id: 15368 }] } }] };
const pr = { number: 3, state: 'open', head: { sha: head }, base: { sha: base }, user: { login: 'author' }, requested_reviewers: [{ login: 'reviewer' }] };
let sequence = 0;
const event = (state, props = {}) => ({ schema: 1, key: createHash('sha256').update(String(++sequence)).digest('hex'), repository: 'o/r', family: 'ci', kind: 'workflow_job', state, visibility: 'public', occurredAt: new Date(now + sequence * 1000).toISOString(), observedAt: new Date(now + sequence * 1000).toISOString(), ids: { run: '42', attempt: '1', job: '8', prs: ['3'] }, refs: { head }, ...props });
const requiredCheck = { name: 'required-old', appId: 15368, headSha: head, runId: '42', attempt: '1', conclusion: 'failure' };
const green = (sha = head, attempt = '2') => ({ verified: true, headSha: sha, runId: '42', attempt, checks: [{ name: 'required-old', appId: 15368, conclusion: 'success' }, { name: 'typecheck', appId: 15368, conclusion: 'success' }] });
const issues = [{ number: 7, labels: ['slot:s18', 'slot:S18'] }];
const claim = (issue = 7, slot = 's18', session = '18', at = new Date(now)) => ({ issue, ref: `refs/heads/claim/${issue}`, message: claimMessage({ issue, slot, session, agent: 'Codex', at }) });
const envelope = (verdict = 'pr_failure', ids = ['one'], options = {}) => ({ verified: true, author: 'github-actions[bot]', source: 'studioos-ci-digest:v1', runId: '42', attempt: '1', digest: digest({ classification: { verdict, incident: verdict === 'inherited_main_failure' ? 'https://github.com/o/r/issues/9' : null }, headSha: head, jobs: [{ name: 'suite (worker-1-of-6)', conclusion: 'failure', html_url: 'https://github.com/o/r/actions/runs/42/job/8' }], artifact: { failures: ids.map(id => ({ job: 'suite (worker-1-of-6)', id })) } }), ...options });
const input = e => ({ event: e, pr, issues, claims: [claim()], ruleset, requiredCheck, digestEnvelope: envelope(), now });
function history() {
  const rows = new Map(), locks = new Map();
  return { rows, router: new RoutingHistory({ get: async k => rows.get(k), commit: async (eventKey, key, value) => { rows.set(eventKey, structuredClone(value)); if (value.state) rows.set(key, structuredClone(value.state)); }, withLock: async (k, fn) => { const prev = locks.get(k) || Promise.resolve(), next = prev.catch(() => {}).then(fn); locks.set(k, next); try { return await next; } finally { if (locks.get(k) === next) locks.delete(k); } } }) };
}
test('full draft/review/head/CI/queue/merge lifecycle keeps original PR root and historical failure cannot reopen recovery', async () => {
  const { router } = history(); const roots = [];
  const observe = async (e, extras = {}) => { const r = await router.observe({ ...input(e), ...extras }); if (r.state?.threadExists) roots.push(r.state.root); return r; };
  assert.equal((await observe(event('open', { family: 'work', kind: 'pull_request', action: 'opened' }), { pr: { ...pr, draft: true } })).policy.material, false);
  assert.equal((await observe(event('ready_for_review', { family: 'work', kind: 'pull_request', action: 'ready_for_review' }))).policy.disposition, 'action');
  assert.equal((await observe(event('approved', { family: 'work', kind: 'pull_request_review' }))).state.closed, false);
  assert.equal((await observe(event('changes_requested', { family: 'work', kind: 'pull_request_review' }))).policy.disposition, 'action');
  const nextPR = { ...pr, head: { sha: newer } };
  await observe(event('synchronize', { family: 'work', kind: 'pull_request', refs: { head: newer } }), { pr: nextPR });
  const failure = event('failure', { refs: { head: newer } });
  await observe(failure, { pr: nextPR, requiredCheck: { ...requiredCheck, headSha: newer }, digestEnvelope: { ...envelope(), digest: { ...envelope().digest, headSha: newer } } });
  const clean = await observe(event('success', { ids: { run: '42', attempt: '2' }, refs: { head: newer } }), { pr: nextPR, checkSnapshot: green(newer) });
  assert.equal(clean.policy.disposition, 'recovery');
  const late = await observe(event('failure', { ids: { run: '42', attempt: '1' }, refs: { head: newer } }), { pr: nextPR }); assert.equal(late.policy.material, false); assert.equal(late.evidence.stale, true);
  for (const action of ['enqueued', 'ejected', 'requeued']) await observe(event('unknown', { family: 'delivery', kind: 'merge_group', action, refs: { candidate: base } }), { pr: nextPR, queue: { groupSha: base, prs: ['3'] } });
  const merged = await observe(event('merged', { family: 'work', kind: 'pull_request', refs: { head: newer } }), { pr: { ...nextPR, merged: true, state: 'closed' } });
  assert.equal(merged.evidence.nextStep, 'observe_landed_sha_and_deploy_separately'); assert.equal(merged.state.closed, true); assert.equal(new Set(roots).size, 1);
  const unmerged = routeObservation({ ...input(event('closed', { family: 'work' })), pr: { ...pr, state: 'closed' } }); assert.equal(unmerged.evidence.nextStep, 'closed_without_merge');
});
test('ten inherited PRs link one verified health episode without author actions, new roots or mentions', () => {
  const episode = { number: 9, kind: 'main-red', verified: true };
  const results = Array.from({ length: 10 }, (_, i) => routeObservation({ ...input(event('failure')), pr: { ...pr, number: i + 1 }, digestEnvelope: envelope('inherited_main_failure'), incident: episode, allowMentions: true, mentionMap: { 'slot:S18': 'UOWNER' } }));
  assert.ok(results.every(r => r.policy.disposition === 'shared' && !r.policy.material && !r.policy.mentionKey)); assert.deepEqual([...new Set(results.map(r => r.evidence.incidentIssue))], [9]);
  const unknown = routeObservation({ ...input(event('failure')), digestEnvelope: envelope('inherited_main_failure'), incident: { ...episode, verified: false } }); assert.equal(unknown.evidence.incidentIssue, null);
});
test('two failures in the same shard use the existing digest fingerprints; unknown/mixed/fork results remain explicit', () => {
  const first = routeObservation(input(event('failure'))); const second = routeObservation({ ...input(event('failure')), previous: first.state, digestEnvelope: envelope('pr_failure', ['different-failure']) });
  assert.notEqual(first.state.fingerprint, second.state.fingerprint); assert.equal(second.policy.material, true); assert.equal(second.state.root, first.state.root);
  const repeated = routeObservation({ ...input(event('failure')), previous: first.state }); assert.equal(repeated.policy.material, false);
  const mixed = routeObservation({ ...input(event('failure')), digestEnvelope: envelope('pr_failure', ['mixed'], { mixed: true }) }); assert.equal(mixed.evidence.cause, 'mixed_pr_and_shared');
  const unknown = routeObservation({ ...input(event('failure')), digestEnvelope: envelope('main_health_unknown') }); assert.equal(unknown.policy.disposition, 'unknown');
  const fork = routeObservation({ ...input(event('failure')), pr: { ...pr, fork: true }, digestEnvelope: null }); assert.equal(fork.policy.disposition, 'unknown'); assert.equal(fork.policy.mentionKey, null);
});
test('released/expired/competing/multi-issue claims and case aliases do not guess owner or Slack identity', () => {
  assert.equal(canonicalSlot('s18'), 'S18'); assert.equal(canonicalSlot('S018'), 'S18'); assert.equal(canonicalSlot('someone'), null);
  assert.equal(ownership({ issues, claims: [claim()], pr, now }).slot, 'S18');
  assert.equal(ownership({ issues, claims: [{ ...claim(), released: true }], pr, now }).evidence, 'pr_author_fallback');
  assert.equal(ownership({ issues, claims: [claim(7, 's18', '18', new Date(now - 25 * 3600000))], pr, now }).kind, 'triage');
  assert.equal(ownership({ issues: [{ number: 7, labels: [] }], claims: [claim()], pr, now }).kind, 'triage');
  assert.equal(ownership({ issues: [...issues, { number: 8, labels: ['slot:S19'] }], claims: [claim(), claim(8, 's19', '19')], pr, now }).kind, 'triage');
  const fallback = routeObservation({ ...input(event('failure')), issues: [], claims: [], allowMentions: true, mentionMap: {} }); assert.equal(fallback.policy.mentionKey, null);
  const mapped = routeObservation({ ...input(event('failure')), allowMentions: true, mentionMap: { 'slot:S18': 'UOWNER' } }); assert.equal(mapped.policy.mentionKey, 'slot:S18');
  assert.equal(ownership({ pr: { author: 'not a login', branch: 'slot:S18', displayName: 'S18' }, now }).kind, 'triage');
});
test('required check promotion comes only from live rules, application identity and exact head/run/attempt evidence', () => {
  const e = event('failure');
  const advisory = routeObservation({ ...input(e), requiredCheck: { ...requiredCheck, name: 'shadow-new' } }); assert.equal(advisory.policy.material, false);
  const cutover = structuredClone(ruleset); cutover.rules[0].parameters.required_status_checks[0].context = 'shadow-new';
  const old = routeObservation({ ...input(e), ruleset: cutover }); assert.equal(old.policy.material, false);
  const promoted = routeObservation({ ...input(e), ruleset: cutover, requiredCheck: { ...requiredCheck, name: 'shadow-new' } }); assert.equal(promoted.policy.disposition, 'action');
  const wrongApp = routeObservation({ ...input(e), requiredCheck: { ...requiredCheck, appId: 99 } }); assert.equal(wrongApp.policy.material, false);
  for (const mutation of [{ requiredCheck: { ...requiredCheck, attempt: '2' } }, { digestEnvelope: { ...envelope(), verified: false } }, { digestEnvelope: { ...envelope(), author: 'outsider' } }, { digestEnvelope: { ...envelope(), attempt: '2' } }, { ruleset: null }]) assert.equal(routeObservation({ ...input(e), ...mutation }).policy.disposition, 'unknown');
});
test('a single successful job or an incomplete required-check snapshot cannot recover a PR action', () => {
  const first = routeObservation(input(event('failure'))), e = event('success');
  for (const snapshot of [null, { ...green(head, '1'), checks: [green().checks[0]] }, { ...green(head, '1'), verified: false }]) assert.equal(routeObservation({ ...input(e), previous: first.state, checkSnapshot: snapshot }).policy.material, false);
  const complete = routeObservation({ ...input(e), previous: first.state, checkSnapshot: green(head, '1') }); assert.equal(complete.policy.disposition, 'recovery');
});
test('queue group membership and SHA proof are exact; advisory overlap is never a verified conflict', () => {
  const e = event('unknown', { family: 'delivery', kind: 'merge_group', refs: { candidate: base } });
  const queue = { groupSha: base, prs: ['3'], advisoryOverlap: true };
  assert.equal(routeObservation({ ...input(e), queue }).evidence.nextStep, 'verify_overlap_before_claiming_conflict');
  assert.equal(routeObservation({ ...input(e), queue: { ...queue, verifiedConflict: false, proofSource: 'merge-tree', headSha: head, baseSha: base } }).policy.disposition, 'routine');
  const verified = routeObservation({ ...input(e), queue: { ...queue, verifiedConflict: true, proofSource: 'merge-tree', headSha: head, baseSha: base } }); assert.equal(verified.policy.disposition, 'action');
  const unmapped = routeObservation({ event: e, queue }); assert.equal(unmapped.policy.subject, null); assert.equal(unmapped.evidence.nextStep, 'confirm_queue_membership');
  const wrong = routeObservation({ ...input(e), queue: { ...queue, groupSha: newer } }); assert.equal(wrong.policy.material, false);
});
test('metadata store serializes concurrent/replayed observations without GitHub effects; context transport is GET-only', async () => {
  const { router, rows } = history(), e = event('failure'); const results = await Promise.all([router.observe(input(e)), router.observe(input(e))]);
  assert.equal(results.filter(r => r.replayed).length, 1); assert.equal([...rows.keys()].filter(k => k.includes(':event:')).length, 1);
  const paths = []; const read = async path => { paths.push(path); if (path.includes('/pulls/')) return { ...pr, head: { sha: head, repo: { full_name: 'o/r' } }, base: { sha: base, repo: { full_name: 'o/r' } } }; if (path.includes('/rulesets/')) return ruleset; if (path.includes('/issues/')) return issues[0]; if (path.includes('/git/ref/')) return { ref: 'refs/heads/claim/7', object: { sha: base } }; return { message: claim().message }; };
  const context = await readRoutingContext({ read, repository: 'o/r', prNumber: 3, linkedIssues: [7] }); assert.equal(context.claims.length, 1); assert.ok(paths.every(p => p.startsWith('/repos/o/r/')));
  const api = readOnlyGithub({ token: 'fixture', fetchImpl: async (url, init) => { assert.equal(init.method, 'GET'); return Response.json({ ok: true }); } }); await api('/repos/o/r/rulesets/25309597');
  for (const path of ['scripts/lib/notificationRouting.mjs', 'scripts/notification-routing-context.mjs']) assert.doesNotMatch(readFileSync(path, 'utf8'), /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]|workflow_dispatch|mergePullRequest|runClaim\(/);
});

test('stale heads and review commit SHAs stay activity only; SQLite decision/state commit rolls back together', async () => {
  const stale = routeObservation({ ...input(event('failure')), pr: { ...pr, head: { sha: newer } } }); assert.equal(stale.evidence.stale, true); assert.equal(stale.policy.material, false);
  const review = routeObservation({ ...input(event('changes_requested', { family: 'work', kind: 'pull_request_review', refs: { head: newer, reviewed: head } })), pr: { ...pr, head: { sha: newer } } }); assert.equal(review.evidence.stale, true); assert.equal(review.policy.material, false);
  const { DatabaseSync } = await import('node:sqlite'), { SqliteRoutingStore } = await import('../../scripts/lib/notificationRoutingStore.mjs');
  const db = new DatabaseSync(':memory:'); let fail = true;
  const sql = { exec: (q, ...args) => { if (fail && q.startsWith('INSERT INTO routing_current')) throw Error('checkpoint interrupted'); const rows = db.prepare(q).all(...args); return { toArray: () => rows }; } };
  const store = new SqliteRoutingStore(sql, fn => { db.exec('BEGIN'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } });
  try {
    const e = event('failure'), router = new RoutingHistory(store); await assert.rejects(router.observe(input(e)), /interrupted/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM routing_decisions').get().n, 0); fail = false;
    await router.observe(input(e)); const restarted = new RoutingHistory(new SqliteRoutingStore(sql, store.transaction)); const replay = await restarted.observe(input(e)); assert.equal(replay.replayed, true); assert.equal(replay.state.root, 'subject:o/r:pr:3:prs');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM routing_decisions').get().n, 1);
  } finally { db.close(); }
});
