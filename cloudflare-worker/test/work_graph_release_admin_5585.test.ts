/**
 * D5585 part 7 (#5585, WorkGraph P1) — the Super-Admin release routes and the scheduled release drain, both off by
 * default. The real router over the full migrated schema, with part 2's synthetic campaign world, the real adapters
 * (a fake `FILES` bucket for `website_cdn`; no distribution channel, so `external_distribution` refuses
 * `target_not_configured`). No test reaches a provider.
 *
 *   1. Flag off (absent, or any value but `on`): every route refuses 404 `release_admin_off` before any D1 read, signed
 *      in or not; the scheduled drain returns null without a D1 read while delivery is not `preview`; the cron hook is
 *      in `scheduled()` on its own minute, behind a dynamic import.
 *   2. Gates: an admin who is not a Super Admin and a member are refused every route; a Super Admin without a step-up
 *      reads but cannot write or drain.
 *   3. Cross-tenant: a request naming another scope is refused `wrong_tenant` on every read and write and writes nothing
 *      (a takedown's refusal is recorded against the line's own tenant); the other scope's lists are empty.
 *   4. Publish: the reviewed digest must be the manifest's (`stale_approval`), the expected pointer must be the head
 *      (`stale_revision`), a Super Admin holds no release authority by default (`approval_required`); with authorities
 *      resolved it publishes once, replays, and every attempt is an admin audit row.
 *   5. Drain: the manual drain is bounded (limit and cap), delivers each effect once, is idempotent, refuses while
 *      delivery is off, and records its cost; the scheduled drain is bounded at 25, idempotent, never double-delivers
 *      when two overlap, and reports its cost; the deliveries list shows the outbox state.
 *   6. Takedown and re-pin: a stale digest and a stale head are refused and recorded; with no authority a takedown is
 *      refused and recorded; with it, the site record is retracted by the next drain; a re-pin cuts a new manifest.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_admin_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import {
  AUTH, CTX, SCOPE, T0, attestAll, clock, decision, newLine, piece, revise, type Piece, type W,
} from './_work_graph_release_world_5585.ts';
import releases from '../src/routes/admin_work_graph_releases.ts';
import { cutManifest, decideRelease, publishRelease } from '../src/services/workGraphReleases.ts';
import { enqueueEffect } from '../src/services/workGraphEffects.ts';
import {
  RELEASE_ADMIN_DEPS, RELEASE_DRAIN_LIMITS, drainSummaryLine, scheduledReleaseDrain,
} from '../src/services/workGraphReleaseAdmin.ts';
import { siteRecordKey } from '../src/services/workGraphReleaseDistribution.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, ADMIN = 2, MEMBER = 3, LAZY = 4; // LAZY: a Super Admin whose session has no step-up
const BASE = '/api/admin/work-graph/releases';
const SITE = 'campaign-site';
const DEST = 'ir_list:acme-investors';
const Q = 'tenant_id=7&company_id=70';
const QX = 'tenant_id=8&company_id=80';
const IN = { tenant_id: 7, company_id: 70 };
const OUT = { tenant_id: 8, company_id: 80 };

const defaultAuthorities = RELEASE_ADMIN_DEPS.authorities;
/** The test's resolver: part 2's people, and the Super Admin as a security officer (only where a test says so). */
function grant(superAuthorities: string[] = []) {
  RELEASE_ADMIN_DEPS.authorities = async () => new Map<number, readonly string[]>([...AUTH, [SUPER, superAuthorities]]);
}

