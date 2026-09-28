/**
 * D376 — the Funds · Fabric canvas's F1 store (migration 314) and the entity
 * writes behind it (routes/legal_entities.ts), on node:sqlite.
 *
 *   1. THE MIGRATION. It applies on the baseline's own `entities` and
 *      `vc_funds`, and its CHECKs refuse a role outside F1's five and an
 *      officer with no name.
 *   2. THE GATES. Creating an entity stays staff-only, as it was in legal.ts;
 *      every write D376 adds is admin-only, and a partner is refused.
 *   3. THE WRITES. Each validates, each leaves what it did not name alone, and
 *      each is recorded — actor, entity, and the names of the fields changed.
 *      An officer's appointment is ceased, never deleted. A fund link needs
 *      the entity to hold the matching role, and an unlink only clears a link
 *      that points at this entity.
 *   4. THE LINE IT FEEDS. Once a fund is linked, HQ's registry reads its
 *      vehicle's and GP's jurisdictions — and nothing else about the entity:
 *      no name, registration number, agent or officer crosses the RPC.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fabric_entities_d376.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import legalEntities, { FABRIC_ROLES } from '../src/routes/legal_entities.ts';
import { readFundsRegistry } from '../src/rpc/branchOps.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/314_fabric_entities.sql');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const PARTNER = 2;
const FOUNDER = 3;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return Promise.all(x.map((s) => s.run())); },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'entities', 'vc_funds', 'fund_report_periods', 'limited_partners', 'capital_calls',
    'fund_distributions', 'activity_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(read('cloudflare-worker/sql/migrations/312_fund_call_ledger.sql'));
  db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, email, role, name) VALUES (?,?,?,?)');
  u.run(ADMIN, 'ada@axal.example', 'admin', 'Ada Admin');
  u.run(PARTNER, 'pia@axal.example', 'partner', 'Pia Partner');
  u.run(FOUNDER, 'fay@axal.example', 'founder', 'Fay Founder');
  db.prepare(`INSERT INTO vc_funds (id, name, status, gp_entity, fund_size_cents) VALUES (?,?,?,?,?)`)
    .run(10, 'Harbor Fund I', 'investing', 'Harbor GP LLC', 500_000_000);
  db.prepare(`INSERT INTO entities (id, name, entity_type, jurisdiction) VALUES (?,?,?,?)`)
    .run(1, 'Harbor Holdings', 'holding_company', 'US-DE');
  return db;
}

async function jwt(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const ROLE: Record<number, string> = { [ADMIN]: 'admin', [PARTNER]: 'partner', [FOUNDER]: 'founder' };
async function call(db: InstanceType<typeof DatabaseSync>, as: number, method: string, path: string, payload?: unknown) {
  const app = new Hono<any>();
  app.route('/api/legal', legalEntities);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const res = await app.request(`/api/legal${path}`, {
    method,
    headers: { Authorization: `Bearer ${await jwt(as, ROLE[as])}`, 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }, { DB: makeD1(db), JWT_SECRET } as any);
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body, text };
}
const audits = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare(`SELECT action, details, user_id FROM activity_logs WHERE action LIKE 'legal.entity.%' ORDER BY id`).all() as any[];

/* ------------------------------------------------------------------ *
 * 1 · the migration                                                   *
 * ------------------------------------------------------------------ */

test('D376: migration 314 stands alone — additive ALTERs and one new table, no transaction', () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, '');
  assert.ok(!/\bBEGIN\b|\bCOMMIT\b|DROP |\bRENAME\b/i.test(sql));
  const alters = [...sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual(alters, ['entities.fabric_role', 'entities.registration_number', 'entities.registered_agent',
    'vc_funds.gp_entity_id', 'vc_funds.vehicle_entity_id']);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS entity_officers \(/);
  assert.ok(!/\btenant\b/i.test(sql), 'a tenant column restates which database holds the row');
});

test('D376: the migration\'s CHECKs refuse a role outside F1\'s five and a nameless officer', () => {
  const db = freshDb();
  for (const r of FABRIC_ROLES) db.prepare('UPDATE entities SET fabric_role = ? WHERE id = 1').run(r);
  assert.throws(() => db.prepare(`UPDATE entities SET fabric_role = 'general_partner' WHERE id = 1`).run(), /CHECK/);
  assert.throws(() => db.prepare(`INSERT INTO entity_officers (uid, entity_id, name, title) VALUES ('o1', 1, '  ', 'Director')`).run(), /CHECK/);
  assert.deepEqual([...FABRIC_ROLES], ['gp_entity', 'management_company', 'fund_vehicle', 'holding', 'operating']);
});

