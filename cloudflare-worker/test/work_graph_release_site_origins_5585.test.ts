/**
 * D5585 part 18 (#5585, WorkGraph P1): the origins a company's published release site records may be read from in a
 * browser. A Super Admin allows or removes one origin at a time from the list `seq` they saw; the public site-record
 * route sends `Access-Control-Allow-Origin` only for a listed origin of the record's own tenant and company. The real
 * routers over the full migrated schema.
 *
 *   1. What an origin is: https and a host name, an optional port, nothing else; case folded, a trailing slash dropped.
 *   2. The list: flag off is 404 before D1; only a stepped-up Super Admin writes; allow, remove, the next seq each time;
 *      stale, duplicate, absent, over the limit and another tenant refused; a replay answers the first; every attempt
 *      is audited; the read gives the list, its seq, the history and the names.
 *   3. The public route: a listed origin gets the CORS headers on every answer and on a preflight; an unlisted one,
 *      another company's, a removed one or a non-canonical spelling gets none; no credentials ever; flag off reads
 *      nothing.
 *   4. The store: the triggers refuse an edit, a delete and a skipped seq; the CHECK refuses a non-canonical origin.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_site_origins_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { T0, clock, newLine, type W } from './_work_graph_release_world_5585.ts';
import releases from '../src/routes/admin_work_graph_releases.ts';
import sites from '../src/routes/release_sites_public.ts';
import { SITE_ORIGIN_LIMITS, normaliseSiteOrigin } from '../src/services/workGraphReleaseSiteOrigins.ts';
import { RELEASE_REFUSAL_SENTENCES } from '../src/services/workGraphReleaseAdmin.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, ADMIN = 2, OTHER_SUPER = 5;
const ADMIN_BASE = '/api/admin/work-graph/releases';
const SITES = '/api/public/release-sites';
const Q = 'tenant_id=7&company_id=70';
const IN = { tenant_id: 7, company_id: 70 };
const ACME = 'https://acme.example';

function fresh(): W {
  clock.t = T0;
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Super', 'super@axal.example');
  u.run(ADMIN, 'admin', 'Admin', 'admin@axal.example');
  u.run(OTHER_SUPER, 'admin', 'Other', 'other@axal.example');
  u.run(11, 'founder', 'P11', 'p11@example.test');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${OTHER_SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))");
  for (const id of [SUPER, ADMIN, OTHER_SUPER]) s.run(`s-${id}`, id);
  return { env: { DB: d1Over(db) } as any, db } as W;
}
function untouchable() {
  const touched: string[] = [];
  const DB = new Proxy({}, { get(_t, k) { touched.push(String(k)); throw new Error(`D1 touched: ${String(k)}`); } });
  return { DB, touched };
}

const app = new Hono<any>();
app.route(ADMIN_BASE, releases);
app.route(SITES, sites);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));

const token = (who: number) => new SignJWT({ user_id: who, role: 'admin', jti: `s-${who}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
const envOf = (w: W | null, over: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: w?.env.DB, WORK_GRAPH_RELEASE_ADMIN: 'on', WORK_GRAPH_RELEASE_SITES: 'on', ...over } as any);
async function call(env: any, method: string, path: string, opts: { who?: number | null; body?: unknown; base?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  const who = opts.who === undefined ? SUPER : opts.who;
  if (who !== null) headers.Authorization = `Bearer ${await token(who)}`;
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const res = await app.request(`${opts.base ?? ADMIN_BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; console.error = e; console.info = i; }
}
const change = (env: any, op: string, origin: unknown, seq: unknown, key: string, over: Record<string, unknown> = {}, who?: number) =>
  call(env, 'POST', '/site-origins', { who, body: { ...IN, op, origin, expected_seq: seq, idempotency_key: key, ...over } });
const site = (env: any, origin: string | null, method = 'GET', path = '/7/70/campaign') =>
  call(env, method, path, { base: SITES, who: null, headers: origin ? { Origin: origin } : {} });
const rows = (w: W) => w.db.prepare('SELECT seq, op, origin, actor_user_id FROM work_graph_release_site_origins ORDER BY id').all().map((r: any) => ({ ...r }));
const audits = (w: W) => (w.db.prepare("SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'work_graph_release_site_origin' ORDER BY id").all() as any[])
  .map((r) => ({ admin: r.admin_user_id, ...JSON.parse(r.filters_json) }));

test('1. an origin is https and a host name with an optional port, and nothing else', () => {
  assert.equal(normaliseSiteOrigin('https://acme.example'), ACME);
  assert.equal(normaliseSiteOrigin(' HTTPS://Acme.Example/ '), ACME);
  assert.equal(normaliseSiteOrigin('https://www.acme.co.uk:8443'), 'https://www.acme.co.uk:8443');
  for (const bad of ['http://acme.example', 'https://acme', 'https://acme.example/path', 'https://acme.example?x=1', 'https://acme.example#a',
    'https://user@acme.example', 'https://*.acme.example', 'https://10.0.0.1', 'https://[::1]', 'https://acme.example:443',
    'https://acme.example:0', 'https://acme.example:70000', 'https://acme.example:080', 'https://-acme.example', 'https://acme..example',
    '', 'acme.example', 7, null]) {
    assert.equal(normaliseSiteOrigin(bad as any), null, JSON.stringify(bad));
  }
});

test('2. the list: allow and remove from the seq seen; every refusal; replays; audit; the read', async () => {
  const u = untouchable();
  const off = await change(envOf(null, { DB: u.DB, WORK_GRAPH_RELEASE_ADMIN: 'no' }), 'allow', ACME, 0, 'k0');
  assert.deepEqual([off.status, u.touched], [404, []]);

  const w = fresh();
  const env = envOf(w);
  await newLine(w, 'line-a', 'public'); // the company's release records live under tenant 7
  assert.ok([401, 403].includes((await change(env, 'allow', ACME, 0, 'k-admin', {}, ADMIN)).status));
  assert.deepEqual(rows(w), []);

  const empty = await call(env, 'GET', `/site-origins?${Q}`);
  assert.deepEqual([empty.body.origins, empty.body.seq, empty.body.history], [[], 0, []]);

  const a1 = await change(env, 'allow', 'https://ACME.example/', 0, 'a1');
  assert.deepEqual([a1.status, a1.body.op, a1.body.origin, a1.body.seq, a1.body.replayed], [200, 'allow', ACME, 1, false]);
  const again = await change(env, 'allow', ACME, 1, 'a2');
  assert.deepEqual([again.status, again.body.error, again.body.current], [409, 'already_allowed', { seq: 1, origins: [ACME] }]);
  assert.equal(again.body.message, RELEASE_REFUSAL_SENTENCES.already_allowed);
  assert.equal((await change(env, 'allow', 'https://shop.acme.example', 1, 'a3', {}, OTHER_SUPER)).body.seq, 2);
  const stale = await change(env, 'allow', 'https://late.example', 1, 'a4');
  assert.deepEqual([stale.status, stale.body.error, stale.body.current.seq], [409, 'stale_site_origins', 2]);
  const absent = await change(env, 'remove', 'https://never.example', 2, 'r0');
  assert.deepEqual([absent.status, absent.body.error], [409, 'not_allowed']);
  assert.equal((await change(env, 'remove', ACME, 2, 'r1')).body.seq, 3);

  // The read: the list now, its seq, the history newest first, and who did it named.
  const read = await call(env, 'GET', `/site-origins?${Q}`);
  assert.deepEqual(read.body.origins.map((o: any) => [o.origin, o.seq, o.allowedByUserId]), [['https://shop.acme.example', 2, OTHER_SUPER]]);
  assert.equal(read.body.seq, 3);
  assert.deepEqual(read.body.history.map((h: any) => [h.seq, h.op, h.origin]), [[3, 'remove', ACME], [2, 'allow', 'https://shop.acme.example'], [1, 'allow', ACME]]);
  assert.deepEqual([read.body.people[SUPER]?.name, read.body.people[OTHER_SUPER]?.name], ['Super', 'Other']);

  // A replay answers the first; a reused key for another change is refused.
  const rep = await change(env, 'allow', 'https://ACME.example/', 0, 'a1');
  assert.deepEqual([rep.status, rep.body.seq, rep.body.replayed], [200, 1, true]);
  assert.equal((await change(env, 'allow', 'https://other.example', 0, 'a1')).body.error, 'idempotency_conflict');
  // Malformed, invalid and another tenant.
  assert.equal((await change(env, 'grant', ACME, 3, 'm1')).body.error, 'malformed');
  assert.equal((await change(env, 'allow', ACME, -1, 'm2')).body.error, 'malformed');
  const inv = await change(env, 'allow', 'http://acme.example', 3, 'm3');
  assert.deepEqual([inv.status, inv.body.error], [400, 'site_origin_invalid']);
  assert.deepEqual(((r) => [r.status, r.body.error])(await change(env, 'allow', ACME, 0, 'f1', { tenant_id: 8 })), [403, 'wrong_tenant']);
  assert.equal(rows(w).length, 3);

  // The limit.
  let seq = 3;
  const have = (await call(env, 'GET', `/site-origins?${Q}`)).body.origins.length;
  for (let i = have; i < SITE_ORIGIN_LIMITS.perCompany; i++) {
    const r = await change(env, 'allow', `https://s${i}.example`, seq, `lim-${i}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    seq = r.body.seq;
  }
  assert.equal((await call(env, 'GET', `/site-origins?${Q}`)).body.origins.length, SITE_ORIGIN_LIMITS.perCompany);
  const over = await change(env, 'allow', 'https://one-too-many.example', seq, 'over');
  assert.deepEqual([over.status, over.body.error], [409, 'site_origin_limit']);

  const outcomes = audits(w).map((a) => a.outcome);
  assert.deepEqual(outcomes.slice(0, 11), ['allowed', 'already_allowed', 'allowed', 'stale_site_origins', 'not_allowed', 'removed', 'allowed',
    'idempotency_conflict', 'site_origin_invalid', 'wrong_tenant', 'allowed']);
  assert.equal(outcomes.at(-1), 'site_origin_limit');
});

test('3. the public route: CORS only for a listed origin of the record\'s own company, never credentials', async () => {
  const u = untouchable();
  const off = await site(envOf(null, { DB: u.DB, WORK_GRAPH_RELEASE_SITES: 'no' }), ACME);
  assert.deepEqual([off.status, off.headers.get('access-control-allow-origin'), u.touched], [404, null, []]);

  const w = fresh();
  const env = envOf(w);
  await newLine(w, 'line-a', 'public');
  assert.equal((await change(env, 'allow', ACME, 0, 'a1')).status, 200);

  // A listed origin gets the header on every answer, a refusal included (this site has no record: 404).
  const listed = await site(env, ACME);
  assert.deepEqual([listed.status, listed.body.error, listed.headers.get('access-control-allow-origin'), listed.headers.get('vary')], [404, 'not_found', ACME, 'Origin']);
  assert.equal(listed.headers.get('access-control-allow-credentials'), null);
  // Another origin, a non-canonical spelling, no origin, another company's path: none.
  for (const o of ['https://evil.example', 'https://ACME.example', `${ACME}/`, 'null']) {
    const r = await site(env, o);
    assert.deepEqual([r.headers.get('access-control-allow-origin'), r.headers.get('vary')], [null, 'Origin'], o);
  }
  const none = await site(env, null);
  assert.deepEqual([none.headers.get('access-control-allow-origin'), none.headers.get('vary')], [null, null]);
  assert.equal((await site(env, ACME, 'GET', '/7/71/campaign')).headers.get('access-control-allow-origin'), null);
  assert.equal((await site(env, ACME, 'GET', '/8/70/campaign')).headers.get('access-control-allow-origin'), null);

  // The preflight.
  const pre = await site(env, ACME, 'OPTIONS');
  assert.deepEqual([pre.status, pre.headers.get('access-control-allow-origin'), pre.headers.get('access-control-allow-methods'), pre.headers.get('access-control-max-age')],
    [204, ACME, 'GET', '600']);
  const preBad = await site(env, 'https://evil.example', 'OPTIONS');
  assert.deepEqual([preBad.status, preBad.headers.get('access-control-allow-origin'), preBad.headers.get('access-control-allow-methods')], [204, null, null]);

  // Removed: gone at once.
  assert.equal((await change(env, 'remove', ACME, 1, 'r1')).status, 200);
  assert.equal((await site(env, ACME)).headers.get('access-control-allow-origin'), null);
  assert.equal((await site(env, ACME, 'OPTIONS')).headers.get('access-control-allow-origin'), null);
});

test('4. the store: no edit, no delete, no skipped seq, only canonical origins', async () => {
  const w = fresh();
  const ins = (seq: number, origin: string, key: string) => w.db.prepare(
    `INSERT INTO work_graph_release_site_origins (tenant_id, company_id, seq, op, origin, actor_user_id, idempotency_key, request_hash, created_at)
     VALUES (7, 70, ?, 'allow', ?, 1, ?, ?, '2026-11-27T00:00:00Z')`,
  ).run(seq, origin, key, 'c'.repeat(64));
  ins(1, ACME, 'one');
  assert.throws(() => ins(3, 'https://b.example', 'skip'), /next of its company/);
  for (const [o, k] of [['http://b.example', 'h'], ['https://B.example', 'u'], ['https://b.example/x', 'p'], ['https://b.example?x', 'q']]) {
    assert.throws(() => ins(2, o, k), /CHECK/, o);
  }
  assert.throws(() => w.db.prepare("UPDATE work_graph_release_site_origins SET op = 'remove'").run(), /append-only/);
  assert.throws(() => w.db.prepare('DELETE FROM work_graph_release_site_origins').run(), /append-only/);
  ins(2, 'https://b.example', 'two');
  assert.equal(rows(w).length, 2);
});