function fresh(): W {
  clock.t = T0;
  RELEASE_ADMIN_DEPS.authorities = defaultAuthorities;
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Super', 'super@axal.example');
  u.run(ADMIN, 'admin', 'Admin', 'admin@axal.example');
  u.run(MEMBER, 'founder', 'Member', 'member@example.test');
  u.run(LAZY, 'admin', 'Lazy', 'lazy@axal.example');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${LAZY})`);
  // TOTP sessions stepped up now (SQLite's clock, as requireStepUp reads it), and one magic-link session with none.
  const s = db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))");
  for (const id of [SUPER, ADMIN, MEMBER]) s.run(`s-${id}`, id);
  db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'magic_link', datetime('now'), NULL)").run(`s-${LAZY}`, LAZY);
  return { env: { DB: d1Over(db) } as any, db } as W;
}

class FakeBucket {
  objects = new Map<string, { body: string; customMetadata: Record<string, string> }>();
  requests: { fn: string; key: string }[] = [];
  async head(key: string) { this.requests.push({ fn: 'head', key }); const o = this.objects.get(key); return o ? { key, customMetadata: { ...o.customMetadata } } : null; }
  async put(key: string, body: string, opts: any) { this.requests.push({ fn: 'put', key }); this.objects.set(key, { body, customMetadata: { ...opts.customMetadata } }); return { key }; }
  async delete(key: string) { this.requests.push({ fn: 'delete', key }); this.objects.delete(key); }
  count(fn: string) { return this.requests.filter((r) => r.fn === fn).length; }
}

/** A D1 that fails the test on any use. */
function untouchable() {
  const touched: string[] = [];
  const DB = new Proxy({}, { get(_t, k) { touched.push(String(k)); throw new Error(`D1 touched: ${String(k)}`); } });
  return { DB, touched };
}

const app = new Hono<any>();
app.route(BASE, releases);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));

const token = (who: number) => new SignJWT({ user_id: who, role: who === MEMBER ? 'founder' : 'admin', jti: `s-${who}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));

function envOf(w: W | null, over: Record<string, unknown> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: w?.env.DB, WORK_GRAPH_RELEASE_ADMIN: 'on', WORK_GRAPH_RELEASE_DELIVERY: 'preview', ...over } as any;
}
async function call(env: any, method: string, path: string, opts: { who?: number | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const who = opts.who === undefined ? SUPER : opts.who;
  if (who !== null) headers.Authorization = `Bearer ${await token(who)}`;
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const res = await app.request(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; console.error = e; console.info = i; }
}

const n = (w: W, sql: string, ...b: any[]) => Number((w.db.prepare(sql).get(...b) as any).n);
const auditRows = (w: W, action: string) => (w.db.prepare('SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = ? ORDER BY id').all(action) as any[])
  .map((r) => ({ admin: r.admin_user_id, ...JSON.parse(r.filters_json) }));
const later = (ms: number) => { clock.t += ms; };

/** A public line with two published-ready manifests' worth of pieces: website (code) and copy (marketing). */
async function publicLine(w: W) {
  const website = await piece(w, 'pub-website', 'code', 'public');
  const copy = await piece(w, 'pub-copy', 'document', 'public');
  await attestAll(w, website, ['code']);
  await attestAll(w, copy, ['marketing']);
  const line = await newLine(w, 'line-public', 'public');
  return { website, copy, line };
}
async function cutPublic(w: W, line: string, website: Piece, copy: Piece, key: string) {
  const m = await cutManifest(w.env, CTX, {
    lineAssetUid: line, partial: false, author: { kind: 'person', userId: 11 }, idempotencyKey: key,
    components: [
      { assetUid: website.asset, revisionUid: website.rev, digest: website.digest, role: 'website', profile: 'code' },
      { assetUid: copy.asset, revisionUid: copy.rev, digest: copy.digest, role: 'copy', profile: 'marketing' },
    ],
  });
  assert.ok(m.ok, JSON.stringify(m));
  for (const prof of ['code', 'marketing'] as const) {
    const d = await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, prof, `${key}-${prof}`, {}, 'public'));
    assert.ok(d.ok, JSON.stringify(d));
  }
  return m;
}
const EFFECTS = [{ target: 'website_cdn', ref: SITE }, { target: 'external_distribution', ref: DEST }];
const publishBody = (m: { digest: string }, expected: string | null, key: string, over: Record<string, unknown> = {}) =>
  ({ ...IN, digest: m.digest, expected_manifest_uid: expected, effects: EFFECTS, idempotency_key: key, ...over });

// -------------------------------------------------------------------------------------------------------------------

