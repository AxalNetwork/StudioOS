// D5664: metadata-only signed ingress, durable ledger restart, semantic dedup and split/overlap convergence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeEvent, eventKey, SECURITY_EVENTS } from '../../engineering-notifications/events-v1.mjs';
import { receive, signed } from '../../engineering-notifications/ingress.mjs';
import { EventLedger } from '../../engineering-notifications/ledger.mjs';
import { reconcile, reconcileWindow, githubReader } from '../../engineering-notifications/reconcile.mjs';
import { actionsSource } from '../../engineering-notifications/github-source.mjs';
const repository = { id: 42, full_name: 'o/r', private: false };
const at = '2026-11-12T10:00:00Z';
const run = (id = 11, attempt = 1, conclusion = 'success') => ({ id, run_attempt: attempt, head_sha: 'a'.repeat(40), status: 'completed', conclusion, updated_at: at, workflow_id: 12, pull_requests: [{ number: 1 }, { number: 2 }] });
const event = (object = run(), deliveryId = `test:${object.id}:${object.run_attempt}`) => normalizeEvent({ kind: 'workflow_run', deliveryId, observedAt: at, payload: { repository, workflow_run: object } });
function open(path = ':memory:') {
  const db = new DatabaseSync(path);
  const sql = { exec: (query, ...args) => ({ toArray: () => db.prepare(query).all(...args) }) };
  // Execute writes immediately, as DurableObject sql.exec does.
  sql.exec = (query, ...args) => { const rows = db.prepare(query).all(...args); return { toArray: () => rows }; };
  const ledger = new EventLedger(sql, fn => { db.exec('BEGIN'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } });
  return { db, ledger };
}
test('raw-byte signature and installation/repository/event allowlists precede durable acceptance; content never enters queue', async () => {
  const payload = { repository, installation: { id: 7 }, workflow_run: { ...run(), display_title: 'secret title', logs: 'private log' }, comment: { body: '<!channel> secret' } };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('fixture-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = 'sha256=' + [...new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  const request = (body = bytes, sig = signature, kind = 'workflow_run') => new Request('https://fixture/github', { method: 'POST', headers: { 'x-hub-signature-256': sig, 'x-github-event': kind, 'x-github-delivery': 'delivery-1' }, body });
  let queued = [], block = true;
  const env = { WEBHOOK_SECRET: 'fixture-secret', REPOSITORY_ID: '42', INSTALLATION_ID: '7', REPOSITORY: 'o/r', EVENTS: { send: async e => { if (block) throw new Error('queue unavailable'); queued.push(e); } } };
  assert.equal(await signed(bytes, signature, 'fixture-secret'), true);
  assert.equal(await signed(new Uint8Array([...bytes, 32]), signature, 'fixture-secret'), false);
  assert.equal((await receive(request(bytes, signature.replace(/.$/, signature.endsWith('0') ? '1' : '0')), env)).status, 401);
  await assert.rejects(receive(request(), env), /queue unavailable/); assert.equal(queued.length, 0);
  block = false; assert.equal((await receive(request(), env)).status, 202); assert.equal(queued.length, 1);
  assert.doesNotMatch(JSON.stringify(queued), /private log|secret title|<!channel>|comment.*body/);
  assert.equal((await receive(request(), { ...env, INSTALLATION_ID: '8' })).status, 403);
  assert.equal((await receive(request(), { ...env, REPOSITORY_ID: '43' })).status, 403);
  assert.equal((await receive(request(bytes, signature, 'new_unapproved_kind'), env)).status, 403);
});
test('canonical states keep multiple PRs, workflow/check identities, unknowns, fork visibility and distinct SHA roles', async () => {
  const r = await event(); assert.deepEqual(r.ids.prs, ['1', '2']); assert.equal(r.ids.workflow, '12'); assert.equal(r.refs.runHead, 'a'.repeat(40)); assert.equal(r.refs.head, null);
  const pr = await normalizeEvent({ kind: 'pull_request', deliveryId: 'pr', payload: { repository, pull_request: { id: 5, number: 3, state: 'open', head: { sha: 'b'.repeat(40), repo: { fork: true } }, base: { sha: 'a'.repeat(40), ref: 'main' }, merge_commit_sha: 'c'.repeat(40), labels: [{ name: 'slot:S18' }, { name: '<!channel>' }, { name: 'github_pat_fixture_not_a_token' }], body: 'secret' } }, observedAt: at });
  assert.equal(pr.refs.head, 'b'.repeat(40)); assert.equal(pr.refs.candidate, 'c'.repeat(40)); assert.equal(pr.refs.landed, null); assert.deepEqual(pr.labels, ['slot:S18']);
  const check = await normalizeEvent({ kind: 'check_run', deliveryId: 'check', payload: { repository, check_run: { id: 99, status: 'new_provider_state', app: { id: 88, slug: 'new-provider' }, head_sha: 'c'.repeat(40), updated_at: at } }, observedAt: at });
  const unicode = await normalizeEvent({ kind: 'check_run', deliveryId: 'unicode-check', payload: { repository, check_run: { id: 100, name: 'api ↔ worker drift', head_sha: 'a'.repeat(40), updated_at: at } } });
  assert.equal(unicode.checkContext, 'api ↔ worker drift');
  assert.equal(check.state, 'unknown'); assert.equal(check.provider.id, '88'); assert.equal(check.refs.tested, 'c'.repeat(40));
  const unknown = await normalizeEvent({ kind: 'new_provider_event', deliveryId: 'unknown', payload: { repository, body: 'do not store' }, observedAt: at });
  assert.equal(unknown.family, 'unsupported'); assert.ok(unknown.gaps.includes('unsupported_event_kind'));
  for (const kind of SECURITY_EVENTS) await assert.rejects(normalizeEvent({ kind, deliveryId: 'security', payload: { repository } }), /boundary/);
  const restricted = await normalizeEvent({ kind: 'dependabot_alert', deliveryId: 'security', securityApproved: true, payload: { repository, alert: { id: 4, state: 'open', secret: 'never store', updated_at: at } } });
  assert.equal(restricted.visibility, 'restricted'); assert.doesNotMatch(JSON.stringify(restricted), /never store/);
});
test('restart after acknowledgement, repeated delivery, reversed events and two attempts preserve immutable history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's38-ledger-')), path = join(dir, 'events.sqlite'); let f = open(path);
  try {
    const first = await event(run(11, 1, 'failure')); await f.ledger.append(first); await f.ledger.append({ ...first, deliveryId: 'redelivered' });
    assert.equal(f.ledger.history().length, 1); assert.equal(f.ledger.counts().deliveries, 2);
    await f.ledger.append(await event(run(11, 2, 'success')));
    const queued = { ...run(), run_attempt: 1, status: 'queued', conclusion: null, updated_at: '2026-11-12T09:00:00Z' };
    await f.ledger.append(await event(queued, 'older-queued'));
    assert.equal(f.ledger.history().length, 3); assert.equal(f.ledger.pending().length, 0);
    f.db.close(); f = open(path); const result = await f.ledger.append(first); assert.equal(result.duplicateDelivery, true); assert.equal(f.ledger.history().length, 3);
    await assert.rejects(f.ledger.append({ ...await event(run(12)), deliveryId: first.deliveryId }), /collision/);
    assert.equal(f.ledger.history().length, 3);
  } finally { f.db.close(); rmSync(dir, { recursive: true }); }
});
test('more than 1000 source results split rather than truncate; dropped items converge, interruption preserves cursor', async () => {
  const f = open(); const start = Date.parse(at), items = await Promise.all(Array.from({ length: 1205 }, (_, i) => event({ ...run(i + 1), updated_at: new Date(start + i * 1000).toISOString() }, `rest-${i}`)));
  const source = { scope: 'actions', start, recheck: async () => {}, list: async ({ start: from, end, page }) => { const all = items.filter(i => Date.parse(i.occurredAt) >= from && Date.parse(i.occurredAt) <= end); return { total: all.length, items: all.slice((page - 1) * 100, page * 100) }; } };
  try {
    await f.ledger.append(items[0]); assert.equal(await reconcile({ ledger: f.ledger, source, until: start + 1_205_000 }), true);
    assert.equal(f.ledger.counts().families[0].count, 1205); assert.equal(f.ledger.cursor('actions'), start + 1_205_000);
    assert.equal(await reconcile({ ledger: f.ledger, source, until: start + 1_205_000 }), true); assert.equal(f.ledger.counts().families[0].count, 1205);
    source.list = async () => { throw new Error('permission_revoked'); };
    assert.equal(await reconcile({ ledger: f.ledger, source, until: start + 1_206_000 }), false); assert.equal(f.ledger.cursor('actions'), start + 1_205_000);
    assert.ok(f.ledger.counts().gaps.some(g => g.code === 'permission_revoked'));
    assert.ok(f.ledger.counts().gaps.some(g => g.code === 'poll_cannot_reconstruct_intermediate_transitions'));
  } finally { f.db.close(); }
});
test('same-second source density and missing pages are explicit unrecoverable gaps', async () => {
  const gaps = []; const gap = v => gaps.push(v);
  assert.equal(await reconcileWindow({ start: 0, end: 1000, scope: 'actions', gap, accept: () => {}, list: async () => ({ total: 1001, items: [] }) }), false);
  assert.equal(gaps[0].code, 'source_density_exceeds_cap');
  assert.equal(await reconcileWindow({ start: 0, end: 1000, scope: 'actions', gap, accept: () => {}, list: async () => ({ total: 2, items: [] }) }), false);
  assert.equal(gaps[1].code, 'source_page_missing');
});
test('Actions adapter discovers newly registered workflows, all attempts/jobs and orphan runs, with GET-only rate-aware API', async () => {
  const records = [], paths = [], root = '/repos/o/r';
  const read = async path => { paths.push(path); if (path.includes('/jobs?')) return { jobs: [{ id: 99 + Number(/attempts\/(\d+)/.exec(path)[1]), status: 'completed', conclusion: 'cancelled', steps: [{ number: 1, name: 'setup', status: 'completed', conclusion: 'success' }] }] }; if (path.includes('/attempts/')) return { ...run(11, Number(path.split('/').at(-1))), workflow_id: 999, pull_requests: [] }; return { total_count: 1, workflow_runs: [{ ...run(11, 2), workflow_id: 999, pull_requests: [] }] }; };
  const source = actionsSource({ read, repository, start: 0, gap: () => {} }); const page = await source.list({ start: 0, end: Date.parse(at), page: 1 }); await source.enrich(page.items[0], e => records.push(e));
  assert.equal(page.items[0].ids.workflow, '999'); assert.deepEqual(page.items[0].ids.prs, []);
  assert.deepEqual(records.filter(e => e.subject.type === 'job').map(e => e.ids.attempt), ['1', '2']); assert.ok(paths.every(p => p.startsWith(root)));
  for (const status of [401, 403, 429, 503]) {
    const reader = githubReader({ token: 'fixture', fetchImpl: async (url, init) => { assert.equal(init.method, 'GET'); return new Response('', { status }); } });
    await assert.rejects(reader('/repos/o/r/actions/runs'), status === 429 ? /rate_limited/ : status === 503 ? /source_unavailable/ : /permission_revoked/);
  }
});

