/**
 * D4663 (#4663, owner decision A) — the scheduled certificate backfill, over
 * the migrated schema (node:sqlite). Every value is invented; nothing here
 * reaches a deployed database.
 *
 *   · a graduate whose credential and bonus were lost gets both back once, and
 *     the second tick does nothing;
 *   · a tick takes at most its limit, says when more are due, and the next
 *     ticks drain the rest;
 *   · a graduate who cannot be issued does not hold the queue and is tried
 *     again only after the retry interval;
 *   · a revoked credential is never replaced; a suspended branch, or one whose
 *     programs cannot be read, issues nothing and records why;
 *   · what it did is recorded, and the admin read says "not recorded" before
 *     any tick, never "0 issued", and "unreadable" when the read fails;
 *   · the cron calls it after the Lab reconcile tick, inside its own catch.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_certificate_backfill_tick_4663.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { graduate } from './_lab_evidence.ts';
import certificates from '../src/routes/spinout_certificates.ts';
import {
  CERT_BACKFILL_RETRY_MS, CERT_BACKFILL_TICK_LIMIT, readCertificateBackfillState, runCertificateBackfillTick,
} from '../src/services/certificateIssuance.ts';
import { creditLabMilestone } from '../src/services/labMilestoneCredits.ts';

afterAll(() => removeMigratedDatabases());
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIG381 = readFileSync(new URL('../sql/migrations/381_credit_reward_rules.sql', import.meta.url), 'utf8');
const ADMIN = 900;
const T0 = Date.parse('2026-11-09T12:00:00Z');
const MIN = 60_000;

function world(): DatabaseSync {
  const db = migratedDatabase();
  for (const st of MIG381.split(/;\s*\n/).filter((x) => /INSERT/i.test(x))) db.exec(st);
  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Synthetic Admin', 'admin@example.test', 1)`).run(ADMIN);
  return db;
}
/** A graduate by the rule, admitted, with the incorporation grant paid and no credential. */
async function graduateWithoutCredential(db: DatabaseSync, id: number, name = `Synthetic Graduate ${id}`) {
  db.prepare(`INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active, spinout_lab_started_at)
              VALUES (?, 'founder', ?, ?, 1, ?, 0, '2026-09-01 05:00:00')`).run(id, name, `u${id}@example.test`, id);
  db.prepare(`INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, 1, 'Synthetic Cohort 3')`).run(id);
  graduate(db, id);
  await quiet(() => creditLabMilestone(envOf(db), id, 'incorporation_completed'));
}

const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}, DB: any = d1Over(db)) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB, ...extra }) as any;
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.info = i; }
};
const tick = (db: DatabaseSync, nowMs: number, extra: Record<string, unknown> = {}, limit?: number) =>
  quiet(() => runCertificateBackfillTick(envOf(db, extra), { nowMs, limit }));
const all = (db: DatabaseSync, sql: string, ...a: unknown[]) => (db.prepare(sql).all(...(a as never[])) as any[]).map((r) => ({ ...r }));
const issuedTo = (db: DatabaseSync) => all(db, `SELECT user_id FROM spinout_certificates WHERE status = 'issued' ORDER BY user_id`).map((r) => r.user_id);
const bonuses = (db: DatabaseSync) => all(db, `SELECT user_id FROM perk_credit_ledger WHERE kind = 'grant' AND source_ref LIKE 'lab:%:graduation' ORDER BY user_id`).map((r) => r.user_id);
const attempts = (db: DatabaseSync) => all(db, `SELECT user_id, attempts, last_outcome, bonus_outcome, issued_at FROM spinout_certificate_backfill_attempts ORDER BY user_id`);

async function adminGet(db: DatabaseSync, DB?: any) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await quiet(() => certificates.request('/certificates', { headers: { Authorization: `Bearer ${token}` } }, envOf(db, {}, DB)));
  return { status: res.status, body: (await res.json()) as any };
}

// Mutation checked: the tick's `issueOnGraduation` replaced by a no-op (nothing issued: fails);
// `creditLabGraduation` dropped from the tick (no bonus: fails). The candidate read without
// `NOT EXISTS (… spinout_certificates …)` is caught by the retry and revoked-credential tests.
test('#4663 a lost credential and its bonus are restored once; the second tick does nothing', async () => {
  const db = world();
  try {
    await graduateWithoutCredential(db, 11);
    const first = await tick(db, T0);
    assert.deepEqual(first, { status: 'done', scanned: 1, issued: 1, skipped: 0, more_waiting: false });
    assert.deepEqual(issuedTo(db), [11]);
    assert.deepEqual(bonuses(db), [11]);
    assert.deepEqual(attempts(db), [{ user_id: 11, attempts: 1, last_outcome: 'issued', bonus_outcome: 'granted', issued_at: '2026-11-09 12:00:00' }]);
    const again = await tick(db, T0 + MIN);
    assert.deepEqual(again, { status: 'done', scanned: 0, issued: 0, skipped: 0, more_waiting: false });
    assert.deepEqual([issuedTo(db), bonuses(db)], [[11], [11]], 'nothing issued or paid twice');
    assert.equal(attempts(db)[0].attempts, 1, 'the second tick tried nobody');
    // An automatic issue is attributed to nobody, as the live path's is.
    assert.equal(all(db, 'SELECT issued_by_user_id AS by FROM spinout_certificates')[0].by, null);
  } finally { db.close(); }
});

