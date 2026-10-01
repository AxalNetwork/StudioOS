/**
 * D169 — the subject was told the outcome by a feed and by nothing else.
 *
 * THE DEFECT. `users.deletion_requested_at` is the OPEN flag and D168's close
 * clears it, so the moment HQ decides, SettingsPage's amber "Deletion
 * requested <date>" line simply DISAPPEARS. The subject asked, waited out a
 * GDPR Art. 12(3) clock, and the screen returns to as if they never asked.
 * D168 does write them an `activity_logs` row, so the outcome reaches the
 * Cmd+K recent feed — twenty rows deep, on a surface nobody opens for this.
 * A denial that vanishes silently is the worst of the three outcomes.
 *
 * WHY THESE RUN THE REAL WRITES. A source scan can show the words
 * `loadOwnDsrOutcome` are present. It cannot show that the row returned is the
 * LAST one rather than an arbitrary one, that a subject who was denied, asked
 * again and then withdrew is shown the withdrawal rather than the stale
 * denial, or that an unreadable ledger reports itself rather than reading as
 * "nothing was decided". Those are the claims, so they run against a real
 * node:sqlite database built from MIGRATION 272 ITSELF, sliced off disk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  openDsrRequest,
  withdrawDsrRequest,
  closeDsrRequest,
  loadOwnDsrOutcome,
} from '../src/services/dsrRequests';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const SETTINGS = read('cloudflare-worker/src/routes/settings.ts');
const MIGRATION = read('cloudflare-worker/sql/migrations/272_dsr_requests.sql');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const d1: any = {
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
    async batch(stmts: any[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return d1;
}

/** The real 272, so the CHECK and the partial unique index are the ones that ship. */
function fresh(withLedger = true) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`CREATE TABLE users (
             id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT DEFAULT 'founder',
             is_active INTEGER DEFAULT 1, deletion_requested_at TEXT)`);
  db.exec(`CREATE TABLE activity_logs (
             id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
             user_id INTEGER, created_at TEXT DEFAULT (datetime('now')))`);
  if (withLedger) db.exec(MIGRATION);
  db.exec(`INSERT INTO users (id, email, name) VALUES
             (1, 'subject@example.com', 'A Subject'),
             (2, 'hq@axal.vc', 'HQ Holder'),
             (3, 'never@example.com', 'Never Asked')`);
  return { db, env: { DB: makeD1(db) } as any };
}

/** What the subject's own request handler does, so the tests start where it leaves off. */
async function subjectRequests(db: any, env: any, id: number) {
  db.prepare("UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, datetime('now')) WHERE id = ?").run(id);
  await openDsrRequest(env, id);
}
/** And what the subject's cancel does. */
async function subjectCancels(db: any, env: any, id: number) {
  db.prepare('UPDATE users SET deletion_requested_at = NULL WHERE id = ?').run(id);
  await withdrawDsrRequest(env, id);
}

test('a subject who has never asked is told nothing, and that is not an error', async () => {
  const { env } = fresh();
  const out = await loadOwnDsrOutcome(env, 3);
  assert.equal(out.available, true);
  assert.equal((out as any).last_closed, null,
    'never asked must be a readable absence, not a fabricated row');
});

test('an OPEN request is not an outcome — the amber line still owns that state', async () => {
  const { db, env } = fresh();
  await subjectRequests(db, env, 1);
  const out = await loadOwnDsrOutcome(env, 1);
  assert.equal(out.available, true);
  assert.equal((out as any).last_closed, null,
    'an open row has outcome NULL and must not surface as a decision');
});

