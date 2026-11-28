// D8966 (#8966, D5569 part 5): reconciliation of unknown and abandoned publication reservations, against real SQLite
// and one synthetic GitHub that both the broker and the read-only reconciler see. No network, no live credential.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { makeD1 } from './_d1_sqlite.mjs';
import { executeAgentPublication, type PublisherBrokerPorts, type PublisherPreflight } from '../src/services/agents/agentPublisherBroker';
import { type PublishIntent } from '../src/services/agents/agentPublisher';
import {
  reconcileAgentPublications, RECONCILE_AFTER_MS, RECONCILE_FORBIDDEN_RETRY_MS, RECONCILE_RETRY_MS,
  type GitReadResponse, type ReconcileEvidence,
} from '../src/services/agents/agentPublisherReconcile';

const NOW = Date.UTC(2026, 10, 27, 10);
const LATER = NOW + RECONCILE_AFTER_MS + 1;
const BASE = 'a'.repeat(40), CANDIDATE = 'b'.repeat(40), OTHER = 'f'.repeat(40);
const SCOPE = { tenant_id: 1, company_id: 2, project_id: 3 };
const PATCH = 'diff --git a/src/x.ts b/src/x.ts\n+export const x = 2;\n';
const TOKEN = 'synthetic-private-installation-token';
const URL7 = 'https://github.com/venture/example/pull/7';
const sha256 = async (text: string) => 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');

type SyntheticPull = {
  number: number; html_url: string; state: 'open' | 'closed'; draft: boolean; merged_at: string | null;
  head: { ref: string; sha: string; repo: { full_name: string } | null }; base: { ref: string };
};
const pull = (over: Partial<SyntheticPull> = {}, head: Partial<SyntheticPull['head']> = {}): SyntheticPull => ({
  number: 7, html_url: URL7, state: 'open', draft: true, merged_at: null,
  head: { ref: 'agent/task-1/1', sha: CANDIDATE, repo: { full_name: 'venture/example' }, ...head },
  base: { ref: 'main' }, ...over,
});
const answer = (data: unknown, status = 200, headers: Record<string, string> = {}): GitReadResponse =>
  ({ status, body: typeof data === 'string' ? data : JSON.stringify(data), headers: new Headers(headers) });

