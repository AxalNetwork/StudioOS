// D4362 (#4362): an admin customises the Founder, Investor, Advisor or Partner
// Studio they switch to, and the layout is the admin's own, keyed by (admin,
// profile). The routes already resolve `?profile=` for every read, save and
// reset (D1421); this file holds the reset to its profile and a member's own
// saved layout untouched by an admin's save and reset. Synthetic users only.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/studio_layout_admin_d4362.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import studio from '../src/routes/studio_layout.ts';
import { catalogueOf } from '../src/services/studioModules.ts';

const JWT_SECRET = randomBytes(32).toString('hex');
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../sql/migrations/687_studio_layouts.sql', import.meta.url), 'utf8');
// D1594 (#3863): the layout's revision.
const REVISION = readFileSync(new URL('../sql/migrations/750_studio_layout_revision.sql', import.meta.url), 'utf8');

const USERS: Array<[number, string, number]> = [
  [1, 'founder', 0], [2, 'investor', 0], [3, 'advisor', 0], [4, 'partner', 0],
  [5, 'admin', 0], [6, 'exploring', 0], [7, 'exploring', 1], [8, 'founder', 0],
];
function world() {
  const fx = makeD1(stripForeignKeys(tableFromBaseline(baseline, 'users')));
  fx.db.exec('PRAGMA foreign_keys=ON');
  fx.db.exec(MIGRATION);
  fx.db.exec(REVISION);
  for (const [id, role, lab] of USERS)
    fx.db.prepare('INSERT INTO users(id,name,email,role,is_active,spinout_lab_active) VALUES(?,?,?,?,1,?)').run(id, 'Synthetic', `s${id}@example.test`, role, lab);
  const env: any = { DB: fx.DB, JWT_SECRET, ENVIRONMENT: 'development' };
  return { ...fx, env };
}
const token = (id: number) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
  .sign(new TextEncoder().encode(JWT_SECRET));
async function call(env: any, id: number | null, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  // D1594: a save names the revision it was read at. These tests are about
  // validation, so a body that does not name one saves from a fresh read.
  if (method === 'PUT' && id !== null && body && typeof body === 'object' && !Array.isArray(body) && !('expected_revision' in body)) {
    const read = await call(env, id, path, 'GET');
    body = { ...body, expected_revision: read.body?.revision ?? null };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (id !== null) headers.authorization = `Bearer ${await token(id)}`;
  const res = await studio.fetch(new Request(`https://example.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json() as any };
}

const ADMIN = 5, FOUNDER = 1, INVESTOR = 2;
const layoutOf = (db: any, user: number, profile: string) => {
  const r = db.prepare('SELECT layout FROM studio_layouts WHERE user_id = ? AND profile = ?').get(user, profile) as any;
  return r ? JSON.parse(r.layout) : null;
};
const two = (profile: string) => catalogueOf(profile as any, { role: 'admin' } as any).slice(0, 2).map((m) => m.key);

test('an admin saves a layout per Studio, as their own row, and a member\'s saved layout is untouched', async () => {
  const w = world();
  try {
    const [f1, f2] = two('founder');
    const [i1] = two('investor');
    // The founder member's own layout, saved first.
    assert.equal((await call(w.env, FOUNDER, '/layout', 'PUT', { layout: [{ key: f2, size: 'full' }] })).status, 200);
    const mine = layoutOf(w.db, FOUNDER, 'founder');
    // The admin arranges the Founder Studio and the Investor Studio.
    const a = await call(w.env, ADMIN, '/layout?profile=founder', 'PUT', { layout: [{ key: f1, size: '1/2' }, { key: f2, size: '1/3' }] });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual([a.body.profile, a.body.source], ['founder', 'saved']);
    assert.equal((await call(w.env, ADMIN, '/layout?profile=investor', 'PUT', { layout: [{ key: i1, size: 'full' }] })).status, 200);
    // A second save updates the admin's row from its revision; the member's row is at the same revision and is not theirs.
    const again = await call(w.env, ADMIN, '/layout?profile=founder', 'PUT', { layout: [{ key: f1, size: '1/2' }, { key: f2, size: '1/3' }] });
    assert.deepEqual([again.status, again.body.revision], [200, 2]);
    const moved = await call(w.env, ADMIN, '/layout?profile=founder', 'PUT', { layout: [{ key: f2, size: '1/3' }, { key: f1, size: '1/2' }] });
    assert.deepEqual([moved.status, moved.body.revision], [200, 3]);
    await call(w.env, ADMIN, '/layout?profile=founder', 'PUT', { layout: [{ key: f1, size: '1/2' }, { key: f2, size: '1/3' }] });
    assert.deepEqual(layoutOf(w.db, ADMIN, 'founder'), [{ key: f1, size: '1/2' }, { key: f2, size: '1/3' }]);
    assert.deepEqual(layoutOf(w.db, ADMIN, 'investor'), [{ key: i1, size: 'full' }], 'each Studio is its own row');
    // A reload reads the admin's own layout back, per Studio.
    assert.deepEqual((await call(w.env, ADMIN, '/layout?profile=founder')).body.layout, [{ key: f1, size: '1/2' }, { key: f2, size: '1/3' }]);
    assert.deepEqual((await call(w.env, ADMIN, '/layout?profile=investor')).body.layout, [{ key: i1, size: 'full' }]);
    // The members are untouched: the founder keeps theirs, the investor still reads the default.
    assert.deepEqual(layoutOf(w.db, FOUNDER, 'founder'), mine);
    assert.deepEqual((await call(w.env, FOUNDER, '/layout')).body.layout, [{ key: f2, size: 'full' }]);
    assert.equal((await call(w.env, INVESTOR, '/layout')).body.source, 'default');
  } finally { w.db.close(); }
});

test('an admin\'s reset deletes only that Studio\'s row of theirs; no member row and no other Studio changes', async () => {
  const w = world();
  try {
    const [f1] = two('founder');
    const [i1] = two('investor');
    await call(w.env, FOUNDER, '/layout', 'PUT', { layout: [{ key: f1, size: 'full' }] });
    await call(w.env, ADMIN, '/layout?profile=founder', 'PUT', { layout: [{ key: f1, size: '1/3' }] });
    await call(w.env, ADMIN, '/layout?profile=investor', 'PUT', { layout: [{ key: i1, size: '1/2' }] });
    const r = await call(w.env, ADMIN, '/layout/reset?profile=founder', 'POST');
    assert.deepEqual([r.status, r.body.profile, r.body.source], [200, 'founder', 'default']);
    assert.equal(layoutOf(w.db, ADMIN, 'founder'), null);
    assert.deepEqual(layoutOf(w.db, ADMIN, 'investor'), [{ key: i1, size: '1/2' }], 'the admin\'s other Studio is kept');
    assert.deepEqual(layoutOf(w.db, FOUNDER, 'founder'), [{ key: f1, size: 'full' }], 'the member\'s row is kept');
    // A reset without a Studio named changes nothing.
    const bad = await call(w.env, ADMIN, '/layout/reset', 'POST');
    assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_profile']);
    assert.deepEqual(layoutOf(w.db, ADMIN, 'investor'), [{ key: i1, size: '1/2' }]);
  } finally { w.db.close(); }
});
