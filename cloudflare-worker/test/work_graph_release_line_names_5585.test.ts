/**
 * D5585 part 16 (#5585, WorkGraph P1): a release line's name. A Super Admin names or renames a line from the name `seq`
 * they saw; the store keeps every name it has had; the line reads show the current one. The real router over the full
 * migrated schema, with part 2's synthetic world.
 *
 *   1. Flag off: 404 before any D1 read. Gates: no session 401; an admin who is not a Super Admin, and a Super Admin
 *      without a TOTP step-up, are refused and nothing is written.
 *   2. Name, rename, read: an unnamed line reads null with `not_recorded`; each name is the next `seq`; both reads show
 *      it, and who set it is named; a stale `seq` is refused with the current name; a replay answers the first; a key
 *      reused for another name is refused. Every attempt is an admin audit row.
 *   3. What a name may be: whitespace is made one space; empty, too long, control and text-direction characters are
 *      refused; malformed bodies are refused before the store.
 *   4. Scope and the store: another tenant's line is refused; a missing line is not found; another scope reads no name;
 *      the triggers refuse an edit, a delete, a skipped `seq` and a name under another tenant.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_line_names_5585.test.ts
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
import { Meter } from '../src/services/workGraphReleases.ts';
import { RELEASE_LINE_NAME_LIMITS, lineNamesOf, normaliseLineName } from '../src/services/workGraphReleaseLineNames.ts';
import { RELEASE_REFUSAL_SENTENCES } from '../src/services/workGraphReleaseAdmin.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, ADMIN = 2, LAZY = 4, OTHER_SUPER = 5;
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
  u.run(LAZY, 'admin', 'Lazy', 'lazy@axal.example');
  u.run(OTHER_SUPER, 'admin', 'Other', 'other@axal.example');
  u.run(11, 'founder', 'P11', 'p11@example.test');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${LAZY}), (${OTHER_SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))");
  for (const id of [SUPER, ADMIN, OTHER_SUPER]) s.run(`s-${id}`, id);
  db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'magic_link', datetime('now'), NULL)").run(`s-${LAZY}`, LAZY);
  return { env: { DB: d1Over(db) } as any, db } as W;
}
function untouchable() {
  const touched: string[] = [];
  const DB = new Proxy({}, { get(_t, k) { touched.push(String(k)); throw new Error(`D1 touched: ${String(k)}`); } });
  return { DB, touched };
}

const app = new Hono<any>();
app.route(BASE, releases);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));

const token = (who: number) => new SignJWT({ user_id: who, role: 'admin', jti: `s-${who}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
const envOf = (w: W | null, over: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: w?.env.DB, WORK_GRAPH_RELEASE_ADMIN: 'on', ...over } as any);
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
const rename = (env: any, line: string, name: unknown, seq: unknown, key: string, over: Record<string, unknown> = {}, who?: number | null) =>
  call(env, 'PUT', `/lines/${line}/name`, { who, body: { ...IN, name, expected_seq: seq, idempotency_key: key, ...over } });
const rows = (w: W) => w.db.prepare('SELECT line_asset_uid, seq, name, actor_user_id FROM work_graph_release_line_names ORDER BY id').all().map((r: any) => ({ ...r }));
const auditRows = (w: W) => (w.db.prepare("SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'work_graph_release_line_name' ORDER BY id").all() as any[])
  .map((r) => ({ admin: r.admin_user_id, ...JSON.parse(r.filters_json) }));

test('1. flag off is 404 before any D1 read; only a stepped-up Super Admin may rename, and a refused one writes nothing', async () => {
  const u = untouchable();
  const off = await call(envOf(null, { DB: u.DB, WORK_GRAPH_RELEASE_ADMIN: 'yes' }), 'PUT', '/lines/x/name', { body: { ...IN, name: 'A', expected_seq: 0, idempotency_key: 'k' } });
  assert.deepEqual([off.status, off.body?.error], [404, 'release_admin_off']);
  assert.deepEqual(u.touched, []);

  const w = fresh();
  const env = envOf(w);
  const line = await newLine(w, 'line-a');
  assert.equal((await rename(env, line, 'A', 0, 'k-anon', {}, null)).status, 401);
  for (const who of [ADMIN, LAZY]) {
    const r = await rename(env, line, 'A', 0, `k-${who}`, {}, who);
    assert.ok(r.status === 401 || r.status === 403, `${who}: ${r.status}`);
  }
  assert.deepEqual(rows(w), []);
});

test('2. name, rename and read: next seq each time, stale and reused keys refused, every attempt audited', async () => {
  const w = fresh();
  const env = envOf(w);
  const line = await newLine(w, 'line-b');
  const listed = async () => (await call(env, 'GET', `/lines?${Q}`)).body.lines.find((l: any) => l.lineAssetUid === line);
  const one = async () => (await call(env, 'GET', `/lines/${line}?${Q}`)).body;

  assert.deepEqual(((l) => [l.lineName, l.lineNameReason, l.lineNameSeq])(await listed()), [null, 'not_recorded', 0]);
  const before = await one();
  assert.deepEqual([before.lineName, before.lineNameReason, before.lineNameSeq, before.lineNameSetBy, before.lineNameSetAt], [null, 'not_recorded', 0, null, null]);

  const first = await rename(env, line, 'Spring launch', 0, 'n1');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual([first.body.lineName, first.body.lineNameSeq, first.body.replayed], ['Spring launch', 1, false]);
  assert.deepEqual(((l) => [l.lineName, l.lineNameReason, l.lineNameSeq])(await listed()), ['Spring launch', null, 1]);
  const after = await one();
  assert.deepEqual([after.lineName, after.lineNameReason, after.lineNameSeq, after.lineNameSetBy], ['Spring launch', null, 1, SUPER]);
  assert.match(after.lineNameSetAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(after.people[SUPER]?.name, 'Super', 'who named the line is named');

  // Another Super Admin renames from seq 1; the first one, still at seq 1, is refused with what is there now.
  assert.equal((await rename(env, line, 'Spring launch 2027', 1, 'n2', {}, OTHER_SUPER)).body.lineNameSeq, 2);
  const stale = await rename(env, line, 'Mine', 1, 'n3');
  assert.deepEqual([stale.status, stale.body.error, stale.body.current], [409, 'stale_line_name',
    { name: 'Spring launch 2027', seq: 2, setByUserId: OTHER_SUPER, setAt: stale.body.current.setAt }]);
  assert.equal(stale.body.message, RELEASE_REFUSAL_SENTENCES.stale_line_name);
  assert.equal((await one()).lineName, 'Spring launch 2027');

  // A replay answers the first; the same key for another name is refused; neither writes.
  const again = await rename(env, line, 'Spring launch', 0, 'n1');
  assert.deepEqual([again.status, again.body.lineName, again.body.lineNameSeq, again.body.replayed], [200, 'Spring launch', 1, true]);
  const reuse = await rename(env, line, 'Something else', 0, 'n1');
  assert.deepEqual([reuse.status, reuse.body.error], [409, 'idempotency_conflict']);
  assert.deepEqual(rows(w), [
    { line_asset_uid: line, seq: 1, name: 'Spring launch', actor_user_id: SUPER },
    { line_asset_uid: line, seq: 2, name: 'Spring launch 2027', actor_user_id: OTHER_SUPER },
  ]);
  assert.deepEqual(auditRows(w).map((a) => [a.admin, a.outcome, a.expected_seq]), [
    [SUPER, 'named', 0], [OTHER_SUPER, 'named', 1], [SUPER, 'stale_line_name', 1], [SUPER, 'named', 0], [SUPER, 'idempotency_conflict', 0],
  ]);
  assert.deepEqual(auditRows(w).map((a) => a.replayed ?? null), [false, false, null, true, null]);
});

test('3. a name is text: whitespace made one space; empty, long, control and direction characters refused', async () => {
  assert.equal(normaliseLineName('  Spring \n\t launch  '), 'Spring launch');
  assert.equal(normaliseLineName('Café'), 'Café', 'NFC');
  assert.equal(normaliseLineName('x'.repeat(RELEASE_LINE_NAME_LIMITS.nameMax)), 'x'.repeat(120));
  for (const bad of ['', '   ', 'x'.repeat(121), 'a\u0000b', 'a\u0007b', 'a\u0085b', 'pay\u202eetuo', 'a\u2066b', 7, null]) {
    assert.equal(normaliseLineName(bad as any), null, JSON.stringify(bad));
  }
  const w = fresh();
  const env = envOf(w);
  const line = await newLine(w, 'line-c');
  const ok = await rename(env, line, '  Spring   launch ', 0, 'v1');
  assert.equal(ok.body.lineName, 'Spring launch');
  const bad = await rename(env, line, 'pay\u202eetuo', 1, 'v2');
  assert.deepEqual([bad.status, bad.body.error, bad.body.message], [400, 'line_name_invalid', RELEASE_REFUSAL_SENTENCES.line_name_invalid]);
  for (const [key, over] of [['m1', { name: 7 }], ['m2', { expected_seq: -1 }], ['m3', { expected_seq: 1.5 }], ['m4', { expected_seq: '1' }], ['m5', { idempotency_key: 3 }]] as const) {
    const r = await call(env, 'PUT', `/lines/${line}/name`, { body: { ...IN, name: 'N', expected_seq: 1, idempotency_key: key, ...over } });
    assert.deepEqual([r.status, r.body.error], [400, 'malformed'], key);
  }
  const noScope = await call(env, 'PUT', `/lines/${line}/name`, { body: { name: 'N', expected_seq: 1, idempotency_key: 'm6' } });
  assert.deepEqual([noScope.status, noScope.body.error], [400, 'malformed']);
  assert.equal(rows(w).length, 1);
});

test('4. scope: another tenant is refused, a missing line is not found, another scope reads no name; the store guards itself', async () => {
  const w = fresh();
  const env = envOf(w);
  const line = await newLine(w, 'line-d');
  const foreign = await rename(env, line, 'Theirs', 0, 'f1', { tenant_id: 8, company_id: 80 });
  assert.deepEqual([foreign.status, foreign.body.error], [403, 'wrong_tenant']);
  const missing = await rename(env, 'wga_missing', 'Gone', 0, 'f2');
  assert.deepEqual([missing.status, missing.body.error], [404, 'not_found']);
  assert.deepEqual(rows(w), []);

  assert.equal((await rename(env, line, 'Ours', 0, 'f3')).status, 200);
  const m = new Meter(w.env);
  assert.equal((await lineNamesOf(w.env, m, { tenantId: 7, companyId: 70, projectId: null }, [line])).get(line)?.name, 'Ours');
  assert.equal((await lineNamesOf(w.env, m, { tenantId: 8, companyId: 80, projectId: null }, [line])).get(line)?.name, null);
  assert.equal((await lineNamesOf(w.env, m, { tenantId: 7, companyId: 71, projectId: null }, [line])).get(line)?.name, null);

  const ins = (tenant: number, company: number, seq: number, key: string) => w.db.prepare(
    `INSERT INTO work_graph_release_line_names (line_asset_uid, tenant_id, company_id, seq, name, actor_user_id, idempotency_key, request_hash, created_at)
     VALUES (?, ?, ?, ?, 'N', 1, ?, ?, '2026-11-26T00:00:00Z')`,
  ).run(line, tenant, company, seq, key, 'c'.repeat(64));
  assert.throws(() => ins(7, 70, 3, 'skip'), /next of its line/);
  assert.throws(() => ins(8, 80, 2, 'foreign'), /tenant and company/);
  assert.throws(() => ins(7, 70, 1, 'dup'), /next of its line|UNIQUE/);
  assert.throws(() => w.db.prepare("UPDATE work_graph_release_line_names SET name = 'X'").run(), /append-only/);
  assert.throws(() => w.db.prepare('DELETE FROM work_graph_release_line_names').run(), /append-only/);
  assert.throws(() => w.db.prepare(
    `INSERT INTO work_graph_release_line_names (line_asset_uid, tenant_id, company_id, seq, name, actor_user_id, idempotency_key, request_hash, created_at)
     VALUES (?, 7, 70, 2, ' padded ', 1, 'pad', ?, '2026-11-26T00:00:00Z')`,
  ).run(line, 'c'.repeat(64)), /CHECK/);
  ins(7, 70, 2, 'next');
  assert.equal(rows(w).length, 2);
});
