/**
 * D5585 part 8 (#5585, WorkGraph P1) — the per-company release-authority store and the routes that write and read it,
 * and the part 7 publish and takedown routes resolving from it. The real router over the full migrated schema, with
 * part 2's synthetic campaign world and the real adapters (a fake `FILES` bucket; no channel). No test reaches a provider.
 *
 *   1. Vocabulary: the store's names are exactly the release services' authorities, in the service and in the
 *      migration's CHECK; an unknown name is refused by the route, the service and D1.
 *   2. Flag off: the three authority routes refuse 404 `release_admin_off` before any D1 read; the gates hold.
 *   3. Grant and revoke: a non-member is refused; a stale `expected_seq`, a second grant, a revocation of nothing and a
 *      reused key are refused; a replay answers the first result; a revocation takes effect at once; unlinking the
 *      person withdraws the grant; every attempt is an admin audit row and every change one append-only event row.
 *   4. Scope: a grant counts in its own tenant and company only; a write naming another tenant for the company is
 *      `wrong_tenant`; the other scope's lists are empty.
 *   5. Publish through the route: refused `approval_required` until both reviewers hold their profile's authority in
 *      the store, then published; after a reviewer's revocation the next manifest is refused again.
 *   6. Takedown through the route: the Super Admin must be linked to hold an authority; without one, or after its
 *      revocation, `no_authority`; with `security_officer` granted the takedown is applied.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_authorities_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { CTX, T0, attestAll, clock, decision, newLine, piece, revise, type Piece, type W } from './_work_graph_release_world_5585.ts';
import releases from '../src/routes/admin_work_graph_releases.ts';
import { cutManifest, decideRelease } from '../src/services/workGraphReleases.ts';
import {
  RELEASE_AUTHORITIES, grantReleaseAuthority, releaseAuthoritiesForScope, resolveReleaseAuthorities,
} from '../src/services/workGraphReleaseAuthorities.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, ADMIN = 2, MEMBER = 3, LAZY = 4;
const BOB = 12, CAROL = 13, OUTSIDER = 17; // part 2's maintainer and brand owner; a person linked to no company
const BASE = '/api/admin/work-graph/releases';
const Q = 'tenant_id=7&company_id=70';
const IN = { tenant_id: 7, company_id: 70 };

function fresh(): W {
  clock.t = T0;
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Super', 'super@axal.example');
  u.run(ADMIN, 'admin', 'Admin', 'admin@axal.example');
  u.run(MEMBER, 'founder', 'Member', 'member@example.test');
  u.run(LAZY, 'admin', 'Lazy', 'lazy@axal.example');
  for (const id of [BOB, CAROL, OUTSIDER]) u.run(id, 'founder', `P${id}`, `p${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${LAZY})`);
  const s = db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))");
  for (const id of [SUPER, ADMIN, MEMBER]) s.run(`s-${id}`, id);
  db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'magic_link', datetime('now'), NULL)").run(`s-${LAZY}`, LAZY);
  // BOB and CAROL work at company 70; CAROL also at company 71.
  link({ db } as W, 70, BOB); link({ db } as W, 70, CAROL); link({ db } as W, 71, CAROL);
  return { env: { DB: d1Over(db) } as any, db } as W;
}
function link(w: W, company: number, user: number) {
  w.db.prepare('INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?, ?, ?)').run(`l-${company}-${user}`, company, user);
}

class FakeBucket {
  objects = new Map<string, { body: string; customMetadata: Record<string, string> }>();
  async head(key: string) { const o = this.objects.get(key); return o ? { key, customMetadata: { ...o.customMetadata } } : null; }
  async put(key: string, body: string, opts: any) { this.objects.set(key, { body, customMetadata: { ...opts.customMetadata } }); return { key }; }
  async delete(key: string) { this.objects.delete(key); }
}

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

/** A grant or revocation body in scope 7/70. */
const ch = (user: number, authority: string, seq: number, key: string, over: Record<string, unknown> = {}) =>
  ({ ...IN, user_id: user, authority, reason: 'Named in the board minute of 2026-11-21.', expected_seq: seq, idempotency_key: key, ...over });
