/**
 * D5074 slice 3 (#5074) — the Investor narrative's capabilities, across roles. The versions read
 * (`/api/cycles/raise/modules/investor-narrative/form-options`) returns the caller's map, and each capability is
 * checked against the write it governs: an allowed write is never refused for who the caller is, a denied one is
 * refused with the narrative's own code. Roles: the venture's founder, an admin with a reason, the Super Admin on HQ
 * with a reason, an admin without one, another founder and an investor (the last three read no map). The frontend
 * fixtures' mirror (`frontend/test/_narrative_capabilities.mjs`) is pinned to the Worker's function.
 *
 * The real `cycle_raise.ts` and `cycle_records.ts` routers over HTTP, on the narrative admin suite's fixture.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_capabilities_5074.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import cycleRaise from '../src/routes/cycle_raise.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { NARRATIVE_CAPABILITIES, narrativeCan, narrativeCapabilities } from '../src/services/narrative/capabilities.ts';
import { narrativeCapabilities as mirror, NARRATIVE_CAPABILITIES as MIRROR_KEYS } from '../../frontend/test/_narrative_capabilities.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 110, OTHER = 120, INVESTOR = 150, ADMIN = 30, HQ = 31;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [INVESTOR]: 'investor', [ADMIN]: 'admin', [HQ]: 'admin' };
const P = 1;
// Invented words: no real venture, person or reason.
const REASON = 'Quarterly portfolio review';
const NOTE = 'Lead Traction with retention before revenue.';

function fixture() {
  // The whole schema (baseline + every migration, built once), so the check's writes find every store they read.
  const db = new DatabaseSync(':memory:');
  loadSchema(db);
  db.exec(`INSERT INTO founders (id, name, email) VALUES (1001, 'Fay Founder', 'fay@example.test'), (1002, 'Bo Other', 'bo@example.test')`);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(HQ, 'admin', 'Hal Headquarters', 'hal@example.test', null);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${HQ})`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (2, 'Osprey Works', 1002)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
app.route('/api/cycles', cycleRecords);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, base = '/api/cycles/raise') {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await app.request(`${base}${path}${sep}project=${P}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}
const rec = (db: DatabaseSync, who: number, method: string, path: string, body?: unknown) => call(db, who, method, `/raise/modules/investor-narrative${path}`, body, '/api/cycles');
const logs = (db: DatabaseSync) => db.prepare(
  `SELECT action, details FROM activity_logs WHERE entity_type = 'raise.investor-narrative' ORDER BY id`,
).all().map((r) => ({ ...(r as any) }));
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as any).n);

/** Version 1, saved by the founder. */
async function v1(db: DatabaseSync) {
  const r = await call(db, FOUNDER, 'POST', '/narrative-versions', { investor_type: 'seed_fund' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.version as number;
}

const openAsAdmin = async (db: DatabaseSync, who = ADMIN) => {
  const r = await call(db, who, 'POST', '/narrative/reads', { reason: REASON });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.read;
};


const capsOf = async (db: DatabaseSync, who: number) => rec(db, who, 'GET', '/form-options');

test('the map: each standing, every key a boolean; no map, an unknown key or a non-true value allows nothing', () => {
  const founder = narrativeCapabilities({ admin: false, founder: true });
  const writer = narrativeCapabilities({ admin: false, founder: false });
  const admin = narrativeCapabilities({ admin: true, founder: false });
  assert.deepEqual(founder, { edit: true, check: true, note: true, end_read: false, admin_reason_required: false });
  assert.deepEqual(writer, { edit: true, check: false, note: true, end_read: false, admin_reason_required: false });
  assert.deepEqual(admin, { edit: false, check: false, note: true, end_read: true, admin_reason_required: true });
  // An admin is never the founder for the check, whatever the standing says.
  assert.equal(narrativeCapabilities({ admin: true, founder: true }).check, false);
  for (const caps of [founder, writer, admin]) assert.deepEqual(Object.keys(caps).sort(), [...NARRATIVE_CAPABILITIES].sort());
  assert.equal(narrativeCan(null, 'edit'), false);
  assert.equal(narrativeCan({ edit: 'yes' } as any, 'edit'), false);
  assert.equal(narrativeCan({ edit: 1 } as any, 'edit'), false);
  assert.equal(narrativeCan({ edit: true }, 'check'), false);
});

test('the frontend fixtures\' mirror is the Worker\'s function', () => {
  assert.deepEqual([...MIRROR_KEYS], [...NARRATIVE_CAPABILITIES]);
  for (const admin of [false, true]) for (const founder of [false, true]) {
    assert.deepEqual(mirror({ admin, founder }), narrativeCapabilities({ admin, founder }), JSON.stringify({ admin, founder }));
  }
});

test('the founder: the read carries the founder\'s map, and every write it allows lands', async () => {
  // Mutation checked: `edit: !s.admin` → `edit: false` fails the section write here; `check` dropped from the founder fails the check.
  const db = fixture();
  const v = await v1(db);
  const read = await capsOf(db, FOUNDER);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.deepEqual(read.body.capabilities, narrativeCapabilities({ admin: false, founder: true }));
  assert.ok(Array.isArray(read.body.versions), 'the versions are still read beside it');
  const caps = read.body.capabilities;
  // edit
  assert.equal(caps.edit, true);
  assert.equal((await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/solution`, { body: 'An approval layer over the ledger.' })).status, 200);
  // check
  assert.equal(caps.check, true);
  const check = await call(db, FOUNDER, 'POST', `/narrative/${v}/check`, {});
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.equal(check.body.can_check, true);
  // note
  assert.equal(caps.note, true);
  assert.equal((await call(db, FOUNDER, 'POST', '/narrative/notes', { body: 'Answered in v2.' })).status, 201);
  // end_read: a founder has no read to end, and is refused for who they are
  assert.equal(caps.end_read, false);
  assert.equal((await call(db, FOUNDER, 'DELETE', '/narrative/reads/mine')).body.code, 'admins_only');
});

for (const [label, who] of [['an admin', ADMIN], ['the Super Admin on HQ', HQ]] as const) {
  test(`${label} with a reason: the admin map, and every write it denies is refused`, async () => {
    // Mutation checked: the write gate reading `edit: true` for an admin → the section write lands and this fails.
    const db = fixture();
    const v = await v1(db);
    await openAsAdmin(db, who);
    const read = await capsOf(db, who);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.deepEqual(read.body.capabilities, narrativeCapabilities({ admin: true, founder: false }));
    const caps = read.body.capabilities;
    assert.equal(caps.admin_reason_required, true);
    // edit: refused, and nothing is written
    assert.equal(caps.edit, false);
    const before = count(db, 'SELECT COUNT(*) AS n FROM narrative_sections');
    const edit = await call(db, who, 'PUT', `/narrative/${v}/sections/solution`, { body: 'Changed by an admin' });
    assert.equal(edit.status, 403);
    assert.equal(edit.body.code, 'admin_read_only');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM narrative_sections'), before);
    // check: refused
    assert.equal(caps.check, false);
    assert.equal((await call(db, who, 'POST', `/narrative/${v}/check`, {})).status, 403);
    assert.equal((await call(db, who, 'GET', `/narrative/${v}/check`)).body.can_check, false, 'the check read says the same');
    // note: allowed
    assert.equal(caps.note, true);
    assert.equal((await call(db, who, 'POST', '/narrative/notes', { body: 'Lead Traction with retention.' })).status, 201);
    // end_read: allowed
    assert.equal(caps.end_read, true);
    assert.equal((await call(db, who, 'DELETE', '/narrative/reads/mine')).status, 200);
    // With the read ended, the versions read is refused again and carries no map.
    const closed = await capsOf(db, who);
    assert.equal(closed.status, 403);
    assert.equal(closed.body.code, 'read_reason_required');
    assert.ok(!('capabilities' in closed.body));
  });
}

test('an admin without a reason, another founder and an investor read no map', async () => {
  const db = fixture();
  await v1(db);
  const noReason = await capsOf(db, ADMIN);
  assert.equal(noReason.status, 403);
  assert.equal(noReason.body.code, 'read_reason_required');
  for (const who of [OTHER, INVESTOR]) {
    const r = await capsOf(db, who);
    assert.equal(r.status, 403, `${who}: ${JSON.stringify(r.body)}`);
    assert.ok(!r.body || !('capabilities' in r.body));
  }
});

test('every narrative write refuses from the map, in the route source', () => {
  const raise = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/cycle_raise.ts'), 'utf8');
  const admin = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/narrative/adminRead.ts'), 'utf8');
  const records = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/cycle_records.ts'), 'utf8');
  assert.match(admin, /mode === 'write' && !narrativeCan\(narrativeCapabilities\(\{ admin: true, founder: false \}\), 'edit'\)/, 'the admin write gate is edit');
  assert.ok(!/async function narrativeFounder/.test(raise), 'the route keeps no founder check of its own');
  assert.equal((raise.match(/narrativeChecks\(c, s\.user, s\.projectId\)/g) || []).length, 5, 'claims, check read, check, use-record and the likely questions');
  assert.match(raise, /narrativeCan\(narrativeCapabilities\(\{ admin: isAdmin\(s\.user\), founder: false \}\), 'end_read'\)/);
  assert.match(records, /capabilities: narrativeCapabilities\(await narrativeStanding\(c, s\.ctx\.user, s\.ctx\.projectId\)\)/);
  // Every write route on the narrative goes through the write gate.
  const writes = [...raise.matchAll(/cycleRaise\.(put|post|patch|delete)\('(\/narrative[^']*)'/g)].map((m) => ({ head: m[0], path: m[2] }));
  const gated = (path: string) => !/^\/narrative\/(reads|notes)/.test(path);
  assert.ok(writes.length >= 10, 'the narrative write routes are found');
  for (const { head, path } of writes.filter((w) => gated(w.path))) {
    const at = raise.indexOf(head);
    const handler = raise.slice(at, raise.indexOf('\n});', at));
    assert.ok(/narrativeScope\(c, 'write'\)|keptScope\(c\)/.test(handler), `${path} goes through the write gate`);
  }
});