async function fixture(t: TestContext) {
  const { DB, db } = makeD1(`
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY, archived_at TEXT);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO company_profiles VALUES(2,NULL);
    INSERT INTO projects VALUES(3,2,NULL);
    INSERT INTO users VALUES(5);
  `);
  t.after(() => db.close());
  for (const path of ['202611122104_5569_venture_git_installations.sql', '202611190937_5569_agent_publish_requests.sql']) {
    const sql = readFileSync(new URL('../sql/migrations/' + path, import.meta.url), 'utf8');
    db.exec(sql); db.exec(sql);
  }
  db.exec(readFileSync(new URL('../sql/migrations/202611271849_8966_agent_publish_reconcile.sql', import.meta.url), 'utf8'));
  // D8071: the broker reads the agent's PR budget; the tables the budget migration alters stand in as stubs.
  db.exec('CREATE TABLE team_agents(id INTEGER PRIMARY KEY); CREATE TABLE scope_tasks(id INTEGER PRIMARY KEY); ' +
    'CREATE TABLE agent_scope_settings(id INTEGER PRIMARY KEY); CREATE TABLE ai_agent_policy(id INTEGER PRIMARY KEY);');
  db.exec(readFileSync(new URL('../sql/migrations/202611221909_8071_agent_budgets.sql', import.meta.url), 'utf8'));
  const uid = db.prepare(`INSERT INTO venture_git_installations(tenant_id,company_id,project_id,app_id,installation_id,
    repository_id,repository_full_name,base_ref,approved_at,approved_by_user_id)
    VALUES(1,2,3,20,30,40,'venture/example','refs/heads/main','2026-11-19',5) RETURNING uid`).get()!.uid as string;
  const intent: PublishIntent = {
    version: 1, ...SCOPE, installation_uid: uid, repository_full_name: 'venture/example',
    target_ref: 'refs/heads/main', base_sha: BASE, patch_digest: await sha256(PATCH),
    files: [{ path: 'src/x.ts', change: 'modified' }],
    provenance: { agent_id: 'agent:1', task_id: 'task-1', run_uuid: '11111111-2222-4333-8444-555555555555',
      attempt: 1, image_digest: 'sha256:' + 'c'.repeat(64), evidence_digest: 'sha256:' + 'd'.repeat(64) },
    agent_checks: { tests: 'passed', scan: 'passed' }, idempotency_key: 'publish:task-1:1',
    summary: 'synthetic change',
  };
  let now = NOW;
  const evidence = (): PublisherPreflight => ({
    candidate_sha: CANDIDATE,
    observations: {
      now_ms: now, enabled: true,
      installation: { uid, ...SCOPE, repository_full_name: 'venture/example', base_ref: 'refs/heads/main',
        revoked_at: null, approved_by_user_id: 5, github_status: 'active', allowed_paths: ['src/'], observed_at_ms: now },
      base_head_sha: BASE, existing_prs: [], last_github_response: null,
      candidate_checks: { required: ['test'], results: { test: 'success' } },
      approvals: [{ user_id: 5, decision_uid: 'e'.repeat(32) }],
    },
    work_intent: { uid: 'work-1', ...SCOPE, repository_full_name: 'venture/example',
      task_id: intent.provenance.task_id, agent_id: 'agent:1', run_uuid: intent.provenance.run_uuid,
      base_sha: BASE, paths: ['src/x.ts'], expires_at_ms: now + 60_000, state: 'active' },
  });

  // One GitHub for both sides. The broker writes refs and PRs into it; the reconciler only reads it.
  const github = {
    refs: new Map<string, string>(),
    pulls: [] as SyntheticPull[],
    reads: [] as string[],
    writes: [] as string[],
    loseResponse: null as null | 'refs' | 'pulls',
    /** Replaces the reconciler's answer for a path; `throw` is a transport that got no response. */
    fail: null as null | ((path: string) => GitReadResponse | 'throw' | null),
  };
  const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const broker: PublisherBrokerPorts = {
    now: () => now,
    authorize: async () => true,
    preflight: async () => evidence(),
    appJwt: async () => 'synthetic-app-jwt',
    fetch: async (input, init = {}) => {
      const path = new URL(String(input)).pathname;
      if (path === '/app/installations/30') return response({ id: 30, app_id: 20, suspended_at: null });
      if (path.endsWith('/access_tokens')) return response({ token: TOKEN, expires_at: new Date(now + 3_600_000).toISOString() }, 201);
      if (path === '/repos/venture/example') return response({ id: 40, full_name: 'venture/example' });
      if (path.includes('/git/commits/')) return response({ sha: CANDIDATE, parents: [{ sha: BASE }] });
      if (path.includes('/compare/')) return (init.headers as Record<string, string>).Accept === 'application/vnd.github.diff'
        ? new Response(PATCH) : response({ total_commits: 1, files: [{ filename: 'src/x.ts', status: 'modified' }] });
      if (path.includes('/git/ref/')) return response({ object: { sha: BASE } });
      if (path.endsWith('/git/refs')) {
        const body = JSON.parse(String(init.body)) as { ref: string; sha: string };
        github.writes.push('broker POST /git/refs');
        if (github.refs.has(body.ref)) return response({ message: 'Reference already exists' }, 422);
        github.refs.set(body.ref, body.sha);
        if (github.loseResponse === 'refs') throw new Error('response lost');
        return response({ ref: body.ref, object: { sha: body.sha } }, 201);
      }
      if (path.endsWith('/pulls')) {
        const body = JSON.parse(String(init.body)) as { head: string };
        github.writes.push('broker POST /pulls');
        const number = 7 + github.pulls.length;
        const created = pull({ number, html_url: 'https://github.com/venture/example/pull/' + number }, { ref: body.head });
        github.pulls.push(created);
        if (github.loseResponse === 'pulls') throw new Error('response lost');
        return response(created, 201);
      }
      throw new Error('unexpected endpoint ' + path);
    },
  };
  // The reconciler's transport. It also exposes write methods that a correct reconciler never reaches.
  const transport = {
    repository_full_name: 'venture/example',
    async get(path: string): Promise<GitReadResponse> {
      github.reads.push(path);
      const forced = github.fail?.(path);
      if (forced === 'throw') throw new Error('no response');
      if (forced) return forced;
      const ref = /^\/git\/ref\/heads\/(.+)$/.exec(path);
      if (ref) {
        const name = 'refs/heads/' + ref[1].split('/').map(decodeURIComponent).join('/');
        const sha = github.refs.get(name);
        return sha ? answer({ ref: name, object: { sha, type: 'commit' } }) : answer({ message: 'Not Found' }, 404);
      }
      if (path.startsWith('/pulls?')) {
        const query = new URLSearchParams(path.slice('/pulls?'.length));
        assert.equal(query.get('state'), 'all');
        const [owner, branch] = query.get('head')!.split(/:(.*)/s);
        return answer(github.pulls.filter(p => p.head.ref === branch && p.head.repo?.full_name.split('/')[0] === owner));
      }
      throw new Error('unexpected read ' + path);
    },
    async post(path: string) { github.writes.push('reconciler POST ' + path); return answer({}, 201); },
    async patch(path: string) { github.writes.push('reconciler PATCH ' + path); return answer({}); },
    async delete(path: string) { github.writes.push('reconciler DELETE ' + path); return answer({}, 204); },
  };
  const targets: unknown[] = [];
  const ports = {
    now: () => now,
    transportFor: async (target: unknown) => { targets.push(target); return transport; },
  };
  const insert = db.prepare(`INSERT INTO agent_publish_requests (tenant_id,company_id,project_id,installation_uid,task_id,
    agent_id,run_uuid,idempotency_key,intent_digest,patch_digest,candidate_sha,base_sha,work_intent_uid,approvals_json,
    repository_full_name,target_ref,head_ref,state,created_at_ms,attempts,retry_at_ms,last_outcome_at_ms)
    VALUES (1,2,3,?,?,'agent:1','run',?,'sha256:x','sha256:y',?,?,'work-1','[]','venture/example','refs/heads/main',?,?,?,?,?,?) RETURNING id`);
  const seed = (task: string, over: { state?: string; created?: number; last?: number | null; attempts?: number; retry?: number | null } = {}) =>
    Number(insert.get(uid, task, 'key:' + task, CANDIDATE, BASE, 'agent/' + task + '/1', over.state ?? 'unknown',
      over.created ?? NOW, over.attempts ?? 1, over.retry ?? null, over.last === undefined ? NOW : over.last)!.id);
  const row = (id: number) => ({ ...db.prepare('SELECT * FROM agent_publish_requests WHERE id=?').get(id)! }) as Record<string, unknown>;
  const evidenceOf = (id: number) => JSON.parse(String(row(id).reconcile_evidence_json)) as ReconcileEvidence;
  return {
    DB, db, uid, intent, github, transport, ports, targets, seed, row, evidenceOf,
    at(ms: number) { now = ms; },
    publish: (custom: Partial<PublishIntent> = {}) => executeAgentPublication({ DB }, SCOPE, { ...intent, ...custom }, CANDIDATE, 'on', broker),
    reconcile: (limit?: number) => reconcileAgentPublications({ DB }, ports, { limit }),
  };
}