const grant = (env: any, user: number, authority: string, seq: number, key: string, over: Record<string, unknown> = {}) =>
  call(env, 'POST', '/authorities/grant', { body: ch(user, authority, seq, key, over) });
const revoke = (env: any, user: number, authority: string, seq: number, key: string, over: Record<string, unknown> = {}) =>
  call(env, 'POST', '/authorities/revoke', { body: ch(user, authority, seq, key, over) });
const held = (w: W, user: number, tenantId = 7, companyId = 70) => resolveReleaseAuthorities(w.env, { tenantId, companyId, userId: user });

async function publicLine(w: W) {
  const website = await piece(w, 'pub-website', 'code', 'public');
  const copy = await piece(w, 'pub-copy', 'document', 'public');
  await attestAll(w, website, ['code']);
  await attestAll(w, copy, ['marketing']);
  return { website, copy, line: await newLine(w, 'line-public', 'public') };
}
/** A manifest of the line, with BOB's code approval and CAROL's marketing approval recorded (decision time uses part 2's people). */
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
    assert.ok((await decideRelease(w.env, CTX, decision(m.manifestUid, m.digest, prof, `${key}-${prof}`, {}, 'public'))).ok);
  }
  return m;
}
const publishBody = (m: { digest: string }, expected: string | null, key: string) =>
  ({ ...IN, digest: m.digest, expected_manifest_uid: expected, effects: [{ target: 'website_cdn', ref: 'campaign-site' }], idempotency_key: key });

// -------------------------------------------------------------------------------------------------------------------

