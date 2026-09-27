/**
 * D325 — GET /api/assessment/xp/me, the archetype card's Level / XP bar.
 *
 * The schema is built from the migrations that ship (107 and 108, which
 * declares user_xp), so a passing test is a test of production's table.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import assessment, { xpStanding } from '../src/routes/assessment.ts';
import { levelForXp } from '../src/services/assessmentScoring.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIG = (n: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', n), 'utf8');

function makeD1(db: InstanceType<typeof DatabaseSync>, opts: { failXp?: boolean } = {}) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
      async first() {
        if (opts.failXp && /FROM user_xp/.test(sql)) throw new Error('D1_ERROR: no such table: user_xp (SQLITE_ERROR)');
        return db.prepare(sql).get(...b) ?? null;
      },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x || []) out.push(await s.run()); return out; },
  };
}

function harness(opts: { failXp?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER);`);
  for (const m of ['107_assessment_engine.sql', '108_assessment_play.sql']) db.exec(MIG(m));
  db.prepare('INSERT INTO users (id, role, email) VALUES (?,?,?)').run(1, 'founder', 'a@example.test');
  db.prepare('INSERT INTO users (id, role, email) VALUES (?,?,?)').run(2, 'partner', 'b@example.test');
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, opts) };
  const call = async (who: number | null) => {
    const headers: Record<string, string> = {};
    if (who != null) {
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: who === 1 ? 'founder' : 'partner' })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
        .sign(new TextEncoder().encode(JWT_SECRET))}`;
    }
    const res = await assessment.request('/xp/me', { method: 'GET', headers }, env);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { db, call };
}

test('xpStanding derives the level from the total with the engine curve, and the band around it', () => {
  assert.deepEqual(xpStanding(340, '2026-09-01 10:00:00', true), {
    recorded: true, xp: 340, level: 2, level_floor: 100, next_level_xp: 400, updated_at: '2026-09-01 10:00:00',
  });
  for (const xp of [0, 99, 100, 399, 400, 900, 12345]) {
    const s = xpStanding(xp, null, true);
    assert.equal(s.level, levelForXp(xp), `level at ${xp}`);
    assert.ok(s.level_floor <= xp && xp < s.next_level_xp, `${xp} sits inside [${s.level_floor}, ${s.next_level_xp})`);
  }
});

test('xpStanding never reports a negative or fractional total', () => {
  assert.equal(xpStanding(-5, null, true).xp, 0);
  assert.equal(xpStanding(Number.NaN, null, true).xp, 0);
  assert.equal(xpStanding(250.9, null, true).xp, 250);
});

test("GET /xp/me reads the caller's row, and derives the level rather than trusting the stored column", async () => {
  const { db, call } = harness();
  // A concurrent award can leave `level` a step behind the total (eventBadges.ts).
  db.prepare("INSERT INTO user_xp (user_id, xp, level, updated_at) VALUES (1, 950, 3, '2026-09-20 08:00:00')").run();
  db.prepare("INSERT INTO user_xp (user_id, xp, level) VALUES (2, 50, 1)").run();
  const r = await call(1);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    recorded: true, xp: 950, level: 4, level_floor: 900, next_level_xp: 1600, updated_at: '2026-09-20 08:00:00',
  });
});

test('GET /xp/me with no row is the engine default, and says it was not recorded', async () => {
  const { call } = harness();
  const r = await call(1);
  assert.equal(r.status, 200);
  assert.equal(r.body.recorded, false);
  assert.equal(r.body.xp, 0);
  assert.equal(r.body.level, 1);
  assert.equal(r.body.next_level_xp, 100);
});

test("GET /xp/me reads only the caller's own row", async () => {
  const { db, call } = harness();
  db.prepare("INSERT INTO user_xp (user_id, xp, level) VALUES (2, 5000, 8)").run();
  const r = await call(1);
  assert.equal(r.body.recorded, false, "user 2's row is not user 1's");
  assert.equal(r.body.xp, 0);
});

test('GET /xp/me without a session is a 401', async () => {
  const { call } = harness();
  const r = await call(null);
  assert.equal(r.status, 401);
});

test('a failed read is a refusal with our sentence, and the SQLite text stays out of it', async () => {
  const { call } = harness({ failXp: true });
  const r = await call(1);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'xp_unreadable');
  assert.match(r.body.message, /could not be read/);
  assert.equal(r.body.detail, r.body.message);
  assert.doesNotMatch(JSON.stringify(r.body), /SQLITE|D1_ERROR|no such table/);
  assert.equal(r.body.xp, undefined, 'a failed read carries no figure');
});