/* ------------------------------------------------------------------ *
 * 2 · the gates                                                       *
 * ------------------------------------------------------------------ */

test('D376: creating an entity stays staff-only; a founder is refused', async () => {
  const db = freshDb();
  const f = await call(db, FOUNDER, 'POST', '/entities', { name: 'Grafted Co', entity_type: 'subsidiary', parent_id: 1 });
  assert.equal(f.status, 403, f.text);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM entities WHERE name = 'Grafted Co'`).get() as any).n, 0);
  const p = await call(db, PARTNER, 'POST', '/entities', { name: 'Harbor GP LLC', entity_type: 'subsidiary', parent_id: 1 });
  assert.equal(p.status, 201, p.text);
});

test('D376: every write D376 adds is admin-only — a partner is refused each one, and nothing moves', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO entities (id, name, entity_type, fabric_role) VALUES (2, 'Harbor GP LLC', 'subsidiary', 'gp_entity')`).run();
  for (const [method, path, payload] of [
    ['PATCH', '/entities/2', { registration_number: 'SYN-0001' }],
    ['POST', '/entities/2/officers', { name: 'Sam Officer', title: 'Director' }],
    ['POST', '/entities/2/funds', { fund_id: 10, as: 'gp' }],
  ] as const) {
    const r = await call(db, PARTNER, method, path, payload);
    assert.equal(r.status, 403, `${method} ${path}: ${r.text}`);
    assert.equal(r.body.error, 'admin_only');
  }
  assert.equal((db.prepare('SELECT registration_number FROM entities WHERE id = 2').get() as any).registration_number, null);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM entity_officers').get() as any).n, 0);
  assert.equal((db.prepare('SELECT gp_entity_id FROM vc_funds WHERE id = 10').get() as any).gp_entity_id, null);
  // The listing is staff-wide, like the create.
  assert.equal((await call(db, PARTNER, 'GET', '/entities/2/officers')).status, 200);
  assert.equal((await call(db, FOUNDER, 'GET', '/entities/2/officers')).status, 403);
});

/* ------------------------------------------------------------------ *
 * 3 · the writes                                                      *
 * ------------------------------------------------------------------ */

test('D376: create validates, takes the fabric fields, and is recorded', async () => {
  const db = freshDb();
  const bad = [
    [{ entity_type: 'subsidiary' }, 'name_required'],
    [{ name: 'X', entity_type: 'gp' }, 'entity_type_invalid'],
    [{ name: 'X', entity_type: 'subsidiary', fabric_role: 'general_partner' }, 'fabric_role_invalid'],
    [{ name: 'X', entity_type: 'subsidiary', parent_id: 999 }, 'parent_not_found'],
    [{ name: 'X'.repeat(201), entity_type: 'subsidiary' }, 'field_invalid'],
  ] as const;
  for (const [payload, code] of bad) {
    const r = await call(db, ADMIN, 'POST', '/entities', payload);
    assert.equal(r.body.error, code, `${JSON.stringify(payload).slice(0, 60)} → ${r.text}`);
    assert.ok(r.status >= 400 && r.status < 500);
  }
  const ok = await call(db, ADMIN, 'POST', '/entities', {
    name: '  Harbor GP LLC ', entity_type: 'subsidiary', parent_id: 1, jurisdiction: 'US-DE',
    fabric_role: 'gp_entity', registration_number: 'SYN-7001', registered_agent: 'Synthetic Agent Co',
  });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.name, 'Harbor GP LLC');
  assert.equal(ok.body.fabric_role, 'gp_entity');
  assert.equal(ok.body.registration_number, 'SYN-7001');
  assert.equal(ok.body.parent_id, 1);
  const a = audits(db);
  assert.equal(a.length, 1, 'a refused create was recorded, or the create was not');
  assert.equal(a[0].action, 'legal.entity.create');
  assert.equal(a[0].user_id, ADMIN);
  assert.deepEqual(JSON.parse(a[0].details).fields.sort(), ['fabric_role', 'jurisdiction', 'name', 'registered_agent', 'registration_number']);
  // The record names only the fields sent — not every field there is.
  assert.equal((await call(db, PARTNER, 'POST', '/entities', { name: 'Bare Co', entity_type: 'project' })).status, 201);
  const bare = audits(db)[1];
  assert.equal(bare.user_id, PARTNER);
  assert.deepEqual(JSON.parse(bare.details).fields, ['name']);
});