test('untrusted canonical extras and visibility escalation cannot be persisted', async () => {
  const f = open();
  try {
    const value = await event();
    const extra = { ...value, commentBody: 'secret' }; extra.key = await eventKey(extra);
    await assert.rejects(f.ledger.append(extra), /invalid/);
    const gapExtra = { ...value, sourceGap: { scope: 'actions', from: 1, to: 2, body: 'secret' } }; gapExtra.key = await eventKey(gapExtra);
    await assert.rejects(f.ledger.append(gapExtra), /invalid/);
    await assert.rejects(f.ledger.append({ ...value, ownership: { issue: '1', slot: { body: 'secret' }, session: null, state: null, expiresAt: null } }), /invalid/);
    await assert.rejects(f.ledger.append({ ...value, key: '0'.repeat(64) }), /digest_invalid/);
    await assert.rejects(f.ledger.append({ ...value, ids: { ...value.ids, body: 'secret' } }), /invalid/);
    await assert.rejects(f.ledger.append({ ...value, visibility: 'anything' }), /invalid/);
    assert.equal(f.ledger.history().length, 0);
  } finally { f.db.close(); }
});

test('actual Workers SQLite/RPC retains one acknowledged event across runtime restart and isolates partitions', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../../cloudflare-worker/package.json', import.meta.url));
  const { build } = require('esbuild'), { Miniflare, convertV4MiniflareOptions } = require('miniflare');
  const entry = new URL('../../engineering-notifications/worker.mjs', import.meta.url).pathname;
  const source = `import worker, { EngineeringLedger } from ${JSON.stringify(entry)}; export { EngineeringLedger }; export default { ...worker, async fetch(request,env,ctx) { const path = new URL(request.url).pathname; if (path.startsWith('/fixture/')) { const stub = env.LEDGER.getByName(path.endsWith('other') ? 'other' : 'fixture'); return Response.json(request.method === 'POST' ? await stub.append(await request.json()) : await stub.counts()); } return worker.fetch(request,env,ctx); } };`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: 'fixture.mjs' }, bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers'] });
  const dir = mkdtempSync(join(tmpdir(), 's38-workers-ledger-'));
  // Installed workerd supports through November 8. Production config targets November 12;
  // the deployment gate must verify that target with an upgraded runtime.
  const options = convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-08', compatibilityFlags: ['nodejs_compat'], durableObjects: { LEDGER: { className: 'EngineeringLedger', useSQLite: true } }, resourcePersistencePath: dir, bindings: { CAPTURE_ENABLED: 'false', RECONCILE_ENABLED: 'false', REPOSITORY_ID: '42' } });
  let mf = new Miniflare(options);
  try {
    const value = await event();
    const send = () => mf.dispatchFetch('https://fixture/fixture/append', { method: 'POST', body: JSON.stringify(value) });
    const first = await send(); assert.equal(first.status, 200); assert.equal((await first.json()).duplicateDelivery, false);
    await mf.dispose(); mf = new Miniflare(options);
    const again = await send(); assert.equal(again.status, 200); assert.equal((await again.json()).duplicateDelivery, true);
    const own = await (await mf.dispatchFetch('https://fixture/fixture/counts')).json(); assert.equal(own.families[0].count, 1); assert.equal(own.deliveries, 1);
    const other = await (await mf.dispatchFetch('https://fixture/fixture/other')).json(); assert.deepEqual(other.families, []);
    const disabled = await mf.dispatchFetch('https://fixture/github', { method: 'POST', body: 'fixture' }); assert.equal(disabled.status, 503);
  } finally { await mf.dispose(); rmSync(dir, { recursive: true }); }
});

