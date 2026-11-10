/**
 * D5074 slice 2 (#5074) — the cap table record's capabilities, across roles. For each viewer the read's map is checked
 * against the write each capability governs: an allowed write is never refused for who the caller is (it may still
 * fail validation, 400), a denied one is refused 403, and a write without the Studio plan answers the plan's 402.
 * Roles: the founder who owns the venture, a member whose role is owner, an accepted co-founder, an advisor member,
 * a co-founder without the plan, an investor-licence member, a non-member, an ordinary admin and a Super Admin.
 * The frontend fixtures' mirror (`frontend/test/_cap_table_capabilities.mjs`) is pinned to the Worker's function.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cap_table_capabilities_5074.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import captable from '../src/routes/captable.ts';
import { RECORD_CAPABILITIES, recordCan, recordCapabilities } from '../src/services/capTableCapabilities.ts';
import { capTableCapabilities } from '../../frontend/test/_cap_table_capabilities.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const RECORD = '573_cap_table_record.sql';
const JWT_SECRET = 'unit-test-jwt-secret-d5074-0123456789';

// 1 admin · 2 partner (unrelated) · 3 investor member · 4 owner · 5 co-founder · 6 advisor
// 7 co-founder on the free plan · 8 a member whose recorded role is owner · 9 another venture's founder
const USERS: Array<[number, string, number | null, string]> = [
  [1, 'admin', null, 'studio'], [2, 'partner', null, 'studio'], [3, 'investor', null, 'studio'], [4, 'founder', 40, 'studio'],
  [5, 'founder', 50, 'studio'], [6, 'advisor', null, 'studio'], [7, 'founder', 70, 'free'], [8, 'founder', 80, 'studio'], [9, 'founder', 90, 'studio'],
];
const ADMIN = 1, PARTNER = 2, INVESTOR = 3, OWNER = 4, COFOUNDER = 5, ADVISOR = 6, FREE = 7, MEMBER_OWNER = 8, OTHER = 9;

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x !== RECORD).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  // Whole, as the deploy applies it: a failure here fails the file.
  db.exec(readFileSync(resolve(MIGRATIONS, RECORD), 'utf8'));
  return db;
}
const BUILT = built();

function fresh() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const [id, role, founder, tier] of USERS) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(id, `u-${id}`, `person${id}@example.test`, `Person ${id}`, role, founder, tier);
  }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-10', 'Synthetic Venture', 40), (20, 'p-20', 'Other Venture', 90);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES
      (10, ${COFOUNDER}, 'cofounder', 'accepted'), (10, ${ADVISOR}, 'advisor', 'accepted'), (10, ${INVESTOR}, 'cofounder', 'accepted'),
      (10, ${FREE}, 'cofounder', 'accepted'), (10, ${MEMBER_OWNER}, 'owner', 'accepted');
    INSERT INTO cap_table_holders (id, user_id, project_id, name) VALUES (101, ${OWNER}, 10, 'Ada Founder'), (201, ${OTHER}, 20, 'Elsewhere');`);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}

async function call(f: any, id: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await captable.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}
const SUPER = 11;
const REASON = 'Synthetic support correction for the test';

async function fresher() {
  const f = fresh();
  f.db.prepare('INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run(SUPER, 'u-super', 'super@example.test', 'Super Holder', 'admin', null, 'studio');
  f.db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  return f;
}

/** Each write a capability governs, sent with a body that fails validation, so an allowed write answers 400. */
const WRITES: Record<'propose' | 'import' | 'record', Array<[string, string]>> = {
  propose: [['POST', '/record/10/proposals']],
  import: [['POST', '/record/10/proposals/import']],
  record: [['POST', '/record/10/issuances'], ['POST', '/record/10/classes'], ['POST', '/record/10/issuances/nope/void'], ['POST', '/record/10/proposals/nope/accept']],
};
const refusedForWho = (s: number) => s === 401 || s === 402 || s === 403;

const EXPECT: Record<string, { read: number; caps?: Record<string, boolean> }> = {
  owner: { read: 200, caps: { propose: true, import: true, record: true, correct: false, export: true, admin_reason_required: false, plan: true } },
  member_owner: { read: 200, caps: { propose: true, import: true, record: true, correct: false, export: true, admin_reason_required: false, plan: true } },
  cofounder: { read: 200, caps: { propose: true, import: true, record: false, correct: false, export: true, admin_reason_required: false, plan: true } },
  no_plan: { read: 200, caps: { propose: true, import: true, record: false, correct: false, export: true, admin_reason_required: false, plan: false } },
  advisor: { read: 200, caps: { propose: false, import: false, record: false, correct: false, export: true, admin_reason_required: false, plan: true } },
};
const WHO: Record<string, number> = { owner: OWNER, member_owner: MEMBER_OWNER, cofounder: COFOUNDER, no_plan: FREE, advisor: ADVISOR };