test('1. flag off: every route refuses before any D1 read, and the scheduled drain reads nothing', async () => {
  const routes: [string, string, unknown?][] = [
    ['GET', `/lines?${Q}`], ['GET', `/deliveries?${Q}`], ['GET', `/lines/x?${Q}`], ['GET', `/manifests/x?${Q}`],
    ['POST', '/manifests/x/publish', {}], ['POST', '/manifests/x/takedown', {}], ['POST', '/lines/x/repin', {}], ['POST', '/drain', {}],
  ];
  for (const flag of [undefined, '', 'true', 'ON', 'preview', 'off']) {
    for (const who of [SUPER, null]) {
      for (const [method, path, body] of routes) {
        const { DB, touched } = untouchable();
        const r = await call(envOf(null, { DB, WORK_GRAPH_RELEASE_ADMIN: flag }), method, path, { who, body });
        assert.deepEqual([r.status, r.body?.error], [404, 'release_admin_off'], `${flag} ${method} ${path}`);
        assert.equal(typeof r.body.message, 'string');
        assert.deepEqual(touched, [], `${method} ${path} touched D1`);
      }
    }
  }
  for (const flag of [undefined, '', 'on', 'true', 'PREVIEW']) {
    const { DB, touched } = untouchable();
    assert.equal(await scheduledReleaseDrain({ DB, WORK_GRAPH_RELEASE_DELIVERY: flag } as any), null);
    assert.deepEqual(touched, []);
  }
  // The hook sits in scheduled(), on its own minute, behind a dynamic import (HUBS.md: cron is loaded that way).
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = src.indexOf('async scheduled(');
  const block = src.indexOf('if (now.getUTCMinutes() % 5 === 2) {', start);
  const hook = src.indexOf("await import('./services/workGraphReleaseAdmin')", start);
  const end = src.indexOf('D685 §5.6', start);
  assert.ok(start > 0 && block > start && hook > block && end > hook, 'the drain runs inside the % 5 === 2 block of scheduled()');
  assert.match(src.slice(hook, end), /scheduledReleaseDrain\(env\)[\s\S]*taskFailed\('work graph release drain'/);
  assert.doesNotMatch(src, /^import .*workGraphReleaseAdmin/m, 'no static import in the frozen hub');
});

test('2. gates: only a Super Admin reads; writes and the drain need the write bar', async () => {
  const w = fresh();
  const env = envOf(w, { FILES: new FakeBucket() });
  const reads = [`/lines?${Q}`, `/deliveries?${Q}`, `/lines/x?${Q}`, `/manifests/x?${Q}`];
  const writes: [string, unknown][] = [['/manifests/x/publish', {}], ['/manifests/x/takedown', {}], ['/lines/x/repin', {}], ['/drain', {}]];
  for (const who of [ADMIN, MEMBER]) {
    for (const p of reads) assert.equal((await call(env, 'GET', p, { who })).status, 403, `${who} GET ${p}`);
    for (const [p, b] of writes) assert.equal((await call(env, 'POST', p, { who, body: b })).status, 403, `${who} POST ${p}`);
  }
  for (const p of reads) assert.equal((await call(env, 'GET', p, { who: null })).status, 401, `anonymous GET ${p}`);
  // A Super Admin without a TOTP session and a recent step-up reads, and is refused every write.
  assert.equal((await call(env, 'GET', `/lines?${Q}`, { who: LAZY })).status, 200);
  for (const [p, b] of writes) assert.equal((await call(env, 'POST', p, { who: LAZY, body: b })).status, 403, `LAZY POST ${p}`);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 0);
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action LIKE 'work_graph_release_%'"), 0, 'a refused gate writes no act');
  // A scope is required, and must be two positive integers.
  for (const q of ['', 'tenant_id=7', 'tenant_id=0&company_id=70', 'tenant_id=a&company_id=70', 'tenant_id=7&company_id=-1']) {
    assert.deepEqual([(await call(env, 'GET', `/lines?${q}`)).status, (await call(env, 'GET', `/lines?${q}`)).body.error], [400, 'malformed'], q);
  }
});

