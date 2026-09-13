/**
 * `recordTermsAcceptance` — the consent record, and the two obligations it closes.
 *
 * `tos_v1` and `privacy_v1` were seeded `pending` on every account and nothing
 * could ever satisfy them, because acceptance was captured nowhere: `/register`
 * showed passive "By continuing you agree" text in 10px under the submit button,
 * and the onboarding licence gate — the one screen every fresh signup passes,
 * whatever the auth method — showed only two link labels and no such sentence at
 * all. The claim that continuing constituted acceptance lived in code comments.
 *
 * So the fix is two halves and this file tests the durable one: an explicit,
 * unticked checkbox on that gate, and this function to make the act permanent.
 * Marking the obligations satisfied WITHOUT the checkbox would have been a
 * one-line change and a false record, which is the thing being avoided.
 *
 * TWO TABLES, AND THE SPLIT IS THE POINT. `legal_acceptances` is append-only
 * evidence — one row per act, surviving the obligation moving on to a later
 * version. `legal_obligations` is mutable current status, with
 * `UNIQUE(user_id, obligation_key)`, so it structurally cannot hold two
 * acceptances and is the wrong place for a consent record to live alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { recordTermsAcceptance, obligationSource } from '../src/services/trust.ts';

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
const MIGRATION = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/migrations/245_legal_acceptances.sql'), 'utf8',
);

function tableDDL(name: string): string {
  const at = BASELINE.indexOf(`CREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(tableDDL('legal_obligations'));
  // `legal_acceptances` is new, so it comes from the migration itself rather than
  // the baseline — which also means this test fails if that migration stops being
  // applicable SQL.
  //
  // COMMENTS ARE STRIPPED BEFORE SPLITTING ON `;`, not after. The header prose in
  // that file contains a semicolon, so splitting first cuts a comment in half and
  // feeds the tail to SQLite as a statement ("near \"this\": syntax error").
  const sql = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const stmt of sql.split(';')) {
    const s = stmt.trim();
    if (s) db.exec(`${s};`);
  }
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
  const DB = {
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
  };
  return { env: { DB } as any, db };
}

function seedPending(db: InstanceType<typeof DatabaseSync>, userId: number, keys: string[], status = 'pending') {
  for (const k of keys) {
    db.prepare(
      'INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES (?, ?, 1, ?)',
    ).run(userId, k, status);
  }
}

const oblig = (db: InstanceType<typeof DatabaseSync>, userId: number, key: string): any =>
  db.prepare(
    'SELECT status, expires_at, evidence_meta FROM legal_obligations WHERE user_id = ? AND obligation_key = ?',
  ).get(userId, key);

const acceptances = (db: InstanceType<typeof DatabaseSync>, userId: number): any[] =>
  db.prepare('SELECT * FROM legal_acceptances WHERE user_id = ? ORDER BY id').all(userId) as any[];

const CTX = { surface: 'onboarding_licence', ip: '203.0.113.7', ua: 'Mozilla/5.0 (test)' };

/* ------------------------------------------------------------------ *
 * The happy path
 * ------------------------------------------------------------------ */

test('an acceptance satisfies both terms obligations', async () => {
  const { env, db } = makeEnv();
  seedPending(db, 5, ['tos_v1', 'privacy_v1']);

  const out = await recordTermsAcceptance(env, 5, CTX);

  assert.deepEqual(out.keys.sort(), ['privacy_v1', 'tos_v1']);
  assert.equal(out.satisfied, 2, 'both obligations should have moved');
  for (const key of ['tos_v1', 'privacy_v1']) {
    assert.equal(oblig(db, 5, key).status, 'satisfied', `${key} did not move`);
  }
});

test('the evidence row records the act, not just the outcome', async () => {
  const { env, db } = makeEnv();
  seedPending(db, 6, ['tos_v1', 'privacy_v1']);

  await recordTermsAcceptance(env, 6, CTX);
  const rows = acceptances(db, 6);

  assert.equal(rows.length, 2, 'one evidence row per key');
  assert.deepEqual(rows.map((r) => r.obligation_key).sort(), ['privacy_v1', 'tos_v1']);
  for (const r of rows) {
    assert.equal(r.surface, 'onboarding_licence',
      'without the surface, a later audit cannot tell a signup checkbox from a backfill');
    assert.equal(r.ip, '203.0.113.7');
    assert.equal(r.ua, 'Mozilla/5.0 (test)');
    assert.ok(r.accepted_at, 'an acceptance with no timestamp is not evidence of anything');
  }
});

test('acceptance does not expire, because the matrix says it does not', async () => {
  // Both keys are `ttlMs: null` in ROLE_MATRIX. An expiry here would quietly put
  // every account back to pending on a schedule nobody chose.
  const { env, db } = makeEnv();
  seedPending(db, 7, ['tos_v1', 'privacy_v1']);
  await recordTermsAcceptance(env, 7, CTX);
  for (const key of ['tos_v1', 'privacy_v1']) {
    assert.equal(oblig(db, 7, key).expires_at, null, `${key} was given an expiry`);
  }
});

test('the Trust Center can say where the status came from', async () => {
  // `obligationSource` renders provenance under each row and returns null when
  // there is none. A satisfied obligation with no provenance would show a status
  // with nothing behind it, which is the pattern D56/D68 exist to prevent.
  const { env, db } = makeEnv();
  seedPending(db, 8, ['tos_v1', 'privacy_v1']);
  await recordTermsAcceptance(env, 8, CTX);

  const row = oblig(db, 8, 'tos_v1');
  assert.ok(row.evidence_meta, 'no evidence_meta, so the row has no provenance to render');
  assert.equal(obligationSource(row), 'Accepted at signup',
    'the provenance line is missing or fell through to the generic "Synced from" '
    + 'fallback, which reads as an import of somebody else\'s record');
});