for (const [name, want] of Object.entries(EXPECT)) {
  test(`${name}: the read's map, and each write answers as the map says`, async () => {
    const f = await fresher();
    const who = WHO[name];
    const read = await call(f, who, '/record/10');
    assert.equal(read.status, want.read, read.text);
    assert.deepEqual(read.body.capabilities, want.caps);
    for (const [cap, writes] of Object.entries(WRITES)) {
      for (const [method, path] of writes) {
        const r = await call(f, who, path, method, { reason: REASON });
        const allowed = recordCan(read.body.capabilities, cap as any) && read.body.capabilities.plan;
        if (allowed) assert.ok(!refusedForWho(r.status), `${name} ${cap} ${path}: allowed, answered ${r.status} ${r.text}`);
        else if (!read.body.capabilities.plan) assert.equal(r.status, 402, `${name} ${path}: no plan answers the plan's 402`);
        else assert.equal(r.status, 403, `${name} ${cap} ${path}: denied, answered ${r.status} ${r.text}`);
      }
    }
    const csv = await call(f, who, '/record/10/export.csv');
    assert.equal(csv.status === 200, read.body.capabilities.export, `${name} export`);
  });
}

test('a co-founder is refused the owner\'s writes with owner_records, as before', async () => {
  const f = await fresher();
  const r = await call(f, COFOUNDER, '/record/10/issuances', 'POST', {});
  assert.equal(r.status, 403);
  assert.match(r.text, /owner_records/);
});

test('an investor, a non-member, an ordinary admin and a Super Admin read no map, and every write is refused', async () => {
  const f = await fresher();
  for (const who of [INVESTOR, OTHER, SUPER]) {
    const read = await call(f, who, '/record/10');
    assert.ok([403, 404].includes(read.status), `${who}: read ${read.status}`);
    assert.equal(read.body?.capabilities, undefined, `${who}: no map on a refusal`);
    for (const writes of Object.values(WRITES)) for (const [method, path] of writes) {
      const r = await call(f, who, path, method, { reason: REASON });
      assert.ok(refusedForWho(r.status), `${who} ${path}: ${r.status}`);
    }
  }
  // An ordinary admin reads nothing here (D1130), and writes only as a reasoned correction.
  assert.ok([403, 404].includes((await call(f, ADMIN, '/record/10')).status));
  const unreasoned = await call(f, ADMIN, '/record/10/issuances', 'POST', {});
  assert.equal(unreasoned.status, 400);
  assert.match(unreasoned.text, /reason_required/);
  const reasoned = await call(f, ADMIN, '/record/10/issuances', 'POST', { reason: REASON });
  assert.ok(!refusedForWho(reasoned.status), `the reasoned correction is the admin's: ${reasoned.status}`);
});

test('the map is pure and complete, and the frontend fixtures mirror it for every standing', () => {
  const keys = ['readable', 'writable', 'admin', 'superAdmin', 'owner', 'plan'] as const;
  for (let n = 0; n < 1 << keys.length; n += 1) {
    const s = Object.fromEntries(keys.map((k, i) => [k, !!(n & (1 << i))])) as any;
    const caps = recordCapabilities(s);
    assert.deepEqual(Object.keys(caps).sort(), [...RECORD_CAPABILITIES, 'plan'].sort());
    assert.deepEqual(capTableCapabilities(s), caps, JSON.stringify(s));
  }
  assert.equal(recordCan(null, 'record'), false);
  assert.equal(recordCan({ record: 'yes' } as any, 'record'), false, 'only a true allows');
});

test('every record write refuses from the same map: recordWriter asks recordCapabilities', () => {
  const route = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/captable.ts'), 'utf8');
  const writer = route.slice(route.indexOf('async function recordWriter('), route.indexOf('function recordError('));
  for (const needle of ["recordCapabilities(standing)", "recordCan(caps, 'propose')", "recordCan(caps, 'admin_reason_required')", "recordCan(caps, 'record')"]) {
    assert.ok(writer.includes(needle), needle);
  }
  assert.ok(!/actorRole === 'cofounder'/.test(writer), 'no second, local rule');
});