test('a PR whose creation response was lost becomes published with its number and URL; replay opens no second PR', async t => {
  const f = await fixture(t);
  f.github.loseResponse = 'pulls';
  assert.deepEqual(await f.publish(), { ok: false, code: 'github_unavailable', retryable: false });
  const id = Number(f.db.prepare('SELECT id FROM agent_publish_requests').get()!.id);
  assert.equal(f.row(id).state, 'unknown');
  assert.equal(f.github.pulls.length, 1);
  const writes = f.github.writes.length;

  f.at(NOW + RECONCILE_AFTER_MS - 1);
  assert.deepEqual(await f.reconcile(), [], 'not before the deadline');
  assert.equal(f.github.reads.length, 0);

  f.at(LATER);
  assert.deepEqual(await f.reconcile(), [{ id, outcome: 'published', pr_number: 7, pr_url: URL7 }]);
  const settled = f.row(id);
  assert.equal(settled.state, 'published');
  assert.equal(settled.pr_number, 7);
  assert.equal(settled.pr_url, URL7);
  assert.equal(settled.retry_at_ms, null);
  assert.equal(settled.last_outcome_at_ms, LATER);
  assert.equal(settled.reconciled_at_ms, LATER);
  assert.deepEqual(f.evidenceOf(id), {
    version: 1, outcome: 'published', prior_state: 'unknown', checked_at_ms: LATER,
    ref: { name: 'refs/heads/agent/task-1/1', sha: CANDIDATE }, candidate_sha: CANDIDATE, pulls_total: 1,
    pulls: [{ number: 7, url: URL7, head_sha: CANDIDATE, base_matches: true, state: 'open', merged: false, draft: true }],
    reasons: [],
  });
  assert.deepEqual(f.targets, [{ installation_uid: f.uid, repository_full_name: 'venture/example' }]);
  assert.deepEqual(f.github.reads, ['/git/ref/heads/agent/task-1/1', '/pulls?head=venture%3Aagent%2Ftask-1%2F1&state=all&per_page=100']);
  assert.equal(f.github.writes.length, writes, 'the reconciler wrote nothing');
  assert.doesNotMatch(String(settled.reconcile_evidence_json), /synthetic-private|synthetic-app-jwt/);

  // The broker's replay now returns the receipt; nothing is sent to GitHub and no second PR exists.
  assert.deepEqual(await f.publish(), { ok: true, number: 7, url: URL7, commit_sha: CANDIDATE, replayed: true });
  assert.equal(f.github.writes.length, writes);
  assert.equal(f.github.pulls.length, 1);
  assert.deepEqual(await f.reconcile(), [], 'a published row is never revisited');
});