test('downtime resumes the durable cursor even when it predates the new bootstrap window; reviewed head remains distinct', async () => {
  const f = open(); let observed;
  try {
    f.ledger.checkpoint('actions', 10000);
    const source = { scope: 'actions', start: 1000000, recheck: async () => {}, list: async ({start}) => { observed = start; return { total: 0, items: [] }; } };
    assert.equal(await reconcile({ ledger: f.ledger, source, until: 2000000, overlapMs: 1000 }), true); assert.equal(observed, 9000);
    const review = await normalizeEvent({ kind: 'pull_request_review', deliveryId: 'reviewed', payload: { repository, pull_request: { number: 3, head: { sha: 'b'.repeat(40) } }, review: { id: 4, state: 'changes_requested', commit_id: 'a'.repeat(40), updated_at: at } } });
    assert.equal(review.refs.reviewed, 'a'.repeat(40)); assert.equal(review.refs.head, 'b'.repeat(40));
  } finally { f.db.close(); }
});

test('work/delivery/check/claim snapshots recover metadata while missed transitions and revoked scopes remain gaps', async () => {
  const { reconcileSnapshots } = await import('../../engineering-notifications/snapshots.mjs');
  const { claimMessage } = await import('../../scripts/lib/claims.mjs');
  const f = open(), paths = [], prHead = 'a'.repeat(40);
  const read = async path => {
    paths.push(path);
    if (/\/pulls\?/.test(path)) return [{ id: 3, number: 3, state: 'open', draft: true, head: { sha: prHead }, updated_at: at, labels: [{ name: 'slot:S18' }] }];
    if (path.includes('/reviews?')) return [{ id: 30, state: 'changes_requested', commit_id: prHead, submitted_at: at }];
    if (path.includes('/pulls/3/comments?')) return [{ id: 31, updated_at: at, body: 'never retain comment' }];
    if (/\/issues\?/.test(path)) return [{ id: 7, number: 7, state: 'open', updated_at: at }];
    if (path.includes('/issues/comments?')) return [{ id: 32, updated_at: at, issue_url: 'https://api.github.com/repos/o/r/issues/7', body: 'never retain issue body' }];
    if (path.includes('/releases?')) return [{ id: 50, published_at: at, body: 'never retain release body' }];
    if (path.includes('/deployments/60/statuses?')) return [{ id: 61, state: 'success', created_at: at }];
    if (path.includes('/deployments?')) return [{ id: 60, environment: 'staging', sha: prHead, created_at: at }];
    if (path.includes('/matching-refs/heads/claim/')) return [{ ref: 'refs/heads/claim/7', object: { sha: prHead } }];
    if (path.includes('/git/commits/')) return { message: claimMessage({ issue: 7, slot: 'S18', session: '18', agent: 'Codex', at: new Date(at) }) };
    if (path.includes('/matching-refs/')) return [];
    if (path.includes('/check-runs?')) return { check_runs: [{ id: 90, name: 'new-external-check', head_sha: prHead, status: 'completed', conclusion: 'success', updated_at: at, app: { id: 91, slug: 'new-provider' } }] };
    if (path.includes('/statuses?')) return [{ id: 92, context: 'external-status', state: 'success', created_at: at }];
    throw Error('unhandled fixture');
  };
  try {
    const result = await reconcileSnapshots({ read, ledger: f.ledger, repository, until: Date.parse(at) + 1000 }); assert.equal(result.complete, true);
    const records = f.ledger.history(0, 1000); assert.ok(records.some(e => e.kind === 'pull_request' && e.draft === true)); assert.ok(records.some(e => e.ids.review === '30' && e.refs.reviewed === prHead)); assert.ok(records.some(e => e.ids.comment === '31')); assert.ok(records.some(e => e.ids.release === '50')); assert.ok(records.some(e => e.ids.deployment === '60' && e.state === 'success' && e.refs.deploymentTarget === prHead && e.refs.landed === null)); assert.ok(records.some(e => e.provider.id === '91')); assert.ok(records.some(e => e.kind === 'claim'));
    assert.doesNotMatch(JSON.stringify(records), /never retain/); assert.ok(result.gaps.some(g => g.scope === 'security')); const cursor = f.ledger.cursor('snapshots');
    const failed = await reconcileSnapshots({ read: async () => { throw Error('permission_revoked'); }, ledger: f.ledger, repository, until: Date.parse(at) + 2000 }); assert.equal(failed.complete, false); assert.equal(f.ledger.cursor('snapshots'), cursor); assert.ok(failed.gaps.some(g => g.code === 'permission_revoked'));
  } finally { f.db.close(); }
});