test('3. cross-tenant: another scope is refused on every read and write, writes nothing, and its lists are empty', async () => {
  const w = fresh();
  grant(['security_officer']);
  const bucket = new FakeBucket();
  const env = envOf(w, { FILES: bucket });
  const { website, copy, line } = await publicLine(w);
  const m = await cutPublic(w, line, website, copy, 'pm1');
  const before = n(w, 'SELECT COUNT(*) AS n FROM work_graph_events');

  for (const p of [`/lines/${line}?${QX}`, `/manifests/${m.manifestUid}?${QX}`]) {
    const r = await call(env, 'GET', p);
    assert.deepEqual([r.status, r.body.error], [403, 'wrong_tenant'], p);
    assert.ok(!JSON.stringify(r.body).includes(m.digest), 'nothing of the release leaks');
  }
  const pub = await call(env, 'POST', `/manifests/${m.manifestUid}/publish`, { body: publishBody(m, null, 'x-pub', OUT) });
  assert.deepEqual([pub.status, pub.body.error], [403, 'wrong_tenant']);
  const td = await call(env, 'POST', `/manifests/${m.manifestUid}/takedown`, {
    body: { ...OUT, digest: m.digest, reason_code: 'legal_order', evidence_ref: 'order:1', authority: 'security_officer', idempotency_key: 'x-td' },
  });
  assert.deepEqual([td.status, td.body.error], [403, 'wrong_tenant']);
  const rp = await call(env, 'POST', `/lines/${line}/repin`, { body: { ...OUT, target_manifest_uid: m.manifestUid, expected_manifest_uid: null, idempotency_key: 'x-rp' } });
  assert.deepEqual([rp.status, rp.body.error], [403, 'wrong_tenant']);

  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_events'), before, 'no pointer event');
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 0, 'nothing queued');
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 1, 'no re-pin cut');
  // The takedown attempt is recorded against the line's own tenant, refused, with the Super Admin as actor.
  assert.deepEqual({ ...(w.db.prepare('SELECT tenant_id, company_id, outcome, refusal_code, actor_user_id FROM work_graph_release_takedowns').get() as any) },
    { tenant_id: 7, company_id: 70, outcome: 'refused', refusal_code: 'wrong_tenant', actor_user_id: SUPER });
  assert.deepEqual(auditRows(w, 'work_graph_release_publish').map((a) => [a.admin, a.outcome, a.tenant_id]), [[SUPER, 'wrong_tenant', 8]]);
  assert.deepEqual(auditRows(w, 'work_graph_release_takedown').map((a) => [a.admin, a.outcome]), [[SUPER, 'wrong_tenant']]);
  assert.deepEqual(auditRows(w, 'work_graph_release_repin').map((a) => [a.admin, a.outcome]), [[SUPER, 'wrong_tenant']]);

  // Published in its own scope, the other scope's lists still show nothing of it.
  assert.equal((await call(env, 'POST', `/manifests/${m.manifestUid}/publish`, { body: publishBody(m, null, 'pub-1') })).status, 200);
  assert.deepEqual((await call(env, 'GET', `/lines?${QX}`)).body.lines, []);
  assert.deepEqual((await call(env, 'GET', `/deliveries?${QX}`)).body.deliveries, []);
  assert.equal((await call(env, 'GET', `/lines?${Q}`)).body.lines.length, 1);
  assert.equal((await call(env, 'GET', `/deliveries?${Q}`)).body.deliveries.length, 2);
});