test('a ref or PR that disagrees with the record is refused, with evidence, and nothing is deleted or retried', async t => {
  const cases: [string, (f: Awaited<ReturnType<typeof fixture>>) => void, string[]][] = [
    ['ref at another SHA, no PR', f => f.github.refs.set('refs/heads/agent/task-1/1', OTHER), ['ref_sha_differs', 'pr_missing']],
    ['ref matches, PR head differs', f => { f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE); f.github.pulls.push(pull({}, { sha: OTHER })); }, ['pr_head_differs']],
    ['ref differs, PR matches', f => { f.github.refs.set('refs/heads/agent/task-1/1', OTHER); f.github.pulls.push(pull()); }, ['ref_sha_differs']],
    ['ref matches, no PR', f => f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE), ['pr_missing']],
    ['PR merged and its branch deleted', f => f.github.pulls.push(pull({ state: 'closed', merged_at: '2026-11-27T09:00:00Z' })), ['ref_missing']],
    ['two PRs on one branch', f => { f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE); f.github.pulls.push(pull(), pull({ number: 8, html_url: 'https://github.com/venture/example/pull/8' })); }, ['pr_multiple']],
    ['PR against another base', f => { f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE); f.github.pulls.push(pull({ base: { ref: 'release' } })); }, ['pr_base_differs']],
    ['PR URL not canonical', f => { f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE); f.github.pulls.push(pull({ html_url: 'https://example.com/venture/example/pull/7' })); }, ['pr_url_differs']],
    ['PR URL names another PR', f => { f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE); f.github.pulls.push(pull({ html_url: 'https://github.com/venture/example/pull/70' })); }, ['pr_url_differs']],
    ['PR URL names another repository', f => { f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE); f.github.pulls.push(pull({ html_url: 'https://github.com/venture/other/pull/7' })); }, ['pr_url_differs']],
  ];
  for (const [name, arrange, reasons] of cases) {
    const f = await fixture(t);
    const id = f.seed('task-1');
    arrange(f);
    const refs = new Map(f.github.refs);
    f.at(LATER);
    assert.deepEqual(await f.reconcile(), [{ id, outcome: 'mismatch', reasons }], name);
    const settled = f.row(id);
    assert.equal(settled.state, 'refused', name);
    assert.equal(settled.retry_at_ms, null, name + ': a person decides, the broker does not retry');
    assert.equal(settled.pr_number, null, name);
    const evidence = f.evidenceOf(id);
    assert.equal(evidence.outcome, 'mismatch', name);
    assert.deepEqual(evidence.reasons, reasons, name);
    assert.deepEqual(evidence.ref, refs.has('refs/heads/agent/task-1/1')
      ? { name: 'refs/heads/agent/task-1/1', sha: refs.get('refs/heads/agent/task-1/1') } : null, name);
    assert.equal(evidence.pulls_total, f.github.pulls.length, name);
    assert.deepEqual(f.github.refs, refs, name + ': the branch is kept');
    assert.deepEqual(f.github.writes, [], name);
    assert.deepEqual(await f.reconcile(), [], name + ': refused is final for the reconciler');
  }
});