test('a denial reaches the subject, with the reason HQ typed, verbatim', async () => {
  const { db, env } = fresh();
  await subjectRequests(db, env, 1);
  await closeDsrRequest(env, {
    userId: 1, actorUserId: 2, outcome: 'denied',
    reason: 'Retention obligation under the partnership agreement until 2027.',
  });
  // The flag is cleared, which is exactly why the amber line vanishes and why
  // this read has to exist: without it the screen says nothing at all.
  assert.equal(
    (db.prepare('SELECT deletion_requested_at AS t FROM users WHERE id = 1').get() as any).t, null);

  const out = await loadOwnDsrOutcome(env, 1);
  assert.equal(out.available, true);
  const last = (out as any).last_closed;
  assert.equal(last.outcome, 'denied');
  assert.ok(last.closed_at, 'a decision with no date is half a decision');
  assert.equal(last.close_reason, 'Retention obligation under the partnership agreement until 2027.',
    'the reason is shown to the subject verbatim — it is written to be read by a regulator, '
    + 'and the subject is the person it is about');
});

test('a fulfilment reaches the subject too', async () => {
  const { db, env } = fresh();
  await subjectRequests(db, env, 1);
  await closeDsrRequest(env, { userId: 1, actorUserId: 2, outcome: 'fulfilled', reason: 'Erasure carried out manually.' });
  const last = (await loadOwnDsrOutcome(env, 1) as any).last_closed;
  assert.equal(last.outcome, 'fulfilled');
});

test("the subject's OWN withdrawal is reported as theirs — no operator, no reason", async () => {
  const { db, env } = fresh();
  await subjectRequests(db, env, 1);
  await subjectCancels(db, env, 1);
  const last = (await loadOwnDsrOutcome(env, 1) as any).last_closed;
  assert.equal(last.outcome, 'withdrawn');
  assert.equal(last.close_reason, null,
    'a withdrawal carries no HQ reason, so the page must not invent one');
});

test('DENIED, ASKED AGAIN, WITHDRAWN — the subject sees the withdrawal, never the stale denial', async () => {
  // This is the case that decides the query. Filtering `withdrawn` out on the
  // grounds that the subject already knows they cancelled would surface the
  // NEXT row down, which is the old denial — presented as their current state.
  const { db, env } = fresh();
  await subjectRequests(db, env, 1);
  await closeDsrRequest(env, { userId: 1, actorUserId: 2, outcome: 'denied', reason: 'Not this time, sorry.' });
  await subjectRequests(db, env, 1);          // asking again opens a NEW row
  await subjectCancels(db, env, 1);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dsr_requests WHERE user_id = 1').get().n, 2,
    'a second ask after a denial must open a second row, or this case cannot arise');
  const last = (await loadOwnDsrOutcome(env, 1) as any).last_closed;
  assert.equal(last.outcome, 'withdrawn',
    'the LAST closed row is the subject’s state; an earlier denial is history');
  assert.equal(last.close_reason, null);
});

test('an UNREADABLE ledger reports itself — it never reads as "nothing was decided"', async () => {
  // #204, and `loadDsrHistory`'s own rule. Migration 272 has no runtime
  // bootstrap, so a database behind on migrations genuinely has no table — and
  // rendering that as silence reproduces the exact defect D169 closes, for the
  // subject whose request WAS decided.
  const { env } = fresh(false);
  const out = await loadOwnDsrOutcome(env, 1);
  assert.equal(out.available, false);
  assert.ok(/272/.test((out as any).reason), 'the reason must name the migration that creates it');
  assert.ok(!('last_closed' in (out as any)),
    'an unreadable store must not also hand back an absence — those are different claims');
});

test('the settings payload carries the outcome beside the open flag it explains', () => {
  assert.ok(/loadOwnDsrOutcome/.test(SETTINGS), 'settings.ts must read the outcome');
  const openAt = SETTINGS.indexOf('deletion_requested_at: u.deletion_requested_at');
  const outcomeAt = SETTINGS.indexOf('dsr_outcome: dsrOutcome');
  assert.ok(openAt > 0 && outcomeAt > 0, 'both fields must be on the payload');
  assert.ok(outcomeAt > openAt && outcomeAt - openAt < 120,
    'the outcome sits beside the flag it explains, not adrift elsewhere in the payload');
});