test('4. publish: stale digest and stale pointer are refused; no authority by default; then once, replayed, audited', async () => {
  const w = fresh();
  const env = envOf(w, { FILES: new FakeBucket() });
  const { website, copy, line } = await publicLine(w);
  const m = await cutPublic(w, line, website, copy, 'pm1');
  const path = `/manifests/${m.manifestUid}/publish`;

  // The digest the Super Admin reviewed must be the manifest's.
  const stale = await call(env, 'POST', path, { body: publishBody(m, null, 'p-stale', { digest: 'a'.repeat(64) }) });
  assert.deepEqual([stale.status, stale.body.error], [409, 'stale_approval']);
  // Malformed bodies are refused before any read.
  for (const over of [{ digest: 'nope' }, { effects: 'x' }, { idempotency_key: 5 }, { expected_manifest_uid: 3 }]) {
    assert.deepEqual([(await call(env, 'POST', path, { body: publishBody(m, null, 'p-bad', over) })).status], [400], JSON.stringify(over));
  }
  // A Super Admin holds no release authority: on main no approval counts, and publication is refused (and recorded).
  const noAuth = await call(env, 'POST', path, { body: publishBody(m, null, 'p-noauth') });
  assert.deepEqual([noAuth.status, noAuth.body.error], [409, 'approval_required']);
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM work_graph_events WHERE action = 'advance_refused' AND refusal_code = 'approval_required' AND actor_user_id = ?", SUPER), 1);

  grant();
  const ok = await call(env, 'POST', path, { body: publishBody(m, null, 'p-1') });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.ok, ok.body.manifestUid, ok.body.previousManifestUid, ok.body.replayed, ok.body.effectIds.length], [true, m.manifestUid, null, false, 2]);
  assert.ok(ok.body.cost.d1Statements > 0 && ok.body.cost.d1Batches >= 1, 'cost telemetry');
  const replay = await call(env, 'POST', path, { body: publishBody(m, null, 'p-1') });
  assert.deepEqual([replay.status, replay.body.replayed, replay.body.effectIds], [200, true, ok.body.effectIds]);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_effects'), 2, 'the replay queued nothing');

  // A second manifest, published against a pointer the caller did not see: the CAS refuses it.
  const website2 = await revise(w, website, 'pub-website-v2');
  await attestAll(w, website2, ['code']);
  const m2 = await cutPublic(w, line, website2, copy, 'pm2');
  const behind = await call(env, 'POST', `/manifests/${m2.manifestUid}/publish`, { body: publishBody(m2, null, 'p-2-stale') });
  assert.deepEqual([behind.status, behind.body.error], [409, 'stale_revision']);
  const ahead = await call(env, 'POST', `/manifests/${m2.manifestUid}/publish`, { body: publishBody(m2, m.manifestUid, 'p-2') });
  assert.deepEqual([ahead.status, ahead.body.previousManifestUid], [200, m.manifestUid]);

  // Every attempt is an admin audit row, by the Super Admin, with its outcome.
  assert.deepEqual(auditRows(w, 'work_graph_release_publish').map((a) => [a.admin, a.outcome]), [
    [SUPER, 'stale_approval'], [SUPER, 'approval_required'], [SUPER, 'published'], [SUPER, 'published'], [SUPER, 'stale_revision'], [SUPER, 'published'],
  ]);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM activity_logs WHERE action = ? AND user_id = ?', 'work_graph_release_publish', SUPER), 6);

  // The reads: the line's pointer, the evaluation, and the manifests cut on it.
  const lineRead = await call(env, 'GET', `/lines/${line}?${Q}`);
  assert.equal(lineRead.status, 200);
  assert.deepEqual([lineRead.body.published.manifestUid, lineRead.body.served.manifestUid, lineRead.body.manifests.length], [m2.manifestUid, m2.manifestUid, 2]);
  assert.ok(lineRead.body.cost.d1Statements > 0);
  const status = await call(env, 'GET', `/manifests/${m.manifestUid}?${Q}`);
  assert.deepEqual([status.status, status.body.release.published, status.body.release.status], [200, false, 'rebuild_required']);
  assert.equal((await call(env, 'GET', `/manifests/nope?${Q}`)).status, 404);
});