// Mutation checked: `LIMIT ?` bound to 1000 (the candidate read returns all five: fails);
// `more_waiting` computed as false (fails).
test('#4663 a tick takes at most its limit, says more are due, and the next ticks drain the rest', async () => {
  const db = world();
  try {
    assert.equal(CERT_BACKFILL_TICK_LIMIT, 3, 'the owner chose three per tick');
    for (const id of [21, 22, 23, 24, 25]) await graduateWithoutCredential(db, id);
    // The bound is SQL's: the candidate read returns the limit plus one row, not every graduate waiting.
    const real = d1Over(db);
    const read: number[] = [];
    const counting = { ...real, prepare: (sql: string) => {
      const st = real.prepare(sql);
      if (!/FROM spinout_lab_graduates g/.test(sql)) return st;
      return { bind: (...a: unknown[]) => { const b = st.bind(...a); return { all: async () => { const r = await b.all(); read.push((r.results || []).length); return r; } }; } };
    } };
    const a = await quiet(() => runCertificateBackfillTick(envOf(db, {}, counting), { nowMs: T0 }));
    assert.deepEqual(read, [CERT_BACKFILL_TICK_LIMIT + 1]);
    assert.deepEqual([a.scanned, a.issued, a.more_waiting], [3, 3, true]);
    assert.deepEqual(issuedTo(db), [21, 22, 23]);
    const b = await tick(db, T0 + MIN);
    assert.deepEqual([b.scanned, b.issued, b.more_waiting], [2, 2, false]);
    const c = await tick(db, T0 + 2 * MIN);
    assert.deepEqual([c.scanned, c.issued], [0, 0]);
    assert.deepEqual(issuedTo(db), [21, 22, 23, 24, 25]);
    assert.deepEqual(bonuses(db), [21, 22, 23, 24, 25]);
    // A limit beyond ten is clamped.
    const db2 = world();
    try {
      for (let id = 31; id <= 43; id += 1) await graduateWithoutCredential(db2, id);
      assert.equal((await tick(db2, T0, {}, 50)).scanned, 10);
    } finally { db2.close(); }
  } finally { db.close(); }
});

// Mutation checked: the retry-interval condition dropped (the nameless graduate is tried again a
// minute later: fails); untried-first ordering dropped (`ORDER BY g.user_id` only: the due retry
// takes a place before the three new graduates: fails).
test('#4663 a graduate who cannot be issued does not hold the queue, and is retried after the interval', async () => {
  const db = world();
  try {
    await graduateWithoutCredential(db, 20, ''); // no name on record: insufficient_data
    for (const id of [21, 22, 23, 24]) await graduateWithoutCredential(db, id);
    const a = await tick(db, T0);
    assert.deepEqual([a.scanned, a.issued, a.skipped], [3, 2, 1]);
    const b = await tick(db, T0 + MIN);
    assert.deepEqual([b.scanned, b.issued, b.skipped], [2, 2, 0], 'the nameless graduate is not tried again a minute later');
    assert.deepEqual(issuedTo(db), [21, 22, 23, 24]);
    assert.equal((await tick(db, T0 + CERT_BACKFILL_RETRY_MS - MIN)).scanned, 0);
    // Due again, but graduates never tried go first.
    for (const id of [26, 27, 28]) await graduateWithoutCredential(db, id);
    const fresh = await tick(db, T0 + CERT_BACKFILL_RETRY_MS);
    assert.deepEqual([fresh.scanned, fresh.issued, fresh.more_waiting], [3, 3, true]);
    assert.deepEqual(issuedTo(db), [21, 22, 23, 24, 26, 27, 28]);
    const retry = await tick(db, T0 + CERT_BACKFILL_RETRY_MS + MIN);
    assert.deepEqual([retry.scanned, retry.skipped], [1, 1]);
    db.prepare(`UPDATE users SET name = 'Named Later' WHERE id = 20`).run();
    assert.equal((await tick(db, T0 + CERT_BACKFILL_RETRY_MS + 2 * MIN)).scanned, 0, 'still inside its new interval');
    const later = await tick(db, T0 + 2 * CERT_BACKFILL_RETRY_MS + MIN);
    assert.deepEqual([later.scanned, later.issued], [1, 1]);
    const row = attempts(db).find((r) => r.user_id === 20);
    assert.deepEqual([row.attempts, row.last_outcome, row.bonus_outcome], [3, 'issued', 'granted']);
  } finally { db.close(); }
});

