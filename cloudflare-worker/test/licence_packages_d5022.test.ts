/**
 * D5022 (#5022, part 1 of #5021) — the versioned package catalogue: `program_packages` and
 * `program_package_items` (migration 202611091023), and the HQ-only `/api/admin/licence-packages` routes.
 *
 * Real SQLite over every migration (`_schema_once.mjs`), the real router. What is pinned is what the issue's
 * acceptance criteria name:
 *   · the seed holds exactly the four v1 packages the issue specifies, with their correct commercial figures
 *     and composition, Full Axal VC's pinned ten programs included;
 *   · `package_key` + `version` is unique, and no package uses a display label as its key;
 *   · an active version is immutable — at the route, and at the database, for its fields AND its composition;
 *   · publishing a draft retires the key's previous active version in one step; a retire changes no other
 *     table's row (the scoping boundary: no licence-to-package link exists yet, D5022 §1);
 *   · only the Super Admin write bar's writes succeed; reads need Super Admin; a branch is refused outright.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_packages_d5022.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import packages, { mount } from '../src/routes/admin_licence_packages.ts';
import { PROGRAM_KEYS } from '../src/services/programRegistry.ts';

const SECRET = ['d5022', 'packages', 'fixture', 'signing', 'secret'].join('-');
const SUPER = 1, SUPER_PW = 2, ADMIN = 3;
const P = '/api/admin/licence-packages';

const FULL_AXAL_VC = [
  'spinout-lab', 'ai-native-venture', 'mentor-cohorts', 'investor-cohorts', 'referral-partners',
  'refer-and-earn', 'perks', 'learning', 'product-testing', 'influencer',
];

const NEW_ITEMS = (keys: string[]) => keys.map((program_key) => ({ program_key }));

const INPUT = (over: Record<string, unknown> = {}) => ({
  name: 'Test Package', description: 'a fixture package', currency: 'EUR',
  base_annual_fee_cents: 2000000, guidance_min_cents: 1800000, guidance_max_cents: 2200000,
  effective_from: '2026-12-01',
  items: NEW_ITEMS(['learning']),
  ...over,
});

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, SUPER_PW, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${SUPER_PW})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now'))");
  s.run(SUPER, 'totp-super', 'totp');
  s.run(SUPER_PW, 'pw-super', 'password');
  s.run(ADMIN, 'totp-3', 'totp');
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  for (const m of (Array.isArray(mount) ? mount : [mount])) app.route(m.path, m.router);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403, 'TOTP required': 403, step_up_required: 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  async function call(who: number, method: string, path: string, body?: unknown) {
    const jti = who === SUPER ? 'totp-super' : who === SUPER_PW ? 'pw-super' : `totp-${who}`;
    const token = await new SignJWT({ user_id: who, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error] = saved; }
  }
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  return { db, env, call, all };
}

test('the seed holds exactly the four v1 packages with their commercial figures and composition', async () => {
  const { call } = fixture();
  const list = await call(SUPER, 'GET', P);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(
    list.body.packages.map((p: any) => [p.package_key, p.version, p.status]).sort(),
    [['core_network', 1, 'active'], ['full_axal_vc', 1, 'active'], ['talent_learning', 1, 'active'], ['venture_building', 1, 'active']],
  );

  const core = (await call(SUPER, 'GET', `${P}/core_network`)).body.package;
  assert.equal(core.base_annual_fee_cents, 1000000);
  assert.deepEqual([core.guidance_min_cents, core.guidance_max_cents], [800000, 1200000]);
  assert.deepEqual(core.items.map((i: any) => i.program_key), ['referral-partners', 'refer-and-earn', 'perks', 'influencer']);

  const talent = (await call(SUPER, 'GET', `${P}/talent_learning`)).body.package;
  assert.equal(talent.base_annual_fee_cents, 1500000);
  assert.deepEqual([talent.guidance_min_cents, talent.guidance_max_cents], [1200000, 1800000]);
  assert.deepEqual(talent.items.map((i: any) => i.program_key), ['learning', 'mentor-cohorts', 'investor-cohorts']);

  const venture = (await call(SUPER, 'GET', `${P}/venture_building`)).body.package;
  assert.equal(venture.base_annual_fee_cents, 3750000);
  assert.deepEqual([venture.guidance_min_cents, venture.guidance_max_cents], [3000000, 4500000]);
  assert.deepEqual(venture.items.map((i: any) => i.program_key), ['spinout-lab', 'ai-native-venture', 'product-testing']);

  const full = (await call(SUPER, 'GET', `${P}/full_axal_vc`)).body.package;
  assert.equal(full.base_annual_fee_cents, 5250000);
  assert.deepEqual([full.guidance_min_cents, full.guidance_max_cents], [4500000, 6000000]);
  // Pinned, not a dynamic "every program" read: the exact ten PROGRAM_KEYS, as of this migration.
  assert.deepEqual(full.items.map((i: any) => i.program_key), FULL_AXAL_VC);
  assert.deepEqual([...PROGRAM_KEYS].sort(), [...FULL_AXAL_VC].sort(), 'the registry has not grown since this fixture was written');

  assert.equal((await call(SUPER, 'GET', `${P}/not_a_real_key`)).status, 404);
});

test('package_key + version is unique, and a stable key is the join, never a display label', async () => {
  const { db, call } = fixture();
  assert.throws(
    () => db.prepare(`INSERT INTO program_packages (uid, package_key, version, name, status, currency, base_annual_fee_cents, effective_from, created_at)
      VALUES ('dup', 'core_network', 1, 'Core Network Duplicate', 'draft', 'EUR', 1, '2027-01-01', datetime('now'))`).run(),
    /UNIQUE/,
  );
  // The route's own create path refuses a key already taken, long before the database would.
  const taken = await call(SUPER, 'POST', P, { package_key: 'core_network', ...INPUT() });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, 'package_key_taken');
  // Items are joined on program_key, a registry key — never on a program's display name.
  const badItem = await call(SUPER, 'POST', P, { package_key: 'new_pkg', ...INPUT({ items: NEW_ITEMS(['Learning Programme']) }) });
  assert.equal(badItem.status, 400);
  assert.equal(badItem.body.error, 'invalid_package');
  assert.match(badItem.body.fields.items, /not a program key/);
});

test('an active version is immutable — at the route and at the database — for its fields and its composition', async () => {
  const { db, call } = fixture();
  const created = await call(SUPER, 'POST', P, { package_key: 'new_pkg', ...INPUT() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.package.status, 'draft');
  assert.equal(created.body.package.version, 1);

  // A draft may be edited freely.
  const edited = await call(SUPER, 'PUT', `${P}/new_pkg/versions/1`, INPUT({ base_annual_fee_cents: 2100000, items: NEW_ITEMS(['learning', 'perks']) }));
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.package.base_annual_fee_cents, 2100000);
  assert.deepEqual(edited.body.package.items.map((i: any) => i.program_key), ['learning', 'perks']);

  assert.equal((await call(SUPER, 'POST', `${P}/new_pkg/versions/1/publish`, {})).body.error, 'reason_required');
  const pub = await call(SUPER, 'POST', `${P}/new_pkg/versions/1/publish`, { reason: 'Launch new_pkg' });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.package.status, 'active');
  assert.equal(pub.body.retired_version, null, 'no prior active version of this key');

  // The route refuses editing an active version before the database ever would.
  const refused = await call(SUPER, 'PUT', `${P}/new_pkg/versions/1`, INPUT({ base_annual_fee_cents: 1 }));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'package_version_immutable');

  // The database refuses it too, whoever writes: commercial fields, status resurrection, and composition alike.
  const uid = (db.prepare("SELECT uid FROM program_packages WHERE package_key = 'new_pkg' AND version = 1").get() as any).uid;
  assert.throws(() => db.prepare('UPDATE program_packages SET base_annual_fee_cents = 1 WHERE uid = ?').run(uid), /program_package_immutable/);
  assert.throws(() => db.prepare("UPDATE program_packages SET status = 'draft' WHERE uid = ?").run(uid), /program_package_immutable/);
  assert.throws(() => db.prepare('DELETE FROM program_packages WHERE uid = ?').run(uid), /program_package_immutable/);
  assert.throws(() => db.prepare("UPDATE program_package_items SET position = 99 WHERE package_uid = ? AND program_key = 'learning'").run(uid), /program_package_immutable/);
  assert.throws(() => db.prepare("INSERT INTO program_package_items (package_uid, program_key, position) VALUES (?, 'influencer', 9)").run(uid), /program_package_immutable/);
  assert.throws(() => db.prepare('DELETE FROM program_package_items WHERE package_uid = ?').run(uid), /program_package_immutable/);

  // Publishing a second version retires the first in one step: never two active versions of one key.
  const v2 = await call(SUPER, 'POST', `${P}/new_pkg/versions`, INPUT({ base_annual_fee_cents: 2500000 }));
  assert.equal(v2.status, 201, JSON.stringify(v2.body));
  assert.equal(v2.body.package.version, 2);
  const pub2 = await call(SUPER, 'POST', `${P}/new_pkg/versions/2/publish`, { reason: 'Repricing' });
  assert.equal(pub2.body.retired_version, 1);
  const versions = (await call(SUPER, 'GET', `${P}/new_pkg/versions`)).body.versions;
  assert.deepEqual(versions.map((v: any) => [v.version, v.status]), [[2, 'active'], [1, 'retired']]);
  assert.throws(() => db.prepare("UPDATE program_packages SET status = 'active' WHERE uid = ?").run(uid), /program_package_immutable/, 'a retired version never comes back');

  // Every write was audited with its reason.
  const audited = db.prepare("SELECT action, filters_json FROM admin_audit_log WHERE action LIKE 'licence_package_%' ORDER BY id").all() as any[];
  assert.deepEqual(audited.map((r) => r.action), ['licence_package_drafted', 'licence_package_edited', 'licence_package_published', 'licence_package_drafted', 'licence_package_published']);
  assert.equal(JSON.parse(audited[2].filters_json).reason, 'Launch new_pkg');
});

test('retiring a package changes no other row — the only honest answer while no licence can hold one yet', async () => {
  const { call, all } = fixture();
  const before = {
    licences: all('SELECT * FROM territory_licences'),
    other_packages: all("SELECT * FROM program_packages WHERE package_key <> 'core_network'"),
    agreements: all('SELECT * FROM licence_program_agreements'),
  };
  const retired = await call(SUPER, 'POST', `${P}/core_network/versions/1/retire`, { reason: 'Discontinuing Core Network' });
  assert.equal(retired.status, 200, JSON.stringify(retired.body));
  assert.equal(retired.body.package.status, 'retired');
  assert.deepEqual(
    { licences: all('SELECT * FROM territory_licences'), other_packages: all("SELECT * FROM program_packages WHERE package_key <> 'core_network'"), agreements: all('SELECT * FROM licence_program_agreements') },
    before,
  );
  // A second retire on the now-retired version is refused, not a silent no-op.
  assert.equal((await call(SUPER, 'POST', `${P}/core_network/versions/1/retire`, { reason: 'again' })).status, 409);
  // core_network now has no active version: the default listing drops it, but ?all=1 still shows its history.
  const active = (await call(SUPER, 'GET', P)).body.packages;
  assert.ok(!active.some((p: any) => p.package_key === 'core_network'));
  const everything = (await call(SUPER, 'GET', `${P}?all=1`)).body.packages;
  assert.ok(everything.some((p: any) => p.package_key === 'core_network' && p.status === 'retired'));
  assert.equal((await call(SUPER, 'GET', `${P}/core_network`)).status, 404, 'no active version to read as the default');
});

test('publishing a draft with no items is refused, and an unpublished draft may be deleted', async () => {
  const { call } = fixture();
  const noItems = await call(SUPER, 'POST', P, { package_key: 'empty_pkg', ...INPUT({ items: [] }) });
  assert.equal(noItems.status, 400);
  assert.equal(noItems.body.error, 'invalid_package');

  const ok = await call(SUPER, 'POST', P, { package_key: 'empty_pkg', ...INPUT() });
  assert.equal(ok.status, 201);
  // Deleting a draft needs a reason too, and only works on a draft.
  assert.equal((await call(SUPER, 'DELETE', `${P}/empty_pkg/versions/1`, {})).body.error, 'reason_required');
  const del = await call(SUPER, 'DELETE', `${P}/empty_pkg/versions/1`, { reason: 'wrong idea' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await call(SUPER, 'GET', `${P}/empty_pkg/versions`)).status, 404);
});

test('Super Admin only; writes need the write bar (TOTP session and recent step-up); a branch is refused', async () => {
  const { call, env } = fixture();
  assert.equal((await call(ADMIN, 'GET', P)).status, 403, 'a plain admin is refused');
  assert.equal((await call(SUPER_PW, 'GET', P)).status, 200, 'reads need Super Admin only');
  const w = await call(SUPER_PW, 'POST', P, { package_key: 'blocked_pkg', ...INPUT() });
  assert.ok(w.status === 401 || w.status === 403, `a password session cannot write: ${w.status}`);
  assert.equal((await call(ADMIN, 'POST', `${P}/core_network/versions/1/retire`, { reason: 'x' })).status, 403);

  // A branch deployment is refused outright, same as every other HQ-only route (D106).
  const app = new Hono<any>();
  for (const m of (Array.isArray(mount) ? mount : [mount])) app.route(m.path, m.router);
  app.onError((err: any, c) => c.json({ detail: err.message }, 403));
  const token = await new SignJWT({ user_id: SUPER, jti: 'totp-super' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await withThrownResponses(() => app.request(P, { headers: { Authorization: `Bearer ${token}` } }, { ...env, BRANCH_CODE: 'paris' } as any));
  assert.equal(res.status, 403);

  assert.equal(packages, (Array.isArray(mount) ? mount[0] : mount).router);
});
