/**
 * D4661 (#4661) — a public Lab outcome read that could not be read says so.
 * Real routes over the migrated schema (node:sqlite); every value is invented.
 *
 *   · `/graduates`, `/stats`, `/cohort` and `/shipped` answered `[]` or zeros when D1
 *     failed, which a page draws as "no graduates", "0 companies", "no one in the
 *     sprint". A failed read is now a 503 with a code and our own sentence;
 *   · a read that worked and found nothing is still `[]` (or a measured zero);
 *   · a failed read of the application name a company falls back to is not "no
 *     name": the list is not shortened in silence, the read is unreadable;
 *   · the exception's text goes to the log, never into the body.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_outcome_reads_4661.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { graduate, insertRow } from './_lab_evidence.ts';
import spinoutLab from '../src/routes/spinout_lab.ts';

afterAll(() => removeMigratedDatabases());
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const GRAD = 501, NO_PROJECT = 502, ACTIVE = 503;
const SECRET = 'secret_internal_table_name';

function world(): DatabaseSync {
  const db = migratedDatabase();
  for (const [id, f] of [[GRAD, 5010], [NO_PROJECT, 5020], [ACTIVE, 5030]]) {
    db.prepare(`INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active, spinout_lab_week)
                VALUES (?, 'founder', 'Synthetic Founder', ?, 1, ?, ?, 1)`).run(id, `u${id}@example.test`, f, id === ACTIVE ? 1 : 0);
    db.prepare(`INSERT INTO spinout_lab_enrollments (user_id, kind) VALUES (?, 'legacy')`).run(id);
  }
  insertRow(db, 'projects', { id: 51, founder_id: 5010, name: 'Graduate Co' });
  insertRow(db, 'projects', { id: 53, founder_id: 5030, name: 'Active Co' });
  db.prepare(`UPDATE spinout_lab_enrollments SET project_id = 51 WHERE user_id = ?`).run(GRAD);
  db.prepare(`UPDATE spinout_lab_enrollments SET project_id = 53 WHERE user_id = ?`).run(ACTIVE);
  graduate(db, GRAD);
  return db;
}
const emptyWorld = (): DatabaseSync => {
  const db = migratedDatabase();
  return db;
};

/** A D1 whose statements matching `pattern` throw, as D1 does when it is unavailable. */
const failing = (db: DatabaseSync, pattern: RegExp) => {
  const real = d1Over(db);
  return { ...real, prepare: (sql: string) => { if (pattern.test(sql)) throw new Error(`D1_ERROR: no such table: ${SECRET}`); return real.prepare(sql); } };
};
async function get(db: any, path: string, who?: number) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const quiet = { warn: console.warn, error: console.error };
  console.warn = () => {}; console.error = () => {};
  try {
    const res = await spinoutLab.request(path, { headers }, { JWT_SECRET, ENVIRONMENT: 'development', DB: db } as any);
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  } finally { console.warn = quiet.warn; console.error = quiet.error; }
}
const readable = (db: DatabaseSync) => d1Over(db);

test('#4661 a read that worked still answers its data, an empty list or a measured zero', async () => {
  const db = world();
  try {
    const grads = await get(readable(db), '/graduates');
    assert.equal(grads.status, 200);
    assert.deepEqual(grads.body.map((g: any) => g.name), ['Graduate Co']);
    assert.deepEqual((await get(readable(db), '/stats')).body, { companies: 1, total_raised: null });
    const cohort = (await get(readable(db), '/cohort')).body;
    assert.deepEqual(cohort.map((m: any) => [m.name, m.status]).sort(), [['Active Co', 'active'], ['Graduate Co', 'graduated']]);
  } finally { db.close(); }
  const empty = emptyWorld();
  try {
    const grads = await get(readable(empty), '/graduates');
    assert.deepEqual([grads.status, grads.body], [200, []], 'none graduated: a measured empty list, not an error');
    assert.deepEqual(await get(readable(empty), '/stats'), { status: 200, body: { companies: 0, total_raised: null } }, 'a measured zero');
    assert.deepEqual(await get(readable(empty), '/cohort'), { status: 200, body: [] });
  } finally { empty.close(); }
});