// Mutation checked: the candidate read restricted to `c.status = 'issued'` (as the admin backfill
// is) — the revoked graduate is picked and reported reissue_blocked/issued: fails.
test('#4663 a revoked credential is never replaced by the scheduled backfill', async () => {
  const db = world();
  try {
    await graduateWithoutCredential(db, 51);
    await tick(db, T0);
    db.prepare(`UPDATE spinout_certificates SET status = 'revoked', revoked_at = '2026-11-09 13:00:00' WHERE user_id = 51`).run();
    // Even with a different cohort (so a new credential id would not collide), nothing is issued.
    db.prepare(`UPDATE user_spinout_flags SET spinout_lab_cohort = 'Synthetic Cohort 4' WHERE user_id = 51`).run();
    const r = await tick(db, T0 + CERT_BACKFILL_RETRY_MS + MIN);
    assert.equal(r.scanned, 0);
    assert.deepEqual(issuedTo(db), []);
  } finally { db.close(); }
});

// Mutation checked: the suspension check removed (the frozen branch issues: fails); a 503 refusal
// read as "not granted" (status string differs: fails).
test('#4663 a suspended branch, or one whose programs cannot be read, issues nothing and records why', async () => {
  const db = world();
  try {
    await graduateWithoutCredential(db, 61);
    db.prepare(`INSERT INTO branch_licence (id, licence_uid, status, pushed_at) VALUES (1, 'lic-synthetic', 'suspended', '2026-11-01 00:00:00')`).run();
    const frozen = await tick(db, T0, { BRANCH_CODE: 'fr' });
    assert.deepEqual(frozen, { status: 'frozen', scanned: 0, issued: 0, skipped: 0, more_waiting: false });
    db.prepare(`UPDATE branch_licence SET status = 'active', program_grants_json = 'not json' WHERE id = 1`).run();
    const unreadable = await tick(db, T0 + MIN, { BRANCH_CODE: 'fr' });
    assert.equal(unreadable.status, 'grants_unreadable');
    assert.deepEqual([issuedTo(db), attempts(db)], [[], []]);
    const state = await readCertificateBackfillState(envOf(db));
    assert.deepEqual([state.last_tick?.status, state.last_tick?.ran_at], ['grants_unreadable', '2026-11-09 12:01:00']);
    // HQ (no branch code) is not gated.
    assert.equal((await tick(db, T0 + 2 * MIN)).issued, 1);
  } finally { db.close(); }
});

// Mutation checked: `last_tick` defaulted to a zero tick when no row exists (the first assertion
// fails); the read's catch removed (the route 500s instead of naming the unreadable part).
test('#4663 the admin read says "not recorded" before any tick, what the tick did after, and "unreadable" on failure', async () => {
  const db = world();
  try {
    await graduateWithoutCredential(db, 70, '');
    await graduateWithoutCredential(db, 71);
    const before = await adminGet(db);
    assert.equal(before.status, 200);
    assert.deepEqual(before.body.scheduled_backfill, { last_tick: null, not_issued: {} });
    assert.equal(before.body.unavailable.scheduled_backfill, undefined);
    await tick(db, T0);
    const after = await adminGet(db);
    assert.deepEqual(after.body.scheduled_backfill, {
      last_tick: { ran_at: '2026-11-09 12:00:00', status: 'done', scanned: 2, issued: 1, skipped: 1, more_waiting: false },
      not_issued: { insufficient_data: 1 },
    });
    const real = d1Over(db);
    const down = { ...real, prepare: (sql: string) => { if (/spinout_certificate_backfill_tick/.test(sql)) throw new Error('D1_ERROR: unavailable'); return real.prepare(sql); } };
    const failed = await adminGet(db, down);
    assert.equal(failed.status, 200);
    assert.equal(failed.body.scheduled_backfill, null);
    assert.match(failed.body.unavailable.scheduled_backfill, /could not be read/);
    assert.ok(Array.isArray(failed.body.certificates), 'the rest of the read still answers');
  } finally { db.close(); }
});

test('#4663 a failed candidate read throws (the cron row reads partial), and records no tick', async () => {
  const db = world();
  try {
    await graduateWithoutCredential(db, 81);
    const real = d1Over(db);
    const down = { ...real, prepare: (sql: string) => { if (/FROM spinout_lab_graduates g/.test(sql)) throw new Error('D1_ERROR: unavailable'); return real.prepare(sql); } };
    await assert.rejects(quiet(() => runCertificateBackfillTick(envOf(db, {}, down), { nowMs: T0 })));
    assert.equal((await readCertificateBackfillState(envOf(db))).last_tick, null, 'a tick that read nothing is not recorded as done');
  } finally { db.close(); }
});

// Mutation checked: the cron call removed from index.ts (fails).
test('#4663 the every-minute cron runs the backfill after the Lab reconcile tick, inside its own catch', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const reconcile = src.indexOf('runLabReconcileTick(env');
  const backfill = src.indexOf('runCertificateBackfillTick(env, { nowMs: now.getTime() })');
  assert.ok(reconcile > 0 && backfill > reconcile, 'after the reconcile tick, on the scheduled minute');
  assert.match(src.slice(backfill, backfill + 600), /taskFailed\('certificate backfill tick', e\)/);
  const wrangler = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /"\* \* \* \* \*"/, 'carried by the existing every-minute trigger; no new cron');
});
