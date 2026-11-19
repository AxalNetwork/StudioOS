// D5569 part 3: real SQLite reservations and a synthetic GitHub server, with no live credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { makeD1 } from './_d1_sqlite.mjs';
import { executeAgentPublication, publisherAppJwt, type PublisherBrokerPorts, type PublisherPreflight } from '../src/services/agents/agentPublisherBroker';
import { type PublishIntent } from '../src/services/agents/agentPublisher';

const NOW = Date.UTC(2026, 10, 19, 10);
const BASE = 'a'.repeat(40), CANDIDATE = 'b'.repeat(40);
const SCOPE = { tenant_id: 1, company_id: 2, project_id: 3 };
const PATCH = 'diff --git a/src/x.ts b/src/x.ts\n+export const x = 2;\n';
const TOKEN = 'synthetic-private-installation-token';
const sha256 = async (text: string) => 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');

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
    summary: '</code>\n/approve @owner\n<!-- spoof -->',
  };
  const evidence: PublisherPreflight = {
    candidate_sha: CANDIDATE,
    observations: {
      now_ms: NOW, enabled: true,
      installation: { uid, ...SCOPE, repository_full_name: 'venture/example', base_ref: 'refs/heads/main',
        revoked_at: null, approved_by_user_id: 5, github_status: 'active', allowed_paths: ['src/'], observed_at_ms: NOW },
      base_head_sha: BASE, existing_prs: [], last_github_response: null,
      candidate_checks: { required: ['test'], results: { test: 'success' } },
      approvals: [{ user_id: 5, decision_uid: 'e'.repeat(32) }],
    },
    work_intent: { uid: 'work-1', ...SCOPE, repository_full_name: 'venture/example',
      task_id: 'task-1', agent_id: 'agent:1', run_uuid: intent.provenance.run_uuid,
      base_sha: BASE, paths: ['src/x.ts'], expires_at_ms: NOW + 60_000, state: 'active' },
  };
  const calls: { path: string; init: RequestInit; body: Record<string, unknown> | null }[] = [];
  const response = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
  let override: ((path: string, init: RequestInit) => Promise<Response | null>) | null = null;
  const ports: PublisherBrokerPorts = {
    now: () => NOW,
    authorize: async () => true,
    preflight: async () => structuredClone(evidence),
    appJwt: async appId => { assert.equal(appId, 20); return 'synthetic-app-jwt'; },
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(init.redirect, 'error');
      calls.push({ path: url.pathname, init, body: init.body ? JSON.parse(String(init.body)) : null });
      const changed = await override?.(url.pathname, init);
      if (changed) return changed;
      if (url.pathname === '/app/installations/30') return response({ id: 30, app_id: 20, suspended_at: null });
      if (url.pathname.endsWith('/access_tokens')) return response({ token: TOKEN, expires_at: new Date(NOW + 3_600_000).toISOString() }, 201);
      assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer ' + TOKEN);
      if (url.pathname === '/repos/venture/example') return response({ id: 40, full_name: 'venture/example' });
      if (url.pathname.includes('/git/commits/')) return response({ sha: CANDIDATE, parents: [{ sha: BASE }] });
      if (url.pathname.includes('/compare/')) return (init.headers as Record<string, string>).Accept === 'application/vnd.github.diff'
        ? new Response(PATCH) : response({ total_commits: 1, files: [{ filename: 'src/x.ts', status: 'modified' }] });
      if (url.pathname.includes('/git/ref/')) return response({ object: { sha: BASE } });
      if (url.pathname.endsWith('/git/refs')) return response({ ref: 'refs/heads/agent/task-1/1', object: { sha: CANDIDATE } }, 201);
      if (url.pathname.endsWith('/pulls')) return response({
        number: 7, html_url: 'https://github.com/venture/example/pull/7', draft: true, head: { sha: CANDIDATE },
      }, 201);
      throw new Error('unexpected endpoint ' + url.pathname);
    },
  };
  return { DB, db, intent, evidence, ports, calls, response,
    override(fn: typeof override) { override = fn; },
    run: (flag: unknown = 'on', custom: Partial<PublishIntent> = {}) => executeAgentPublication({ DB }, SCOPE, { ...intent, ...custom }, CANDIDATE, flag, ports) };
}