test('#4661 a failed read is a 503 with a code and our sentence, never [] or zeros', async () => {
  const db = world();
  try {
    // Mutation checked: each catch back on `c.json([])` / zeros → the status assert fails.
    const cases: Array<[string, RegExp, string]> = [
      ['/graduates', /FROM spinout_lab_graduates/, 'The Lab’s graduates'],
      ['/stats', /FROM spinout_lab_graduates/, 'The Lab’s programme figures'],
      ['/cohort', /spinout_lab_active = 1/, 'The Lab’s cohort'],
      ['/cohort', /FROM spinout_lab_graduates/, 'The Lab’s cohort'],
    ];
    for (const [path, pattern, what] of cases) {
      const r = await get(failing(db, pattern), path);
      assert.equal(r.status, 503, `${path} (${pattern}) must not answer 200`);
      assert.equal(r.body.error, 'lab_outcomes_unreadable');
      assert.equal(r.body.message, `${what} could not be read just now. Try again in a moment.`);
      assert.equal(JSON.stringify(r.body).includes(SECRET), false, 'the exception text goes to the log, not the body');
    }
    // The signed-in feed too.
    const shipped = await get(failing(db, /FROM spinout_lab_milestones m/), '/shipped', ACTIVE);
    assert.deepEqual([shipped.status, shipped.body?.error], [503, 'lab_outcomes_unreadable']);
  } finally { db.close(); }
});

test('#4661 a failed read of the application name is not "no name": the list is unreadable, not shorter', async () => {
  const db = world();
  try {
    // A graduate and an active member whose only name is on their application.
    db.prepare(`UPDATE spinout_lab_enrollments SET project_id = NULL WHERE user_id = ?`).run(GRAD);
    db.prepare(`UPDATE projects SET deleted_at = datetime('now') WHERE id IN (51, 53)`).run();
    insertRow(db, 'spinout_applications', { user_id: GRAD, company_name: 'Application Grad Co' });
    insertRow(db, 'spinout_applications', { user_id: ACTIVE, company_name: 'Application Active Co' });
    assert.deepEqual((await get(readable(db), '/graduates')).body.map((g: any) => g.name), ['Application Grad Co'], 'the fallback works when it can be read');
    assert.deepEqual((await get(readable(db), '/cohort')).body.map((m: any) => m.name).sort(), ['Application Active Co', 'Application Grad Co']);
    // D4663: the fallback is a subquery of the one bounded read, so the read fails whole.
    const down = failing(db, /FROM spinout_applications/);
    for (const path of ['/graduates', '/cohort']) {
      const r = await get(down, path);
      assert.equal(r.status, 503, `${path}: a graduate dropped because its name could not be read must not read as "no graduates"`);
      assert.equal(r.body.error, 'lab_outcomes_unreadable');
    }
  } finally { db.close(); }
});

test('#4661/D4663 a company named by its venture keeps that name; the application is only the fallback', async () => {
  const db = world();
  try {
    // D4663 folded the per-row application read into the bounded statement (COALESCE, so it is
    // evaluated only for a row with no venture name). A venture's name always wins.
    insertRow(db, 'spinout_applications', { user_id: GRAD, company_name: 'Not This Grad Name' });
    insertRow(db, 'spinout_applications', { user_id: ACTIVE, company_name: 'Not This Active Name' });
    assert.deepEqual((await get(readable(db), '/graduates')).body.map((g: any) => g.name), ['Graduate Co']);
    assert.deepEqual((await get(readable(db), '/cohort')).body.map((m: any) => m.name).sort(), ['Active Co', 'Graduate Co']);
  } finally { db.close(); }
});
