/**
 * D698 (#1660) — the Eadwyn AI rail's preferences on the Worker.
 *
 * Migration 465's `ai_rail_preferences` and the three routes in
 * `routes/ai.ts` that read and write it. The preferences belong to one member,
 * not to a venture, so the authorisation tests are caller-only tests: no route
 * takes a user id, and a member reads and writes their own rows alone.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/rail_prefs_d698.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import ai, { RAIL_PREFERENCE_CAP } from '../src/routes/ai.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
// The table exactly as migration 465 creates it: the test reads the file.
const MIGRATION_465 = readFileSync(new URL('../sql/migrations/465_ai_rail_preferences.sql', import.meta.url), 'utf8');

const JWT_SECRET = 'd698-s12-fixture-only-signing-secret-0123456789';
const A = 2, B = 3;
const SMALL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const BIG = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function world() {
  // `users` from the production baseline; its references to founders and
  // partners are not this test's subject, so they are stripped. Foreign keys
  // stay on, so 465's ON DELETE CASCADE is exercised for real.
  const { DB, db } = makeD1('PRAGMA foreign_keys=ON;' + stripForeignKeys(tableFromBaseline(BASELINE, 'users')) + ';');
  db.exec(MIGRATION_465);
  const add = db.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)');
  add.run(A, 'ana.founder@example.test', 'Ana Founder', 'founder');
  add.run(B, 'ben.founder@example.test', 'Ben Founder', 'founder');
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET };
  const rows = (user?: number) => db.prepare(
    `SELECT user_id, section, task, model, mode, created_at, updated_at FROM ai_rail_preferences
     ${user ? 'WHERE user_id = ' + Number(user) : ''} ORDER BY user_id, section, task`,
  ).all() as any[];
  return { env, db, rows };
}

const app = (() => {
  const a = new Hono();
  a.route('/api/ai', ai as any);
  // As index.ts's handler: a thrown 'Unauthorized' reads 401.
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(env: any, user: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (user !== null) {
    const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${tok}`;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/ai${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('1 · the table: 465 applies over the baseline and holds its constraints', () => {
  const { db, rows } = world();
  const ins = (user: number, section: string, task: string, model: string | null, mode: string | null) =>
    db.prepare('INSERT INTO ai_rail_preferences (uid, user_id, section, task, model, mode) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), user, section, task, model, mode);
  ins(A, 'validate', '', null, 'eadwyn');
  ins(A, 'validate', 'validate_tag_pains', SMALL, null);
  assert.throws(() => ins(A, 'validate', '', null, 'manual'), /UNIQUE/, 'a duplicate user, section and task fails');
  assert.throws(() => ins(A, 'grow', 'validate_tag_pains', null, 'eadwyn'), /CHECK/, 'a mode on a task row fails');
  assert.throws(() => ins(A, 'grow', '', SMALL, null), /CHECK/, "a model on a '' row fails");
  assert.throws(() => ins(A, 'grow', '', null, 'auto'), /CHECK/, "the mode 'auto' fails");
  assert.equal(rows(A).length, 2);
  db.prepare('DELETE FROM users WHERE id = ?').run(A);
  assert.equal(rows(A).length, 0, "deleting the user deletes their rows");
});

test('2 · caller only: each member reads their own rows, and signed out is 401 with nothing written', async () => {
  const { env, rows } = world();
  assert.equal((await call(env, A, 'PUT', '/rail-preferences/validate', { mode: 'eadwyn' })).status, 200);
  assert.equal((await call(env, A, 'PUT', '/rail-preferences/validate/validate_tag_pains', { model: SMALL })).status, 200);
  assert.equal((await call(env, B, 'PUT', '/rail-preferences/grow', { mode: 'manual' })).status, 200);
  assert.equal((await call(env, B, 'PUT', '/rail-preferences/validate/validate_draft_hypotheses', { model: BIG })).status, 200);

  const a = await call(env, A, 'GET', '/rail-preferences');
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, { ok: true, modes: { validate: 'eadwyn' }, models: { validate: { validate_tag_pains: SMALL } } });
  const b = await call(env, B, 'GET', '/rail-preferences');
  assert.deepEqual(b.body, { ok: true, modes: { grow: 'manual' }, models: { validate: { validate_draft_hypotheses: BIG } } });

  const before = JSON.stringify(rows());
  for (const [method, path, body] of [
    ['GET', '/rail-preferences', undefined],
    ['PUT', '/rail-preferences/research', { mode: 'eadwyn' }],
    ['PUT', '/rail-preferences/research/validate_tag_pains', { model: SMALL }],
  ] as const) {
    const res = await call(env, null, method, path, body);
    assert.equal(res.status, 401, `${method} ${path} signed out`);
  }
  assert.equal(JSON.stringify(rows()), before, 'nothing was written while signed out');
});

test('3 · no route takes a user id: B in the body or the query still writes A', async () => {
  const { env, rows } = world();
  await call(env, B, 'PUT', '/rail-preferences/validate', { mode: 'manual' });
  const bBefore = JSON.stringify(rows(B));
  assert.equal((await call(env, A, 'PUT', `/rail-preferences/validate?user_id=${B}`, { mode: 'eadwyn', user_id: B })).status, 200);
  assert.equal((await call(env, A, 'PUT', `/rail-preferences/validate/validate_tag_pains?user_id=${B}`, { model: SMALL, user_id: B })).status, 200);
  assert.deepEqual(rows(A).map((r) => [r.section, r.task, r.model, r.mode]), [
    ['validate', '', null, 'eadwyn'],
    ['validate', 'validate_tag_pains', SMALL, null],
  ]);
  assert.equal(JSON.stringify(rows(B)), bBefore, "B's rows are unchanged");
});

test('4 · mode writes: insert, update in place, delete on null, refuse anything else', async () => {
  const { env, db, rows } = world();
  assert.equal((await call(env, A, 'PUT', '/rail-preferences/validate', { mode: 'eadwyn' })).status, 200);
  assert.equal(rows(A).length, 1);
  db.prepare("UPDATE ai_rail_preferences SET updated_at = '2026-01-01 00:00:00'").run();
  assert.equal((await call(env, A, 'PUT', '/rail-preferences/validate', { mode: 'manual' })).status, 200);
  const [row] = rows(A);
  assert.equal(rows(A).length, 1, 'still one row');
  assert.equal(row.mode, 'manual');
  assert.notEqual(row.updated_at, '2026-01-01 00:00:00', 'updated_at moves');
  for (const bad of ['auto', '', 1, undefined]) {
    const res = await call(env, A, 'PUT', '/rail-preferences/grow', { mode: bad });
    assert.equal(res.status, 400, `mode ${JSON.stringify(bad)}`);
    assert.equal(res.body.error, 'invalid_mode');
  }
  assert.equal(rows(A).length, 1, 'a refused mode writes nothing');
  assert.equal((await call(env, A, 'PUT', '/rail-preferences/validate', { mode: null })).status, 200);
  assert.equal(rows(A).length, 0, 'null deletes the row');
});

test('5 · model writes: an offered alternate is stored, anything else is refused and writes nothing', async () => {
  const { env, rows } = world();
  assert.equal((await call(env, A, 'PUT', '/rail-preferences/validate/validate_tag_pains', { model: SMALL })).status, 200);
  assert.deepEqual(rows(A).map((r) => [r.task, r.model]), [['validate_tag_pains', SMALL]]);

  const off = await call(env, A, 'PUT', '/rail-preferences/validate/validate_tag_pains', { model: '@cf/openai/whisper' });
  assert.equal(off.status, 400);
  assert.equal(off.body.error, 'model_not_offered');
  assert.equal(rows(A)[0].model, SMALL, 'the refused model wrote nothing');

  for (const task of ['safety', 'no_such_task', '__proto__']) {
    const res = await call(env, A, 'PUT', `/rail-preferences/validate/${task}`, { model: SMALL });
    assert.equal(res.status, 400, task);
    assert.equal(res.body.error, 'task_not_pickable', task);
  }
  assert.equal(rows(A).length, 1);

  assert.equal((await call(env, A, 'PUT', '/rail-preferences/validate/validate_tag_pains', { model: null })).status, 200);
  assert.equal(rows(A).length, 0, 'null deletes the row');
});

test('6 · sections: decoded, trimmed, lower-cased and held to their charset', async () => {
  const { env, rows } = world();
  for (const bad of ['x'.repeat(61), '%20%20', '..%2Fx', 'a%3Bdrop']) {
    const res = await call(env, A, 'PUT', `/rail-preferences/${bad}`, { mode: 'eadwyn' });
    assert.equal(res.status, 400, bad);
    assert.equal(res.body.error, 'invalid_section', bad);
  }
  assert.equal((await call(env, A, 'PUT', `/rail-preferences/${encodeURIComponent('Perks & Products')}`, { mode: 'manual' })).status, 200);
  assert.equal((await call(env, A, 'PUT', '/rail-preferences/deck_review', { mode: 'eadwyn' })).status, 200);
  assert.equal((await call(env, A, 'PUT', `/rail-preferences/${'y'.repeat(60)}`, { mode: 'eadwyn' })).status, 200, '60 characters is allowed');
  assert.deepEqual(rows(A).map((r) => r.section).sort(), ['deck_review', 'perks & products', 'y'.repeat(60)].sort());
});

test('7 · the cap: past RAIL_PREFERENCE_CAP rows (1,000 since D764) a new key is 409, an existing key still updates', async () => {
  const { env, db, rows } = world();
  const ins = db.prepare("INSERT INTO ai_rail_preferences (uid, user_id, section, task, mode) VALUES (?, ?, ?, '', 'manual')");
  for (let i = 0; i < RAIL_PREFERENCE_CAP; i += 1) ins.run(crypto.randomUUID(), A, `section ${i}`);
  assert.equal(RAIL_PREFERENCE_CAP, 1000, "D764 raised it from 200 (D720 §6)");
  const full = await call(env, A, 'PUT', '/rail-preferences/one more', { mode: 'eadwyn' });
  assert.equal(full.status, 409);
  assert.equal(full.body.error, 'too_many_preferences');
  const model = await call(env, A, 'PUT', '/rail-preferences/one more/validate_tag_pains', { model: SMALL });
  assert.equal(model.status, 409, 'a model row is a new key too');
  assert.equal(rows(A).length, RAIL_PREFERENCE_CAP);
  const update = await call(env, A, 'PUT', '/rail-preferences/section 7', { mode: 'eadwyn' });
  assert.equal(update.status, 200, 'an update to an existing key still succeeds');
  assert.equal(rows(A).find((r) => r.section === 'section 7').mode, 'eadwyn');
  assert.equal((await call(env, B, 'PUT', '/rail-preferences/validate', { mode: 'eadwyn' })).status, 200, "the cap is per member");
});
