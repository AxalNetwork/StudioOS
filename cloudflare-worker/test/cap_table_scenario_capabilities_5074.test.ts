/**
 * D5074 part 6 (#5074) — the cap table scenarios' capabilities, across roles. Every Scenarios page reads Today
 * (`GET /scenarios/by-project/:projectId/today`) before it draws, and that read now carries `{ edit, plan }`. For each
 * viewer the map is checked against every scenario write: an allowed write is never refused for who the caller is (it
 * may still fail validation, 400), a denied one is refused 403, and a write without the plan answers the plan's 402.
 * A refused read carries no map. Before this map the page drew an admin's writes from the account's role, and the
 * Worker refused every one of them 403 (an admin never holds the venture's write gate, D1130).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cap_table_scenario_capabilities_5074.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import captable from '../src/routes/captable.ts';
import { scenarioCan, scenarioCapabilities } from '../src/services/capTableScenarioCapabilities.ts';
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
  // A thrown Response (the plan's 402 from ensureTier) is the answer, as the app's withThrownResponses makes it.
  let res: Response;
  try { res = await captable.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env); }
  catch (e) { if (e instanceof Response) res = e; else throw e; }
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


const SCENARIO = 'scn-10-variant';
async function withScenario() {
  const f = await fresher();
  f.db.prepare(`INSERT INTO cap_table_scenarios (uid, owner_user_id, project_id, name, inputs_json, result_json, computed_at, created_at, updated_at, is_variant)
    VALUES (?, ?, 10, 'Seed · base case', '{}', '{}', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 1)`).run(SCENARIO, OWNER);
  return f;
}

/** Every scenario write, sent with a body that fails validation, so an allowed write answers 400 and changes nothing. */
const WRITES: Array<[string, string]> = [
  ['POST', '/scenarios/by-project/10/variants'],
  ['PUT', `/scenarios/${SCENARIO}`],
];
const refusedForWho = (s: number) => s === 401 || s === 402 || s === 403;

test('the pure map: edit is the venture\'s write gate, plan the caller\'s plan; only a true allows', () => {
  assert.deepEqual(scenarioCapabilities({ writes: true, plan: true }), { edit: true, plan: true });
  assert.deepEqual(scenarioCapabilities({ writes: false, plan: true }), { edit: false, plan: true });
  assert.deepEqual(scenarioCapabilities({ writes: true, plan: false }), { edit: true, plan: false });
  for (const caps of [null, undefined, {}, { edit: 'true' }, { edit: 1 }, { plan: true }]) assert.equal(scenarioCan(caps as any, 'edit'), false, JSON.stringify(caps));
  assert.equal(scenarioCan({ edit: true }, 'edit'), true);
});

const EXPECT: Record<string, { who: number; caps: { edit: boolean; plan: boolean } }> = {
  owner: { who: OWNER, caps: { edit: true, plan: true } },
  member_owner: { who: MEMBER_OWNER, caps: { edit: true, plan: true } },
  cofounder: { who: COFOUNDER, caps: { edit: true, plan: true } },
  no_plan: { who: FREE, caps: { edit: true, plan: false } },
  advisor: { who: ADVISOR, caps: { edit: false, plan: true } },
};

for (const [name, want] of Object.entries(EXPECT)) {
  test(`${name}: Today carries the map, and each scenario write answers as it says`, async () => {
    const f = await withScenario();
    const read = await call(f, want.who, '/scenarios/by-project/10/today');
    assert.equal(read.status, 200, read.text);
    assert.deepEqual(read.body.capabilities, want.caps);
    const caps = read.body.capabilities;
    for (const [method, path] of [...WRITES, ['DELETE', `/scenarios/${SCENARIO}`] as [string, string]]) {
      const r = await call(f, want.who, path, method, { name: '' });
      if (caps.edit && caps.plan) assert.ok(!refusedForWho(r.status), `${name} ${method} ${path}: allowed, answered ${r.status} ${r.text}`);
      else if (!caps.plan) assert.equal(r.status, 402, `${name} ${method} ${path}: no plan answers the plan's 402`);
      else assert.equal(r.status, 403, `${name} ${method} ${path}: denied, answered ${r.status} ${r.text}`);
    }
  });
}

test('an admin, the Super Admin, an investor, an unrelated partner and another founder read no map and write nothing', async () => {
  const f = await withScenario();
  for (const who of [ADMIN, SUPER, INVESTOR, PARTNER, OTHER]) {
    const read = await call(f, who, '/scenarios/by-project/10/today');
    assert.ok([403, 404].includes(read.status), `${who}: read ${read.status}`);
    assert.equal(read.body?.capabilities, undefined, `${who}: no map on a refusal`);
    for (const [method, path] of [...WRITES, ['DELETE', `/scenarios/${SCENARIO}`] as [string, string]]) {
      const r = await call(f, who, path, method, { name: '' });
      assert.ok(refusedForWho(r.status) || r.status === 404, `${who} ${method} ${path}: ${r.status}`);
    }
  }
  const still = f.db.prepare('SELECT uid FROM cap_table_scenarios WHERE uid = ?').get(SCENARIO);
  assert.ok(still, 'no refused caller deleted the scenario');
});

test('the Today route builds the map from the gate every scenario write asks', () => {
  const route = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/captable.ts'), 'utf8');
  const today = route.slice(route.indexOf("captable.get('/scenarios/by-project/:projectId/today'"));
  assert.match(today.slice(0, 900), /scenarioCapabilities\(\{ writes: canWriteProject\(user, proj\), plan: userMeetsTier\(user, 'studio'\) \}\)/);
  // The writes: a variant asks ensureProjectWriteAccess (canWriteProject); a save or delete asks ensureScenarioWriteOr404
  // (canWriteScenario, which is canWriteProject for a venture's scenario); each asks the plan first.
  for (const [marker, gate] of [["captable.post('/scenarios/by-project/:projectId/variants'", 'ensureProjectWriteAccess'], ["captable.put('/scenarios/:uid'", 'ensureScenarioWriteOr404'], ["captable.delete('/scenarios/:uid'", 'ensureScenarioWriteOr404']]) {
    const at = route.slice(route.indexOf(marker), route.indexOf(marker) + 700);
    assert.match(at, /ensureTier\(await requireAuth\(c\), 'studio'\)/, `${marker}: the plan`);
    assert.ok(at.includes(gate), `${marker}: ${gate}`);
  }
});