test('evidence of a non-canonical PR URL keeps no untrusted text', async t => {
  const f = await fixture(t);
  const id = f.seed('task-1');
  f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE);
  f.github.pulls.push(pull({ html_url: 'https://github.com/venture/example/pull/7?<script>' }));
  f.at(LATER);
  await f.reconcile();
  assert.equal(f.evidenceOf(id).pulls[0].url, '');
  assert.doesNotMatch(String(f.row(id).reconcile_evidence_json), /script/);
});

test('a listed PR for another head is ignored, and a full page is never read as one PR', async t => {
  const f = await fixture(t);
  const id = f.seed('task-1');
  f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE);
  const foreign = [pull({ number: 8 }, { ref: 'agent/task-1/10' }), pull({ number: 9 }, { repo: { full_name: 'fork/example' } }), pull({ number: 10 }, { repo: null })];
  f.github.fail = path => path.startsWith('/pulls') ? answer([...foreign, pull()]) : null;
  f.at(LATER);
  assert.deepEqual(await f.reconcile(), [{ id, outcome: 'published', pr_number: 7, pr_url: URL7 }]);

  const full = await fixture(t);
  const fullId = full.seed('task-1');
  full.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE);
  full.github.fail = path => path.startsWith('/pulls')
    ? answer([...Array.from({ length: 99 }, (_, n) => pull({ number: 100 + n }, { repo: null })), pull()]) : null;
  full.at(LATER);
  assert.deepEqual(await full.reconcile(), [{ id: fullId, outcome: 'mismatch', reasons: ['pr_multiple'] }]);
  assert.equal(full.evidenceOf(fullId).pulls_total, 2);
  assert.deepEqual(full.github.writes, []);
});

test('no ref and no PR after the deadline resolves without any write, and the broker may retry within its bound', async t => {
  const f = await fixture(t);
  const id = f.seed('task-1');
  const spent = f.seed('task-2', { attempts: 5 });
  f.at(LATER);
  assert.deepEqual(await f.reconcile(), [
    { id, outcome: 'absent', retry_at_ms: LATER },
    { id: spent, outcome: 'absent', retry_at_ms: null },
  ]);
  for (const [rowId, retry] of [[id, LATER], [spent, null]] as const) {
    const settled = f.row(rowId);
    assert.equal(settled.state, 'refused');
    assert.equal(settled.retry_at_ms, retry);
    assert.equal(settled.last_outcome_at_ms, LATER);
    assert.deepEqual(f.evidenceOf(rowId), {
      version: 1, outcome: 'absent', prior_state: 'unknown', checked_at_ms: LATER, ref: null,
      candidate_sha: CANDIDATE, pulls_total: 0, pulls: [], reasons: [],
    });
  }
  assert.deepEqual(f.github.writes, []);
  assert.equal(f.github.reads.length, 4);
});