test('1. vocabulary: the release services\' authorities, in the service and the migration; anything else is refused', async () => {
  assert.deepEqual([...RELEASE_AUTHORITIES], [
    'authorized_signatory', 'brand_owner', 'counsel', 'founder', 'maintainer', 'marketing_lead', 'partner', 'security_officer',
  ]);
  const sql = readFileSync(new URL('../sql/migrations/202611212328_5585_work_graph_release_authorities.sql', import.meta.url), 'utf8');
  const check = /authority TEXT NOT NULL CHECK \(authority IN \(([^)]*)\)\)/.exec(sql);
  assert.ok(check, 'the CHECK lists the names');
  assert.deepEqual(check![1].split(',').map((x) => x.trim().replace(/'/g, '')).sort(), [...RELEASE_AUTHORITIES]);

  const w = fresh();
  const env = envOf(w);
  for (const bad of ['owner', 'super_admin', 'Counsel', 'VOTE', 'admin']) {
    const r = await grant(env, BOB, bad, 0, `k-${bad}`);
    assert.deepEqual([r.status, r.body.error], [400, 'unknown_authority'], bad);
    assert.equal(typeof r.body.message, 'string');
  }
  const svc = await grantReleaseAuthority(w.env, {
    scope: { tenantId: 7, companyId: 70 }, userId: BOB, authority: 'owner', reason: 'x', expectedSeq: 0, actorUserId: SUPER, idempotencyKey: 'svc',
  });
  assert.deepEqual([svc.ok, !svc.ok && svc.code], [false, 'unknown_authority']);
  // D1 refuses one too, however it is written.
  assert.throws(() => w.db.prepare(`INSERT INTO work_graph_release_authority_events
    (tenant_id, company_id, user_id, authority, seq, op, reason, actor_user_id, idempotency_key, request_hash, created_at)
    VALUES (7, 70, 12, 'owner', 1, 'grant', 'x', 1, 'raw', ?, 'now')`).run('a'.repeat(64)), /CHECK/);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_authority_events'), 0);
  assert.deepEqual(auditRows(w, 'work_graph_release_authority_grant').map((a) => a.outcome), Array(5).fill('unknown_authority'));
});

test('2. flag off: the authority routes refuse before any D1 read; only a Super Admin reads, writes need the write bar', async () => {
  const routes: [string, string, unknown?][] = [['GET', `/authorities?${Q}`], ['POST', '/authorities/grant', {}], ['POST', '/authorities/revoke', {}]];
  for (const flag of [undefined, '', 'true', 'ON', 'off']) {
    for (const who of [SUPER, null]) {
      for (const [method, path, body] of routes) {
        const { DB, touched } = untouchable();
        const r = await call(envOf(null, { DB, WORK_GRAPH_RELEASE_ADMIN: flag }), method, path, { who, body });
        assert.deepEqual([r.status, r.body?.error], [404, 'release_admin_off'], `${flag} ${method} ${path}`);
        assert.deepEqual(touched, [], `${method} ${path} touched D1`);
      }
    }
  }
  const w = fresh();
  const env = envOf(w);
  for (const who of [ADMIN, MEMBER]) {
    assert.equal((await call(env, 'GET', `/authorities?${Q}`, { who })).status, 403);
    assert.equal((await call(env, 'POST', '/authorities/grant', { who, body: ch(BOB, 'maintainer', 0, 'g') })).status, 403);
    assert.equal((await call(env, 'POST', '/authorities/revoke', { who, body: ch(BOB, 'maintainer', 0, 'g') })).status, 403);
  }
  assert.equal((await call(env, 'GET', `/authorities?${Q}`, { who: null })).status, 401);
  assert.equal((await call(env, 'GET', `/authorities?${Q}`, { who: LAZY })).status, 200);
  assert.equal((await call(env, 'POST', '/authorities/grant', { who: LAZY, body: ch(BOB, 'maintainer', 0, 'g') })).status, 403);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_authority_events'), 0);
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action LIKE 'work_graph_release_authority_%'"), 0, 'a refused gate writes no act');
  assert.deepEqual([(await call(env, 'GET', '/authorities?tenant_id=7')).status, (await call(env, 'GET', `/authorities?${Q}&user_id=x`)).status], [400, 400]);
});

test('3. grant and revoke: membership, stale views, replays and conflicts; a revocation takes effect at once', async () => {
  const w = fresh();
  const env = envOf(w);

  // A person not linked to the company cannot be granted anything there.
  const outsider = await grant(env, OUTSIDER, 'counsel', 0, 'g-out');
  assert.deepEqual([outsider.status, outsider.body.error], [409, 'not_member']);
  // Malformed: no reason, a negative seq, a missing key.
  for (const over of [{ reason: '' }, { reason: 'x'.repeat(501) }, { expected_seq: -1 }, { expected_seq: '0' }, { idempotency_key: 5 }, { user_id: 0 }]) {
    const r = await grant(env, BOB, 'maintainer', 0, 'g-bad', over);
    assert.deepEqual([r.status, r.body.error], [400, 'malformed'], JSON.stringify(over));
  }

  const g = await grant(env, BOB, 'maintainer', 0, 'g-1');
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.deepEqual([g.body.ok, g.body.op, g.body.seq, g.body.held, g.body.replayed], [true, 'grant', 1, true, false]);
  assert.ok(g.body.cost.d1Statements > 0, 'cost telemetry');
  assert.deepEqual(await held(w, BOB), ['maintainer']);

  const replay = await grant(env, BOB, 'maintainer', 0, 'g-1');
  assert.deepEqual([replay.status, replay.body.replayed, replay.body.eventId], [200, true, g.body.eventId]);
  const conflict = await grant(env, BOB, 'maintainer', 0, 'g-1', { reason: 'Another sentence.' });
  assert.deepEqual([conflict.status, conflict.body.error], [409, 'idempotency_conflict']);
  // A view from before the grant is stale; a grant of what is held is refused.
  const stale = await grant(env, BOB, 'maintainer', 0, 'g-2');
  assert.deepEqual([stale.status, stale.body.error, stale.body.current], [409, 'stale_revision', { seq: 1, held: true }]);
  const twice = await grant(env, BOB, 'maintainer', 1, 'g-3');
  assert.deepEqual([twice.status, twice.body.error, twice.body.current], [409, 'already_held', { seq: 1, held: true }]);

  const list = await call(env, 'GET', `/authorities?${Q}`);
  assert.deepEqual(list.body.holders.map((h: any) => [h.userId, h.authority, h.seq, h.grantedByUserId]), [[BOB, 'maintainer', 1, SUPER]]);
  assert.equal(list.body.events, null);
  assert.deepEqual(list.body.authorities, [...RELEASE_AUTHORITIES]);
  assert.ok(list.body.cost.d1Statements >= 1);

  // Revoke: stale first, then at once — the next resolution holds nothing.
  assert.deepEqual((await revoke(env, BOB, 'maintainer', 0, 'r-0')).body.error, 'stale_revision');
  const r = await revoke(env, BOB, 'maintainer', 1, 'r-1');
  assert.deepEqual([r.status, r.body.op, r.body.seq, r.body.held], [200, 'revoke', 2, false]);
  assert.deepEqual(await held(w, BOB), []);
  assert.deepEqual((await releaseAuthoritiesForScope(w.env, { tenantId: 7, companyId: 70 })).get(BOB), undefined);
  const nothing = await revoke(env, BOB, 'maintainer', 2, 'r-2');
  assert.deepEqual([nothing.status, nothing.body.error, nothing.body.current], [409, 'not_held', { seq: 2, held: false }]);
  // Granted again from the view after the revocation.
  assert.equal((await grant(env, BOB, 'maintainer', 2, 'g-4')).body.seq, 3);
  assert.equal((await grant(env, BOB, 'counsel', 0, 'g-5')).status, 200);
  assert.deepEqual(await held(w, BOB), ['counsel', 'maintainer']);

  // Unlinking the person withdraws every grant in that company, with no row in the store.
  w.db.prepare('DELETE FROM user_company_links WHERE company_id = 70 AND user_id = ?').run(BOB);
  assert.deepEqual(await held(w, BOB), []);
  // A departed person's grant can still be revoked.
  assert.equal((await revoke(env, BOB, 'counsel', 1, 'r-3')).status, 200);

  const history = await call(env, 'GET', `/authorities?${Q}&history=1&user_id=${BOB}`);
  assert.deepEqual(history.body.events.map((e: any) => [e.authority, e.seq, e.op, e.actorUserId]),
    [['counsel', 2, 'revoke', SUPER], ['counsel', 1, 'grant', SUPER], ['maintainer', 3, 'grant', SUPER], ['maintainer', 2, 'revoke', SUPER], ['maintainer', 1, 'grant', SUPER]]);
  assert.deepEqual(history.body.holders, [], 'unlinked: nothing held');

  // Every attempt past the gate is an admin audit row with its outcome; every change one event row.
  assert.deepEqual(auditRows(w, 'work_graph_release_authority_grant').map((a) => [a.admin, a.outcome]), [
    [SUPER, 'not_member'], ...Array(6).fill([SUPER, 'malformed']), [SUPER, 'granted'], [SUPER, 'granted'], [SUPER, 'idempotency_conflict'],
    [SUPER, 'stale_revision'], [SUPER, 'already_held'], [SUPER, 'granted'], [SUPER, 'granted'],
  ]);
  assert.deepEqual(auditRows(w, 'work_graph_release_authority_revoke').map((a) => a.outcome), ['stale_revision', 'revoked', 'not_held', 'revoked']);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM activity_logs WHERE action = ? AND user_id = ?', 'work_graph_release_authority_revoke', SUPER), 4);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_authority_events WHERE user_id = ?', BOB), 5);

  // Two Super Admins racing from the same view: one lands, the other is stale and writes nothing.
  const race = await Promise.all([grant(env, CAROL, 'founder', 0, 'race-a'), grant(env, CAROL, 'founder', 0, 'race-b')]);
  assert.deepEqual(race.map((x) => x.status).sort(), [200, 409]);
  assert.deepEqual(race.find((x) => x.status === 409)!.body.current, { seq: 1, held: true });
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM work_graph_release_authority_events WHERE user_id = ? AND authority = 'founder'", CAROL), 1);

  // The store is append-only, and a row must be the next of its key.
  assert.throws(() => w.db.prepare("UPDATE work_graph_release_authority_events SET op = 'grant' WHERE seq = 2").run(), /append-only/);
  assert.throws(() => w.db.prepare('DELETE FROM work_graph_release_authority_events').run(), /append-only/);
  assert.throws(() => w.db.prepare(`INSERT INTO work_graph_release_authority_events
    (tenant_id, company_id, user_id, authority, seq, op, reason, actor_user_id, idempotency_key, request_hash, created_at)
    VALUES (7, 70, 13, 'brand_owner', 3, 'grant', 'x', 1, 'raw', ?, 'now')`).run('a'.repeat(64)), /next of its key/);
  assert.throws(() => w.db.prepare(`INSERT INTO work_graph_release_authority_events
    (tenant_id, company_id, user_id, authority, seq, op, reason, actor_user_id, idempotency_key, request_hash, created_at)
    VALUES (7, 70, 13, 'brand_owner', 1, 'revoke', 'x', 1, 'raw', ?, 'now')`).run('a'.repeat(64)), /CHECK/);
});