test('5. drain: manual and scheduled drains are bounded, deliver each effect once, and report their cost', async () => {
  const w = fresh();
  grant();
  const bucket = new FakeBucket();
  const env = envOf(w, { FILES: bucket });
  const { website, copy, line } = await publicLine(w);
  const m = await cutPublic(w, line, website, copy, 'pm1');
  const ids = (await call(env, 'POST', `/manifests/${m.manifestUid}/publish`, { body: publishBody(m, null, 'p-1') })).body.effectIds;

  // Off: the manual drain refuses and drains nothing.
  const off = await call(envOf(w, { FILES: bucket, WORK_GRAPH_RELEASE_DELIVERY: undefined }), 'POST', '/drain', { body: {} });
  assert.deepEqual([off.status, off.body.error], [409, 'release_delivery_off']);
  assert.equal(bucket.requests.length, 0);
  assert.deepEqual((await call(env, 'POST', '/drain', { body: { limit: 0 } })).status, 400);

  // One effect at a time when asked; the site record is written once; the external target has no channel.
  const one = await call(env, 'POST', '/drain', { body: { limit: 1 } });
  assert.deepEqual([one.status, one.body.limit, one.body.deliveries, one.body.results.map((x: any) => [x.effectId, x.status])], [200, 1, 1, [[ids[0], 'applied']]]);
  assert.deepEqual([one.body.providerRequests, one.body.providerRequestsByTarget.website_cdn], [2, 2], 'head + put');
  assert.ok(one.body.cost.d1Statements > 0);
  const rest = await call(env, 'POST', '/drain', { body: { limit: 1000 } });
  assert.deepEqual([rest.body.limit, rest.body.results.map((x: any) => [x.effectId, x.status])], [RELEASE_DRAIN_LIMITS.manualMax, [[ids[1], 'retry']]]);
  assert.equal(rest.body.providerRequests, 0, 'no channel: refused before any request');
  // Idempotent: nothing is due, nothing is sent again.
  const again = await call(env, 'POST', '/drain', { body: {} });
  assert.deepEqual([again.body.deliveries, again.body.providerRequests], [0, 0]);
  later(31_000);
  const retried = await scheduledReleaseDrain(env);
  assert.deepEqual([retried!.deliveries, retried!.byStatus], [1, { retry: 1 }]);
  assert.equal(bucket.count('put'), 1);
  assert.ok(bucket.objects.has(siteRecordKey({ tenantId: 7, companyId: 70, ref: SITE, manifestUid: m.manifestUid })));
  assert.match(drainSummaryLine(retried!), /^work graph release drain deliveries=1 retry=1 d1=\d+ provider=0$/);

  // The outbox as the Super Admin reads it.
  const list = await call(env, 'GET', `/deliveries?${Q}&manifest=${m.manifestUid}`);
  const byTarget = Object.fromEntries(list.body.deliveries.map((d: any) => [d.target, d]));
  assert.deepEqual([byTarget.website_cdn.state, byTarget.website_cdn.delivery.outcome, byTarget.website_cdn.delivery.providerCalls], ['applied', 'confirmed', 2]);
  assert.deepEqual([byTarget.external_distribution.state, byTarget.external_distribution.lastErrorCode, byTarget.external_distribution.attempts, byTarget.external_distribution.delivery],
    ['pending', 'target_not_configured', 2, null]);
  assert.deepEqual((await call(env, 'GET', `/deliveries?${Q}&state=applied`)).body.deliveries.map((d: any) => d.effectId), [ids[0]]);
  assert.equal((await call(env, 'GET', `/deliveries?${Q}&state=bogus`)).status, 400);
  assert.ok(list.body.cost.d1Statements >= 1);

  // The manual drains are audit rows with their cost.
  const drains = auditRows(w, 'work_graph_release_drain');
  assert.deepEqual(drains.map((d) => [d.admin, d.outcome, d.limit, d.deliveries]), [
    [SUPER, 'release_delivery_off', 25, undefined], [SUPER, 'drained', 1, 1], [SUPER, 'drained', 25, 1], [SUPER, 'drained', 25, 0],
  ]);
  assert.ok(drains[1].cost.d1Statements > 0 && drains[1].providerRequests === 2);
});

test('5b. the scheduled drain takes at most 25 effects, and two overlapping drains never deliver one twice', async () => {
  const w = fresh();
  grant();
  const bucket = new FakeBucket();
  const env = envOf(w, { FILES: bucket });
  // 30 due release effects of a kind the drain handles (their payload names no release, so each is retried).
  for (let i = 0; i < 30; i++) {
    const r = await enqueueEffect(w.env, CTX, { scope: SCOPE, kind: 'release_stream', idempotencyKey: `bulk-${i}`, payload: { n: i }, actor: { kind: 'person', userId: 11 } });
    assert.ok(r.ok);
  }
  const first = await scheduledReleaseDrain(env);
  assert.equal(first!.deliveries, RELEASE_DRAIN_LIMITS.scheduled);
  assert.equal(Object.values(first!.byStatus).reduce((a, b) => a + (b ?? 0), 0), 25, 'every delivery counted by its status');
  assert.ok(first!.cost.d1Statements > 0);
  const second = await scheduledReleaseDrain(env);
  assert.equal(second!.deliveries, 5, 'the five left over; the rest wait on their backoff');

  // Two drains at once over one published release: each effect is claimed by one of them only.
  const { website, copy, line } = await publicLine(w);
  const m = await cutPublic(w, line, website, copy, 'pm1');
  await publishRelease(w.env, { ...CTX, authorities: new Map(AUTH) }, {
    lineAssetUid: line, manifestUid: m.manifestUid, expectedManifestUid: null, effects: [{ target: 'website_cdn', ref: SITE }],
    actor: { kind: 'person', userId: 11 }, idempotencyKey: 'pub',
  });
  const [a, b] = await Promise.all([scheduledReleaseDrain(env), scheduledReleaseDrain(env)]);
  assert.equal((a!.byStatus.applied ?? 0) + (b!.byStatus.applied ?? 0), 1, 'applied once');
  assert.equal(bucket.count('put'), 1, 'written once');
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM work_graph_release_deliveries WHERE target = 'website_cdn'"), 1);
});