test('a read error, 5xx, 429 or 403 leaves the row as it was and records only when to look again', async t => {
  const limited = (path: string) => path.startsWith('/pulls') ? answer({ message: 'slow down' }, 429, { 'retry-after': '120' }) : null;
  const cases: [string, (path: string) => GitReadResponse | 'throw' | null, string, number][] = [
    ['no response', () => 'throw', 'github_unavailable', LATER + RECONCILE_RETRY_MS],
    ['5xx on the ref', path => path.startsWith('/git/ref') ? answer('bad gateway', 502) : null, 'github_unavailable', LATER + RECONCILE_RETRY_MS],
    ['5xx on the PR list', path => path.startsWith('/pulls') ? answer('oops', 503) : null, 'github_unavailable', LATER + RECONCILE_RETRY_MS],
    ['429 with retry-after', limited, 'github_rate_limited', LATER + 120_000],
    ['secondary limit 403', () => answer({ message: 'You have exceeded a secondary rate limit.' }, 403), 'github_rate_limited', LATER + 60_000],
    ['primary limit 403', () => answer({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(LATER / 1000) + 600) }), 'github_rate_limited', Math.floor(LATER / 1000) * 1000 + 600_000],
    ['plain 403', () => answer({ message: 'Resource not accessible by integration' }, 403), 'github_forbidden', LATER + RECONCILE_FORBIDDEN_RETRY_MS],
    ['401', () => answer({}, 401), 'github_unavailable', LATER + RECONCILE_RETRY_MS],
    ['PR list 404', path => path.startsWith('/pulls') ? answer({}, 404) : null, 'github_unavailable', LATER + RECONCILE_RETRY_MS],
    ['malformed body', path => path.startsWith('/git/ref') ? answer('{not json') : null, 'github_unavailable', LATER + RECONCILE_RETRY_MS],
    ['ref answered for another name', path => path.startsWith('/git/ref') ? answer({ ref: 'refs/heads/agent/task-1/10', object: { sha: CANDIDATE } }) : null, 'github_unavailable', LATER + RECONCILE_RETRY_MS],
    ['PR list not a list', path => path.startsWith('/pulls') ? answer({ message: 'x' }) : null, 'github_unavailable', LATER + RECONCILE_RETRY_MS],
    ['PR with a malformed head SHA', path => path.startsWith('/pulls') ? answer([pull({}, { sha: 'nope' })]) : null, 'github_unavailable', LATER + RECONCILE_RETRY_MS],
  ];
  for (const [name, fail, code, retryAt] of cases) {
    const f = await fixture(t);
    const id = f.seed('task-1');
    // GitHub does hold a matching branch and PR: an unread answer must not publish or refuse the row.
    f.github.refs.set('refs/heads/agent/task-1/1', CANDIDATE);
    f.github.pulls.push(pull());
    const before = f.row(id);
    f.github.fail = fail;
    f.at(LATER);
    assert.deepEqual(await f.reconcile(), [{ id, outcome: 'unreadable', code, retry_at_ms: retryAt }], name);
    assert.deepEqual(f.row(id), { ...before, retry_at_ms: retryAt }, name);
    assert.deepEqual(f.github.writes, [], name);
    f.at(retryAt - 1);
    const reads = f.github.reads.length;
    assert.deepEqual(await f.reconcile(), [], name + ': not before the recorded time');
    assert.equal(f.github.reads.length, reads, name);
    f.github.fail = null;
    f.at(retryAt);
    assert.equal((await f.reconcile())[0]?.outcome, 'published', name + ': read again at the recorded time');
    assert.equal(f.row(id).retry_at_ms, null, name + ': a resolved row keeps no retry time');
  }
});

test('an installation that cannot be read, or a transport for another repository, reads nothing and changes nothing', async t => {
  for (const mode of ['throws', 'foreign']) {
    const f = await fixture(t);
    const id = f.seed('task-1');
    f.ports.transportFor = async () => {
      if (mode === 'throws') throw new Error('installation revoked');
      return { ...f.transport, repository_full_name: 'venture/other' };
    };
    f.at(LATER);
    assert.deepEqual(await f.reconcile(), [{ id, outcome: 'unreadable', code: 'github_unavailable', retry_at_ms: LATER + RECONCILE_RETRY_MS }], mode);
    assert.equal(f.row(id).state, 'unknown', mode);
    assert.deepEqual(f.github.reads, [], mode);
  }
});