test('D376: PATCH changes only what it names, clears on null, and records the field names', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO entities (id, name, entity_type, jurisdiction, registered_agent) VALUES (2, 'Harbor GP LLC', 'subsidiary', 'US-DE', 'Old Agent')`).run();
  const r = await call(db, ADMIN, 'PATCH', '/entities/2', { fabric_role: 'gp_entity', registered_agent: null });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.fabric_role, 'gp_entity');
  assert.equal(r.body.registered_agent, null, 'a field sent as null was not cleared');
  assert.equal(r.body.jurisdiction, 'US-DE', 'a field not sent was changed');
  assert.equal(r.body.name, 'Harbor GP LLC');
  const a = audits(db);
  assert.equal(a.length, 1);
  assert.equal(a[0].action, 'legal.entity.update');
  assert.deepEqual(JSON.parse(a[0].details), { entity_id: 2, fields: ['fabric_role', 'registered_agent'] });

  assert.equal((await call(db, ADMIN, 'PATCH', '/entities/2', {})).body.error, 'nothing_to_change');
  assert.equal((await call(db, ADMIN, 'PATCH', '/entities/2', { name: '' })).body.error, 'name_required');
  assert.equal((await call(db, ADMIN, 'PATCH', '/entities/2', { fabric_role: 'lp' })).body.error, 'fabric_role_invalid');
  assert.equal((await call(db, ADMIN, 'PATCH', '/entities/99', { name: 'X' })).status, 404);
  assert.equal(audits(db).length, 1, 'a refused PATCH was recorded');
});

test('D376: an officer is appointed, listed, and ceased — never deleted — and ceasing twice is refused', async () => {
  const db = freshDb();
  const bad = await call(db, ADMIN, 'POST', '/entities/1/officers', { name: 'Sam Officer', title: 'Director', appointed_on: '1/2/2026' });
  assert.equal(bad.body.error, 'date_invalid');
  assert.equal((await call(db, ADMIN, 'POST', '/entities/1/officers', { name: 'Sam Officer' })).body.error, 'officer_invalid');
  const made = await call(db, ADMIN, 'POST', '/entities/1/officers', { name: 'Sam Officer', title: 'Director', appointed_on: '2026-01-02' });
  assert.equal(made.status, 201, made.text);
  const uid = made.body.officer.uid;
  const ceased = await call(db, ADMIN, 'POST', `/entities/1/officers/${uid}/cease`, { ceased_on: '2026-06-30' });
  assert.equal(ceased.status, 200, ceased.text);
  const again = await call(db, ADMIN, 'POST', `/entities/1/officers/${uid}/cease`, { ceased_on: '2026-07-01' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_ceased');
  assert.equal((await call(db, ADMIN, 'POST', `/entities/1/officers/nope/cease`, { ceased_on: '2026-07-01' })).status, 404);
  const list = await call(db, PARTNER, 'GET', '/entities/1/officers');
  assert.deepEqual(list.body.officers.map((o: any) => [o.name, o.ceased_on]), [['Sam Officer', '2026-06-30']],
    'the ceased appointment is gone from the record, or its date moved');
  assert.deepEqual(audits(db).map((a) => a.action), ['legal.entity.officer_appointed', 'legal.entity.officer_ceased']);
});

test('D376: a fund link needs the matching role, and an unlink clears only a link to this entity', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO entities (id, name, entity_type, jurisdiction, fabric_role) VALUES (2, 'Harbor GP LLC', 'subsidiary', 'US-DE', 'gp_entity')`).run();
  db.prepare(`INSERT INTO entities (id, name, entity_type, jurisdiction, fabric_role) VALUES (3, 'Harbor Fund I LP', 'vc_fund', 'KY', 'fund_vehicle')`).run();
  const wrong = await call(db, ADMIN, 'POST', '/entities/2/funds', { fund_id: 10, as: 'vehicle' });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.error, 'fabric_role_mismatch');
  assert.equal((await call(db, ADMIN, 'POST', '/entities/2/funds', { fund_id: 99, as: 'gp' })).body.error, 'fund_not_found');
  assert.equal((await call(db, ADMIN, 'POST', '/entities/2/funds', { fund_id: 10, as: 'owner' })).body.error, 'link_invalid');

  assert.equal((await call(db, ADMIN, 'POST', '/entities/2/funds', { fund_id: 10, as: 'gp' })).status, 200);
  assert.equal((await call(db, ADMIN, 'POST', '/entities/3/funds', { fund_id: 10, as: 'vehicle' })).status, 200);
  const f = db.prepare('SELECT gp_entity_id, vehicle_entity_id FROM vc_funds WHERE id = 10').get() as any;
  assert.deepEqual({ ...f }, { gp_entity_id: 2, vehicle_entity_id: 3 });

  // Entity 3 is not the fund's GP, so it cannot clear the GP link.
  const notMine = await call(db, ADMIN, 'POST', '/entities/3/funds', { fund_id: 10, as: 'gp', unlink: true });
  assert.equal(notMine.status, 409);
  assert.equal(notMine.body.error, 'not_linked');
  assert.equal((db.prepare('SELECT gp_entity_id FROM vc_funds WHERE id = 10').get() as any).gp_entity_id, 2);
  assert.equal((await call(db, ADMIN, 'POST', '/entities/3/funds', { fund_id: 10, as: 'vehicle', unlink: true })).status, 200);
  assert.equal((db.prepare('SELECT vehicle_entity_id FROM vc_funds WHERE id = 10').get() as any).vehicle_entity_id, null);
  assert.deepEqual(audits(db).map((a) => a.action),
    ['legal.entity.fund_linked', 'legal.entity.fund_linked', 'legal.entity.fund_unlinked']);
});