test('4. scope: a grant counts in its own tenant and company only, and never crosses tenants', async () => {
  const w = fresh();
  const env = envOf(w);
  // Company 70's release lines live under tenant 7: before any grant, a write naming tenant 8 for it is refused.
  await publicLine(w);
  const byLine = await grant(env, CAROL, 'brand_owner', 0, 'x-0', { tenant_id: 8 });
  assert.deepEqual([byLine.status, byLine.body.error], [403, 'wrong_tenant']);

  assert.equal((await grant(env, CAROL, 'brand_owner', 0, 'g-1')).status, 200);
  assert.deepEqual(await held(w, CAROL), ['brand_owner']);
  assert.deepEqual(await held(w, CAROL, 7, 71), [], 'another company of the same person');
  assert.deepEqual(await held(w, CAROL, 8, 70), [], 'the same company id under another tenant');
  assert.deepEqual(await held(w, CAROL, 0, 70), []);

  const xg = await grant(env, CAROL, 'counsel', 0, 'x-g', { tenant_id: 8 });
  assert.deepEqual([xg.status, xg.body.error], [403, 'wrong_tenant']);
  const xr = await revoke(env, CAROL, 'brand_owner', 1, 'x-r', { tenant_id: 8 });
  assert.deepEqual([xr.status, xr.body.error], [403, 'wrong_tenant']);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_authority_events'), 1);
  const other = await call(env, 'GET', '/authorities?tenant_id=8&company_id=70&history=1');
  assert.deepEqual([other.status, other.body.holders, other.body.events], [200, [], []]);

  // Company 71 has no release lines or grants yet: its first grant names its tenant, and then holds it there.
  assert.equal((await grant(env, CAROL, 'brand_owner', 0, 'g-71', { company_id: 71 })).status, 200);
  assert.deepEqual(await held(w, CAROL, 7, 71), ['brand_owner']);
  assert.deepEqual((await grant(env, CAROL, 'counsel', 0, 'x-71', { tenant_id: 9, company_id: 71 })).body.error, 'wrong_tenant');
  assert.deepEqual(auditRows(w, 'work_graph_release_authority_grant').map((a) => [a.outcome, a.tenant_id, a.company_id]),
    [['wrong_tenant', 8, 70], ['granted', 7, 70], ['wrong_tenant', 8, 70], ['granted', 7, 71], ['wrong_tenant', 9, 71]]);
});