test('disabled, denied scope, missing WorkIntent and wrong candidate refuse before token minting', async t => {
  const f = await fixture(t);
  for (const flag of [null, 'off', true]) assert.equal((await f.run(flag)).ok, false);
  assert.equal((await executeAgentPublication({ DB: f.DB }, SCOPE, f.intent, CANDIDATE, undefined, f.ports)).ok, false);
  f.ports.authorize = async () => false;
  assert.deepEqual(await f.run(), { ok: false, code: 'not_authorized', retryable: false });
  f.ports.authorize = async () => true;
  assert.deepEqual(await f.run('on', { company_id: 99 }), { ok: false, code: 'not_authorized', retryable: false });
  f.evidence.work_intent = null;
  assert.deepEqual(await f.run(), { ok: false, code: 'work_intent_required', retryable: false });
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM agent_publish_requests').get()!.n, 0);
});

test('published result is traceable, draft only, repository scoped, credential free, and replayed without network writes', async t => {
  const f = await fixture(t);
  const result = await f.run();
  assert.deepEqual(result, { ok: true, number: 7, url: 'https://github.com/venture/example/pull/7', commit_sha: CANDIDATE, replayed: false });
  const mint = f.calls.find(c => c.path.endsWith('/access_tokens'))!;
  assert.deepEqual(mint.body, { repository_ids: [40], permissions: { contents: 'write', pull_requests: 'write', metadata: 'read', checks: 'read' } });
  const branch = f.calls.find(c => c.path.endsWith('/git/refs'))!;
  assert.deepEqual(branch.body, { ref: 'refs/heads/agent/task-1/1', sha: CANDIDATE });
  const pr = f.calls.find(c => c.path.endsWith('/pulls'))!.body!;
  assert.equal(pr.draft, true);
  assert.equal(pr.maintainer_can_modify, false);
  assert.doesNotMatch(String(pr.body), /\n\/approve|<!-- spoof|@owner/);
  const audit = f.db.prepare('SELECT * FROM agent_publish_requests').get()!;
  assert.equal(audit.agent_id, 'agent:1');
  assert.equal(audit.run_uuid, f.intent.provenance.run_uuid);
  assert.equal(audit.work_intent_uid, 'work-1');
  assert.equal(audit.repository_full_name, 'venture/example');
  assert.equal(audit.target_ref, 'refs/heads/main');
  assert.equal(audit.head_ref, 'agent/task-1/1');
  assert.equal(audit.deploy_sha, null);
  assert.doesNotMatch(JSON.stringify({ audit, result }), /synthetic-private|synthetic-app-jwt/);
  const n = f.calls.length;
  assert.equal((await f.run()).ok, true);
  assert.equal(f.calls.length, n);
});

test('concurrent duplicate deliveries reserve one logical task; another attempt cannot open a second PR', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.run(), f.run()]);
  assert.equal(results.filter(r => r.ok).length >= 1, true);
  assert.equal(f.calls.filter(c => c.path.endsWith('/pulls')).length, 1);
  const changed = await f.run('on', { idempotency_key: 'publish:new-attempt', provenance: { ...f.intent.provenance, attempt: 2 } });
  assert.deepEqual(changed, { ok: false, code: 'idempotency_conflict', retryable: false });
});

test('actual candidate paths, parent and patch bytes are verified before creating a ref', async t => {
  for (const mode of ['path', 'parent', 'digest', 'extra']) {
    const f = await fixture(t);
    f.override(async (path, init) => {
      if (mode === 'parent' && path.includes('/git/commits/')) return f.response({ sha: CANDIDATE, parents: [{ sha: 'f'.repeat(40) }] });
      if (path.includes('/compare/')) {
        if (mode === 'digest' && (init.headers as Record<string, string>).Accept === 'application/vnd.github.diff') return new Response('other bytes');
        if (mode === 'path' && (init.headers as Record<string, string>).Accept !== 'application/vnd.github.diff') return f.response({ total_commits: 1, files: [{ filename: '.github/workflows/x.yml', status: 'modified' }] });
        if (mode === 'extra') return f.response({ total_commits: 2, files: [{ filename: 'src/x.ts', status: 'modified' }] });
      }
      return null;
    });
    assert.deepEqual(await f.run(), { ok: false, code: 'candidate_mismatch', retryable: false }, mode);
    assert.equal(f.calls.some(c => c.path.endsWith('/git/refs')), false);
  }
});