/* ------------------------------------------------------------------ *
 * 4 · the line it feeds                                               *
 * ------------------------------------------------------------------ */

test('D376: a linked fund reads its vehicle\'s and GP\'s jurisdictions, and nothing else about them', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO entities (id, name, entity_type, jurisdiction, fabric_role, registration_number, registered_agent)
              VALUES (2, 'Harbor GP LLC', 'subsidiary', ' US-DE ', 'gp_entity', 'SYN-7001', 'Synthetic Agent Co')`).run();
  db.prepare(`INSERT INTO entities (id, name, entity_type, jurisdiction, fabric_role) VALUES (3, 'Harbor Fund I LP', 'vc_fund', '  ', 'fund_vehicle')`).run();
  db.prepare(`INSERT INTO entity_officers (uid, entity_id, name, title) VALUES ('o1', 2, 'Sam Officer', 'Director')`).run();
  let r: any = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.equal(r.entities_available, true);
  assert.equal(r.funds[0].jurisdiction, null, 'an unlinked fund was given a jurisdiction');
  assert.equal(r.funds[0].gp_entity_jurisdiction, null);

  db.prepare('UPDATE vc_funds SET gp_entity_id = 2, vehicle_entity_id = 3 WHERE id = 10').run();
  r = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.equal(r.funds[0].gp_entity_jurisdiction, 'US-DE');
  assert.equal(r.funds[0].jurisdiction, null, 'a vehicle with a blank jurisdiction was read as recording one');
  db.prepare(`UPDATE entities SET jurisdiction = 'KY' WHERE id = 3`).run();
  r = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.equal(r.funds[0].jurisdiction, 'KY');

  const text = JSON.stringify(r);
  for (const leak of ['Harbor Fund I LP', 'SYN-7001', 'Synthetic Agent', 'Sam Officer', 'Director', 'Harbor Holdings']) {
    assert.ok(!text.includes(leak), `the registry carries ${leak}`);
  }
});

test('D376: the entities unreadable leave each jurisdiction absent — unknown, not unrecorded', async () => {
  const db = freshDb();
  db.exec('DROP TABLE entities');
  const r: any = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.equal(r.entities_available, false);
  assert.match(r.entities_reason, /unknown rather than unrecorded/);
  assert.ok(!('jurisdiction' in r.funds[0]) && !('gp_entity_jurisdiction' in r.funds[0]));
  assert.equal(r.calls_available, true, 'the other reads were taken down with it');
});

test('D376: legal.ts no longer defines the create; it mounts the sub-app, and GET /entities keeps its scope', () => {
  const legal = read('cloudflare-worker/src/routes/legal.ts');
  assert.ok(!legal.includes("legal.post('/entities'"), 'two POST /entities handlers — the first registered wins');
  assert.match(legal, /import legalEntities from '\.\/legal_entities';/);
  assert.match(legal, /legal\.route\('\/', legalEntities\);/);
  assert.match(legal, /legal\.get\('\/entities', async \(c\) => \{\n\s+const user = await requireAuth\(c\);\n\s+const scope = entityListScope\(user\);/);
});