test('rate headers pause subsequent reads and expose a durable reset deadline without leaking response bodies', async () => {
  let calls = 0, reset = 0;
  const read = githubReader({ token: 'fixture', now: () => 1000, onRateLimit: until => reset = until, fetchImpl: async () => { calls++; return new Response('private response omitted', { status: 429, headers: { 'retry-after': '7', 'x-ratelimit-reset': '20' } }); } });
  await assert.rejects(read('/repos/o/r/actions/runs'), /rate_limited/); await assert.rejects(read('/repos/o/r/pulls'), /rate_limited/); assert.equal(calls, 1); assert.equal(reset, 20000);
});

test('security requires the separately configured deployment and never crosses normal ingress', async () => {
  const payload = { repository, installation: { id: 7 }, alert: { id: 8, state: 'open', updated_at: at, secret: 'not retained' } }, bytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('fixture-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = 'sha256=' + [...new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  const request = path => new Request(`https://fixture${path}`, { method: 'POST', body: bytes, headers: { 'x-hub-signature-256': sig, 'x-github-event': 'dependabot_alert', 'x-github-delivery': 'security-fixture' } });
  const items = [], env = { SECURITY_MODE: 'true', SECURITY_WEBHOOK_SECRET: 'fixture-secret', SECURITY_INSTALLATION_ID: '7', REPOSITORY_ID: '42', REPOSITORY: 'o/r', ALLOWED_EVENTS: JSON.stringify(['dependabot_alert']), EVENTS: { send: async e => items.push(e) } };
  assert.equal((await receive(request('/security'), { ...env, SECURITY_MODE: 'false' })).status, 403);
  assert.equal((await receive(request('/github'), env)).status, 403); assert.equal(items.length, 0);
  assert.equal((await receive(request('/security'), env)).status, 202); assert.equal(items[0].visibility, 'restricted'); assert.doesNotMatch(JSON.stringify(items), /not retained/);
});

test('public ingress has a durable anonymous minute budget rather than unbounded signature work', () => {
  const f = open();
  try { assert.equal(f.ledger.admit(1000, 2), true); assert.equal(f.ledger.admit(1000, 2), true); assert.equal(f.ledger.admit(1000, 2), false); assert.equal(f.ledger.admit(61000, 2), true); assert.equal(f.ledger.counts().rejects[0].code, 'ingress_rate_limited'); }
  finally { f.db.close(); }
});

test('REST/webhook CI actions share semantic identity and opaque review-thread IDs remain traceable', async () => {
  const a = await normalizeEvent({ kind: 'workflow_run', deliveryId: 'webhook-completed', payload: { repository, workflow_run: run(), action: 'completed' }, observedAt: at });
  const b = await normalizeEvent({ kind: 'workflow_run', deliveryId: 'rest-completed', payload: { repository, workflow_run: run() }, source: 'github-rest', observedAt: at });
  assert.equal(a.key, b.key); const f = open(); try { await f.ledger.append(a); await f.ledger.append(b); assert.equal(f.ledger.history().length, 1); assert.equal(f.ledger.counts().deliveries, 2); } finally { f.db.close(); }
  const thread = await normalizeEvent({ kind: 'pull_request_review_thread', deliveryId: 'thread', payload: { repository, pull_request: { number: 3 }, thread: { id: 'PRRT_fixture_123', is_resolved: true, updated_at: at }, action: 'resolved' } });
  assert.equal(thread.ids.thread, 'PRRT_fixture_123'); assert.equal(thread.subject.id, 'PRRT_fixture_123'); assert.equal(thread.conversation.resolved, true);
});