test('5. publish resolves reviewers from the store: refused until both hold their authority, refused again after a revocation', async () => {
  const w = fresh();
  const env = envOf(w, { FILES: new FakeBucket() });
  const { website, copy, line } = await publicLine(w);
  const m = await cutPublic(w, line, website, copy, 'pm1');
  const path = `/manifests/${m.manifestUid}/publish`;

  const none = await call(env, 'POST', path, { body: publishBody(m, null, 'p-0') });
  assert.deepEqual([none.status, none.body.error], [409, 'approval_required'], 'no grant: no approval counts');
  assert.equal((await grant(env, BOB, 'maintainer', 0, 'g-bob')).status, 200);
  const half = await call(env, 'POST', path, { body: publishBody(m, null, 'p-1') });
  assert.deepEqual([half.status, half.body.error], [409, 'approval_required'], 'marketing still has no live approval');
  // The wrong authority for the profile does not count either.
  assert.equal((await grant(env, CAROL, 'counsel', 0, 'g-carol-c')).status, 200);
  assert.equal((await call(env, 'POST', path, { body: publishBody(m, null, 'p-2') })).body.error, 'approval_required');
  assert.equal((await grant(env, CAROL, 'brand_owner', 0, 'g-carol')).status, 200);
  const status = await call(env, 'GET', `/manifests/${m.manifestUid}?${Q}`);
  assert.deepEqual([status.body.release.missingApprovals, status.body.release.approvals.map((a: any) => a.reviewerUserId)], [[], [BOB, CAROL]]);
  const ok = await call(env, 'POST', path, { body: publishBody(m, null, 'p-3') });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.cost.d1Statements > 0);

  // CAROL's brand_owner is revoked: the next manifest's marketing approval no longer counts.
  assert.equal((await revoke(env, CAROL, 'brand_owner', 1, 'r-carol')).status, 200);
  const website2 = await revise(w, website, 'pub-website-v2');
  await attestAll(w, website2, ['code']);
  const m2 = await cutPublic(w, line, website2, copy, 'pm2');
  const after = await call(env, 'POST', `/manifests/${m2.manifestUid}/publish`, { body: publishBody(m2, m.manifestUid, 'p-4') });
  assert.deepEqual([after.status, after.body.error], [409, 'approval_required']);
  assert.deepEqual(auditRows(w, 'work_graph_release_publish').map((a) => a.outcome),
    ['approval_required', 'approval_required', 'approval_required', 'published', 'approval_required']);
});