test('base movement, revoked installation, and stale WorkIntent are rechecked before writes', async t => {
  for (const mode of ['base', 'revoke', 'intent', 'checks']) {
    const f = await fixture(t);
    let reads = 0;
    f.ports.preflight = async () => {
      reads++;
      if (reads === 2) {
        if (mode === 'intent') f.evidence.work_intent!.state = 'revoked';
        if (mode === 'checks') f.evidence.observations.candidate_checks!.results.test = 'failure';
      }
      return structuredClone(f.evidence);
    };
    f.override(async path => {
      if (mode === 'base' && path.includes('/git/ref/')) return f.response({ object: { sha: 'f'.repeat(40) } });
      if (mode === 'revoke' && path.includes('/compare/')) f.db.exec("UPDATE venture_git_installations SET revoked_at='2026-11-19'");
      return null;
    });
    assert.equal((await f.run()).ok, false, mode);
    assert.equal(f.calls.some(c => c.path.endsWith('/git/refs')), false, mode);
  }
});

test('403 and 429 return classified backoff with no automatic network replay', async t => {
  for (const status of [403, 429]) {
    const f = await fixture(t);
    f.override(async path => path.endsWith('/access_tokens') ? f.response({ message: TOKEN }, status) : null);
    const result = await f.run();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, status === 403 ? 'github_forbidden' : 'github_rate_limited');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
    const n = f.calls.length;
    assert.equal((await f.run()).ok, false);
    assert.equal(f.calls.length, n);
  }
});

test('an accepted PR with a lost response stays unknown; replay creates no duplicate', async t => {
  const f = await fixture(t);
  f.override(async path => { if (path.endsWith('/pulls')) throw new Error('response lost ' + TOKEN); return null; });
  const result = await f.run();
  assert.deepEqual(result, { ok: false, code: 'github_unavailable', retryable: false });
  assert.equal(f.db.prepare('SELECT state FROM agent_publish_requests').get()!.state, 'unknown');
  const before = f.calls.length;
  assert.deepEqual(await f.run(), { ok: false, code: 'publication_pending', retryable: false });
  assert.equal(f.calls.length, before);
});

test('RS256 app JWT binds the app and short validity using a broker-owned key', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]) }, false, ['sign', 'verify']);
  const jwt = await publisherAppJwt(20, keys.privateKey, NOW);
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), { iss: '20', iat: NOW / 1000 - 60, exp: NOW / 1000 + 540 });
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(signature, 'base64url'),
    new TextEncoder().encode(header + '.' + payload)), true);
});


test('safe read failures retry after backoff, with a five-attempt bound', async t => {
  const f = await fixture(t);
  let now = NOW;
  f.ports.now = () => now;
  f.ports.preflight = async () => {
    const evidence = structuredClone(f.evidence);
    evidence.observations.installation!.observed_at_ms = now;
    evidence.work_intent!.expires_at_ms = now + 60_000;
    return evidence;
  };
  f.override(async path => path.endsWith('/access_tokens') ? f.response({}, 429) : null);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await f.run();
    assert.equal(result.ok, false);
    const row = f.db.prepare('SELECT attempts,retry_at_ms,state FROM agent_publish_requests').get()!;
    assert.equal(row.attempts, attempt);
    assert.equal(row.state, 'refused');
    if (attempt === 5) assert.equal(row.retry_at_ms, null);
    const count = f.calls.length;
    assert.equal((await f.run()).ok, false);
    assert.equal(f.calls.length, count);
    now = Number(row.retry_at_ms ?? now) + 1;
  }
  assert.equal(f.calls.filter(c => c.path.endsWith('/access_tokens')).length, 5);
  assert.equal(f.calls.some(c => c.path.endsWith('/git/refs')), false);
});

test('foreign repository, suspended installation, redirects and oversized bodies never produce writes', async t => {
  for (const mode of ['repository', 'suspended', 'redirect', 'oversize', 'expiry']) {
    const f = await fixture(t);
    f.override(async path => {
      if (mode === 'suspended' && path === '/app/installations/30') return f.response({ id: 30, app_id: 20, suspended_at: '2026-11-19' });
      if (mode === 'repository' && path === '/repos/venture/example') return f.response({ id: 41, full_name: 'venture/example' });
      if (mode === 'redirect' && path === '/app/installations/30') return new Response(null, { status: 302, headers: { Location: 'https://example.com' } });
      if (mode === 'oversize' && path === '/app/installations/30') return new Response('x'.repeat(2 * 1024 * 1024 + 1));
      if (mode === 'expiry' && path.endsWith('/access_tokens')) return f.response({ token: TOKEN, expires_at: new Date(NOW - 1).toISOString() });
      return null;
    });
    assert.equal((await f.run()).ok, false, mode);
    assert.equal(f.calls.some(c => c.path.endsWith('/git/refs')), false, mode);
  }
});