test('a reserved row is reconciled only once abandoned; one a retry re-opened waits a full deadline first', async t => {
  const f = await fixture(t);
  const fresh = f.seed('task-1', { state: 'reserved', last: null, created: NOW });
  const reopened = f.seed('task-2', { state: 'reserved', last: NOW - 2 * RECONCILE_AFTER_MS, created: NOW - 3 * RECONCILE_AFTER_MS, attempts: 2 });
  f.at(NOW + RECONCILE_AFTER_MS - 1);
  assert.deepEqual(await f.reconcile(), [{ id: reopened, outcome: 'deferred', retry_at_ms: NOW + 2 * RECONCILE_AFTER_MS - 1 }]);
  assert.equal(f.row(reopened).state, 'reserved');
  assert.equal(f.row(fresh).retry_at_ms, null);
  assert.deepEqual(f.github.reads, [], 'deferring reads nothing');
  assert.deepEqual(await f.reconcile(), [], 'not twice');

  f.at(LATER);
  assert.deepEqual(await f.reconcile(), [{ id: fresh, outcome: 'absent', retry_at_ms: LATER }]);
  assert.equal(f.evidenceOf(fresh).prior_state, 'reserved');
  assert.equal(f.row(reopened).state, 'reserved');

  f.at(NOW + 2 * RECONCILE_AFTER_MS - 1);
  f.github.refs.set('refs/heads/agent/task-2/1', CANDIDATE);
  f.github.pulls.push(pull({ number: 9, html_url: 'https://github.com/venture/example/pull/9' }, { ref: 'agent/task-2/1' }));
  assert.deepEqual(await f.reconcile(), [{ id: reopened, outcome: 'published', pr_number: 9, pr_url: 'https://github.com/venture/example/pull/9' }]);
  assert.deepEqual(f.github.writes, []);
});

test('a row the broker moves during the read is left as the broker wrote it', async t => {
  const f = await fixture(t);
  const id = f.seed('task-1');
  f.github.refs.set('refs/heads/agent/task-1/1', OTHER);
  f.github.fail = path => {
    if (path.startsWith('/pulls')) f.db.prepare("UPDATE agent_publish_requests SET state='published', pr_number=7, pr_url=? WHERE id=?").run(URL7, id);
    return null;
  };
  f.at(LATER);
  assert.deepEqual(await f.reconcile(), [{ id, outcome: 'raced' }]);
  assert.equal(f.row(id).state, 'published');
  assert.equal(f.row(id).reconcile_evidence_json, null);
});

test('resolving unknown rows frees the tenant capacity they held', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 100; n++) f.seed('occupied-' + n);
  assert.deepEqual(await f.publish(), { ok: false, code: 'queue_full', retryable: true });
  assert.equal(f.github.writes.length, 0);

  f.at(LATER);
  const outcomes = await f.reconcile(100);
  assert.equal(outcomes.length, 100);
  assert.equal(outcomes.every(o => o.outcome === 'absent'), true);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM agent_publish_requests WHERE state IN ('reserved','unknown')").get()!.n, 0);

  const result = await f.publish();
  assert.deepEqual(result, { ok: true, number: 7, url: URL7, commit_sha: CANDIDATE, replayed: false });
  assert.deepEqual(f.github.writes, ['broker POST /git/refs', 'broker POST /pulls']);
});

test('the batch is bounded and oldest first', async t => {
  const f = await fixture(t);
  const late = f.seed('task-1', { last: NOW });
  const early = f.seed('task-2', { last: NOW - 1000 });
  f.at(LATER);
  assert.deepEqual((await f.reconcile(1)).map(o => o.id), [early]);
  assert.deepEqual((await f.reconcile(1)).map(o => o.id), [late]);
});