test('6. takedown and re-pin: stale views and missing authority are refused and recorded; then each works once', async () => {
  const w = fresh();
  grant();
  const bucket = new FakeBucket();
  const env = envOf(w, { FILES: bucket });
  const { website, copy, line } = await publicLine(w);
  const m1 = await cutPublic(w, line, website, copy, 'pm1');
  await call(env, 'POST', `/manifests/${m1.manifestUid}/publish`, { body: publishBody(m1, null, 'p-1') });
  const website2 = await revise(w, website, 'pub-website-v2');
  await attestAll(w, website2, ['code']);
  const m2 = await cutPublic(w, line, website2, copy, 'pm2');
  await call(env, 'POST', `/manifests/${m2.manifestUid}/publish`, { body: publishBody(m2, m1.manifestUid, 'p-2', { effects: [{ target: 'website_cdn', ref: SITE }] }) });
  await call(env, 'POST', '/drain', { body: {} });
  const key2 = siteRecordKey({ tenantId: 7, companyId: 70, ref: SITE, manifestUid: m2.manifestUid });
  assert.ok(bucket.objects.has(key2));

  // Re-pin: the head the Super Admin saw must be the head.
  const staleRepin = await call(env, 'POST', `/lines/${line}/repin`, { body: { ...IN, target_manifest_uid: m1.manifestUid, expected_manifest_uid: m1.manifestUid, idempotency_key: 'rp' } });
  assert.deepEqual([staleRepin.status, staleRepin.body.error, staleRepin.body.current_head], [409, 'stale_revision', { revisionUid: m2.manifestUid, headSeq: 2 }]);
  const repin = await call(env, 'POST', `/lines/${line}/repin`, { body: { ...IN, target_manifest_uid: m1.manifestUid, expected_manifest_uid: m2.manifestUid, idempotency_key: 'rp' } });
  assert.equal(repin.status, 200, JSON.stringify(repin.body));
  assert.deepEqual([repin.body.repinOf, repin.body.baseManifestUid], [m1.manifestUid, m2.manifestUid]);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_manifests WHERE actor_user_id = ?', SUPER), 1, 'the re-pin is the Super Admin\'s manifest');

  // Takedown: a stale digest is refused and recorded; without the authority it is refused and recorded.
  const td = (over: Record<string, unknown>) => call(env, 'POST', `/manifests/${m2.manifestUid}/takedown`, {
    body: { ...IN, digest: m2.digest, reason_code: 'legal_order', evidence_ref: 'order:77', authority: 'security_officer', idempotency_key: 'td', ...over },
  });
  assert.deepEqual([(await td({ digest: m1.digest })).body.error, (await td({ digest: m1.digest })).status], ['stale_approval', 409]);
  const noAuth = await td({});
  assert.deepEqual([noAuth.status, noAuth.body.error], [409, 'no_authority']);
  assert.deepEqual((w.db.prepare('SELECT outcome, refusal_code, actor_user_id FROM work_graph_release_takedowns ORDER BY id').all() as any[]).map((r) => [r.outcome, r.refusal_code, r.actor_user_id]),
    [['refused', 'stale_approval', SUPER], ['refused', 'stale_approval', SUPER], ['refused', 'no_authority', SUPER]]);
  assert.ok(bucket.objects.has(key2), 'nothing retracted');

  grant(['security_officer']);
  const down = await td({});
  assert.equal(down.status, 200, JSON.stringify(down.body));
  assert.deepEqual([down.body.changed, down.body.retractEffectIds.length], [true, 1]);
  await call(env, 'POST', '/drain', { body: {} });
  assert.ok(!bucket.objects.has(key2), 'the site record is retracted');
  const lineRead = await call(env, 'GET', `/lines/${line}?${Q}`);
  assert.deepEqual([lineRead.body.served, lineRead.body.withheld.manifestUid], [null, m2.manifestUid], 'served nothing, kept as evidence');
  assert.deepEqual(auditRows(w, 'work_graph_release_takedown').map((a) => [a.admin, a.outcome]),
    [[SUPER, 'stale_approval'], [SUPER, 'stale_approval'], [SUPER, 'no_authority'], [SUPER, 'taken_down']]);
  assert.deepEqual(auditRows(w, 'work_graph_release_repin').map((a) => [a.admin, a.outcome]), [[SUPER, 'stale_revision'], [SUPER, 'repinned']]);
});