test('missing, neutral and skipped required checks block publication', async t => {
  for (const conclusion of ['neutral', 'skipped', 'pending']) {
    const f = await fixture(t);
    f.evidence.observations.candidate_checks!.results.test = conclusion as 'pending';
    const result = await f.run();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'required_checks_pending');
    assert.equal(f.calls.length, 0);
  }
});

test('pending capacity refuses before minting, and a cross-task idempotency key cannot be reused', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).ok, true);
  f.evidence.work_intent!.task_id = 'task-2';
  const sameKey = await f.run('on', { provenance: { ...f.intent.provenance, task_id: 'task-2' } });
  assert.deepEqual(sameKey, { ok: false, code: 'idempotency_conflict', retryable: false });
  const original = f.db.prepare('SELECT id FROM agent_publish_requests').get()!.id;
  const fill = f.db.prepare(`INSERT INTO agent_publish_requests (tenant_id,company_id,project_id,installation_uid,task_id,
    agent_id,run_uuid,idempotency_key,intent_digest,patch_digest,candidate_sha,base_sha,work_intent_uid,approvals_json,repository_full_name,target_ref,head_ref,state,created_at_ms)
    SELECT tenant_id,company_id,project_id,installation_uid,?,agent_id,run_uuid,?,intent_digest,patch_digest,candidate_sha,
    base_sha,work_intent_uid,approvals_json,repository_full_name,target_ref,head_ref,'unknown',created_at_ms FROM agent_publish_requests WHERE id=?`);
  for (let n = 0; n < 100; n++) fill.run('occupied-' + n, 'occupied:' + n, original);
  const count = f.calls.length;
  const full = await f.run('on', { provenance: { ...f.intent.provenance, task_id: 'task-2' }, idempotency_key: 'publish:task-2:1' });
  assert.deepEqual(full, { ok: false, code: 'queue_full', retryable: true });
  assert.equal(f.calls.length, count);
});

test('authorization and reservation are scoped to the installation and current project owner', async t => {
  const f = await fixture(t);
  f.db.exec('UPDATE projects SET company_id=9 WHERE id=3');
  assert.deepEqual(await f.run(), { ok: false, code: 'installation_not_found', retryable: false });
  assert.equal(f.calls.length, 0);
});

test('a secondary-limit message on 403 has a bounded retry, and a forged ref response stops before PR creation', async t => {
  const limited = await fixture(t);
  limited.override(async path => path.endsWith('/access_tokens')
    ? limited.response({ message: 'You have exceeded a secondary rate limit.' }, 403) : null);
  const result = await limited.run();
  assert.deepEqual(result, { ok: false, code: 'github_rate_limited', retryable: true, retry_at: new Date(NOW + 60_000).toISOString() });
  const forged = await fixture(t);
  forged.override(async path => path.endsWith('/git/refs')
    ? forged.response({ ref: 'refs/heads/main', object: { sha: CANDIDATE } }, 201) : null);
  assert.equal((await forged.run()).ok, false);
  assert.equal(forged.calls.some(c => c.path.endsWith('/pulls')), false);
});

test('WorkIntent path and candidate binding are independent of the installed path policy', async t => {
  const f = await fixture(t);
  f.evidence.work_intent!.paths = ['src/another.ts'];
  assert.deepEqual(await f.run(), { ok: false, code: 'work_intent_required', retryable: false });
  assert.equal(f.calls.length, 0);
  f.evidence.work_intent!.paths = ['src/x.ts'];
  f.evidence.candidate_sha = 'f'.repeat(40);
  assert.deepEqual(await f.run(), { ok: false, code: 'candidate_mismatch', retryable: false });
  assert.equal(f.calls.length, 0);
});

test('different concurrent attempts of one task cannot reserve two branch writes', async t => {
  const f = await fixture(t);
  await Promise.all([
    f.run(),
    f.run('on', { idempotency_key: 'publish:another-attempt', provenance: { ...f.intent.provenance, attempt: 2 } }),
  ]);
  assert.equal(f.calls.filter(c => c.path.endsWith('/git/refs')).length, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM agent_publish_requests').get()!.n, 1);
  const stored = f.db.prepare('SELECT * FROM agent_publish_requests').get()!;
  const columns = Object.keys(stored).filter(column => column !== 'id');
  const placeholders = columns.map(() => '?').join(',');
  assert.throws(() => f.db.prepare('INSERT INTO agent_publish_requests (' + columns.join(',') + ') VALUES (' + placeholders + ')')
    .run(...columns.map(column => column === 'idempotency_key' ? 'another-key-for-the-same-task' : stored[column])), /UNIQUE/);
});