/* ------------------------------------------------------------------ *
 * What it must not touch
 * ------------------------------------------------------------------ */

test('no other obligation is satisfied by accepting the terms', async () => {
  // The blast radius. A checkbox establishes agreement to two documents and
  // nothing else — least of all accreditation, which is a securities question.
  const { env, db } = makeEnv();
  seedPending(db, 9, ['tos_v1', 'privacy_v1', 'accreditation_v1', 'kyc_v1', 'kyb_v1', 'founder_nda_v1']);

  await recordTermsAcceptance(env, 9, CTX);

  for (const key of ['accreditation_v1', 'kyc_v1', 'kyb_v1', 'founder_nda_v1']) {
    assert.equal(oblig(db, 9, key).status, 'pending',
      `${key} was satisfied by a terms checkbox, which establishes nothing about it`);
  }
  assert.equal(acceptances(db, 9).length, 2, 'evidence was written for a key nobody accepted');
});

test('one person accepting does not satisfy anybody else', async () => {
  const { env, db } = makeEnv();
  seedPending(db, 10, ['tos_v1', 'privacy_v1']);
  seedPending(db, 11, ['tos_v1', 'privacy_v1']);

  await recordTermsAcceptance(env, 10, CTX);

  assert.equal(oblig(db, 11, 'tos_v1').status, 'pending',
    'the UPDATE is not scoped to the accepting user');
  assert.equal(acceptances(db, 11).length, 0);
});

test('a waived obligation is never resurrected', async () => {
  const { env, db } = makeEnv();
  seedPending(db, 12, ['tos_v1'], 'waived');
  seedPending(db, 12, ['privacy_v1']);

  const out = await recordTermsAcceptance(env, 12, CTX);

  assert.equal(oblig(db, 12, 'tos_v1').status, 'waived', 'a waived obligation was rewritten');
  assert.equal(out.satisfied, 1, 'only the pending one should have moved');
});

test('a row stranded at in_review is picked up', async () => {
  const { env, db } = makeEnv();
  seedPending(db, 13, ['tos_v1', 'privacy_v1'], 'in_review');

  await recordTermsAcceptance(env, 13, CTX);

  assert.equal(oblig(db, 13, 'tos_v1').status, 'satisfied',
    'the Start button leaves rows at in_review with no further action; a real '
    + 'acceptance has to rescue them or they stay stuck forever');
});

/* ------------------------------------------------------------------ *
 * Repeat acceptance
 * ------------------------------------------------------------------ */

test('a second acceptance adds evidence but does not re-stamp the obligation', async () => {
  // Append-only is the whole reason for the second table: the evidence grows, the
  // status does not move again. Re-stamping would also reset an expiry, if these
  // keys ever gain one.
  const { env, db } = makeEnv();
  seedPending(db, 14, ['tos_v1', 'privacy_v1']);

  await recordTermsAcceptance(env, 14, CTX);
  const after = oblig(db, 14, 'tos_v1');
  const second = await recordTermsAcceptance(env, 14, { ...CTX, surface: 'reacceptance_interstitial' });

  assert.equal(second.satisfied, 0, 'the obligation moved twice');
  assert.deepEqual(oblig(db, 14, 'tos_v1'), after, 'the obligation row changed on re-acceptance');
  const rows = acceptances(db, 14);
  assert.equal(rows.length, 4, 'the second acceptance was not recorded — the log is not append-only');
  assert.deepEqual(rows.slice(2).map((r) => r.surface),
    ['reacceptance_interstitial', 'reacceptance_interstitial'],
    'the second pair of rows does not carry its own surface, so the two acts are '
    + 'indistinguishable in the record');
});

test('an account with no seeded rows records evidence and satisfies nothing', async () => {
  // Ordering guard. The route records acceptance AFTER storing the licence,
  // because obligations are seeded per role; if that order were reversed this is
  // the state it would produce — evidence with no obligation to satisfy. It must
  // not throw, and the evidence must survive for the next reconcile.
  const { env, db } = makeEnv();
  const out = await recordTermsAcceptance(env, 15, CTX);
  assert.equal(out.satisfied, 0);
  assert.equal(acceptances(db, 15).length, 2,
    'the evidence was lost because there was no obligation row yet');
});

/* ------------------------------------------------------------------ *
 * The migration itself
 * ------------------------------------------------------------------ */

test('migration 245 is D1-applicable and every column has a writer', () => {
  assert.doesNotMatch(MIGRATION, /\bBEGIN\b|\bCOMMIT\b/i,
    'D1 rejects transaction statements in a migration file (migration 200 learned this)');
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS legal_acceptances/);

  // Every column this table declares must be written by `recordTermsAcceptance`.
  // A provisioned column with no writer is exactly how the schema ended up with
  // `corporate_profiles.kyb_status`, the phantom that makes KYB unsatisfiable.
  const block = MIGRATION.slice(
    MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS legal_acceptances'),
    MIGRATION.indexOf(');', MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS legal_acceptances')),
  );
  const cols = [...block.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1]);
  assert.deepEqual(cols.sort(), ['accepted_at', 'id', 'ip', 'obligation_key', 'surface', 'ua', 'user_id'],
    'the column list changed; every one needs a writer or it should not exist');

  const svc = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/trust.ts'), 'utf8');
  const insert = svc.slice(svc.indexOf('INSERT INTO legal_acceptances'));
  for (const c of cols) {
    if (c === 'id') continue;  // AUTOINCREMENT
    assert.ok(insert.slice(0, 260).includes(c), `legal_acceptances.${c} has no writer`);
  }
});