test('6. takedown resolves the Super Admin from the store: linked and granted, or no_authority', async () => {
  const w = fresh();
  const env = envOf(w, { FILES: new FakeBucket() });
  const { website, copy, line } = await publicLine(w);
  const m = await cutPublic(w, line, website, copy, 'pm1');
  await grant(env, BOB, 'maintainer', 0, 'g-bob');
  await grant(env, CAROL, 'brand_owner', 0, 'g-carol');
  assert.equal((await call(env, 'POST', `/manifests/${m.manifestUid}/publish`, { body: publishBody(m, null, 'p-1') })).status, 200);
  const td = (key: string) => call(env, 'POST', `/manifests/${m.manifestUid}/takedown`, {
    body: { ...IN, digest: m.digest, reason_code: 'legal_order', evidence_ref: 'order:77', authority: 'security_officer', idempotency_key: key },
  });

  // Being a Super Admin is not membership: the store refuses a grant to one not linked to the company.
  assert.equal((await grant(env, SUPER, 'security_officer', 0, 'g-super-0')).body.error, 'not_member');
  assert.deepEqual([(await td('td-0')).status, (await td('td-0b')).body.error], [409, 'no_authority']);
  link(w, 70, SUPER);
  assert.equal((await grant(env, SUPER, 'security_officer', 0, 'g-super')).status, 200);
  assert.equal((await revoke(env, SUPER, 'security_officer', 1, 'r-super')).status, 200);
  assert.equal((await td('td-1')).body.error, 'no_authority', 'revoked: refused at once');
  assert.equal((await grant(env, SUPER, 'security_officer', 2, 'g-super-2')).status, 200);
  const down = await td('td-2');
  assert.equal(down.status, 200, JSON.stringify(down.body));
  assert.equal(down.body.changed, true);
  assert.deepEqual((w.db.prepare('SELECT outcome, refusal_code, authority FROM work_graph_release_takedowns ORDER BY id').all() as any[]).map((r) => [r.outcome, r.refusal_code]),
    [['refused', 'no_authority'], ['refused', 'no_authority'], ['refused', 'no_authority'], ['applied', null]]);
  assert.deepEqual(auditRows(w, 'work_graph_release_takedown').map((a) => a.outcome), ['no_authority', 'no_authority', 'no_authority', 'taken_down']);
});
