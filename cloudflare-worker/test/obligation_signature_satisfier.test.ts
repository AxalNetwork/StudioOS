/**
 * `satisfyObligationFromEnvelope` — the write `legal_obligations` was designed for.
 *
 * Four obligations had a real signable document, a wired template body and a
 * working send route, and nothing recorded the result: the three NDAs and the
 * advisor disclaimer sat `pending` for the life of every account. Migration 025
 * added `evidence_envelope_uuid` to "point at the esign envelope" and only
 * `partner_msa_v1` ever set it. This file is the proof the gap is closed;
 * `obligation_satisfiable.test.ts` is the measurement that it stays closed.
 *
 * WHY BEHAVIOURAL, AND WHY REAL SQLITE. The interesting property is not that a
 * string appears in the source — it is that a row moves. The KYB case in the
 * sibling file is the cautionary example: it HAS an UPDATE setting
 * `status = 'satisfied'` and has never once run, because the query feeding it
 * reads a column no table defines. A text-matching stub cannot tell those two
 * apart, so every test here drives the real function against a real database
 * built from the real DDL.
 *
 * THE TRAP THESE TESTS EXIST FOR. `document_type` and `obligation_key` are not
 * the same string for three of the four keys — `investor_nda_v1` ships as
 * `investor_nda_axal`, `mentor_nda_v1` as `mentor_nda_axal`,
 * `mentor_disclaimer_v1` as `mentor_engagement_disclaimer`. A satisfier joining
 * the two directly would pass review, satisfy `founder_nda_v1`, and silently
 * miss the other three. Each alias is asserted below by name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { satisfyObligationFromEnvelope, ttlForObligation } from '../src/services/trust.ts';

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
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
  db.exec(tableDDL('esign_envelopes'));
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

let seq = 0;
/** Inserts an envelope and returns its row id. */
function envelope(
  db: InstanceType<typeof DatabaseSync>,
  opts: { docType: string; userId: number | null; status?: string; uuid?: string },
): number {
  seq += 1;
  const uuid = opts.uuid ?? `env-uuid-${seq}`;
  const r = db.prepare(
    `INSERT INTO esign_envelopes
       (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by)
     VALUES (?, ?, ?, 'T', 'B', 'sha', ?, 1)`,
  ).run(uuid, opts.userId, opts.docType, opts.status ?? 'completed');
  return Number(r.lastInsertRowid);
}

function obligation(
  db: InstanceType<typeof DatabaseSync>,
  userId: number, key: string, status = 'pending',
) {
  db.prepare(
    `INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES (?, ?, 1, ?)`,
  ).run(userId, key, status);
}

const rowOf = (db: InstanceType<typeof DatabaseSync>, userId: number, key: string): any =>
  db.prepare(
    'SELECT status, expires_at, evidence_envelope_uuid FROM legal_obligations WHERE user_id = ? AND obligation_key = ?',
  ).get(userId, key);

/* ------------------------------------------------------------------ *
 * Every key, through the doc_type that actually ships
 * ------------------------------------------------------------------ */

// [obligation key, the doc_type a picker really offers, does it expire]
const CASES: ReadonlyArray<readonly [string, string, boolean]> = [
  ['founder_nda_v1', 'founder_nda_v1', true],
  ['investor_nda_v1', 'investor_nda_axal', true],
  ['mentor_nda_v1', 'mentor_nda_axal', true],
  ['mentor_disclaimer_v1', 'mentor_engagement_disclaimer', false],
];

for (const [key, docType, expires] of CASES) {
  test(`a completed ${docType} envelope satisfies ${key}`, async () => {
    const { env, db } = makeEnv();
    const id = envelope(db, { docType, userId: 41, uuid: `u-${key}` });
    obligation(db, 41, key);

    const out = await satisfyObligationFromEnvelope(env, id);

    assert.deepEqual(out, { key, changed: true },
      `the satisfier did not claim ${key} for doc_type ${docType}`);
    const row = rowOf(db, 41, key);
    assert.equal(row.status, 'satisfied', `${key} did not move to satisfied`);
    assert.equal(row.evidence_envelope_uuid, `u-${key}`,
      'the signed envelope was not recorded as the evidence, so the Trust Center '
      + 'has no provenance to show for it');

    // The TTL half. `expireDueArtifacts` only expires rows whose `expires_at` is
    // non-null, so a null here on an NDA is an agreement that never needs
    // re-signing — a silent compliance hole, not a visible bug.
    if (expires) {
      assert.ok(row.expires_at, `${key} was satisfied with no expiry; it renews every 24 months`);
      const months = (Date.parse(row.expires_at) - Date.now()) / (30 * 24 * 3600 * 1000);
      assert.ok(months > 22 && months < 26, `${key} expiry is ${months.toFixed(1)} months out, expected ~24`);
    } else {
      assert.equal(row.expires_at, null,
        `${key} is a one-time acknowledgement and must not be given an expiry`);
    }
  });
}

test('each key is reachable through BOTH of its doc_type spellings', async () => {
  // The aliases above are what a picker offers; the bare `<key>` spellings are
  // also mapped, and an admin-created envelope can carry either. Both must work,
  // or which spelling was used silently decides whether the obligation closes.
  for (const [key, alias] of [
    ['investor_nda_v1', 'investor_nda_axal'],
    ['mentor_nda_v1', 'mentor_nda_axal'],
    ['mentor_disclaimer_v1', 'mentor_engagement_disclaimer'],
  ] as const) {
    for (const docType of [key, alias]) {
      const { env, db } = makeEnv();
      const id = envelope(db, { docType, userId: 7 });
      obligation(db, 7, key);
      const out = await satisfyObligationFromEnvelope(env, id);
      assert.deepEqual(out, { key, changed: true },
        `doc_type ${docType} did not resolve to ${key}`);
      assert.equal(rowOf(db, 7, key).status, 'satisfied');
    }
  }
});

/* ------------------------------------------------------------------ *
 * What it must refuse
 * ------------------------------------------------------------------ */

test('accreditation_v1 is NOT satisfied by signing its document', async () => {
  // Deliberate, and the reason is not technical: accreditation_v1 is required of
  // every investor, and whether a signed attestation establishes accredited
  // status is a securities question for counsel. The document exists and is
  // signable; this path still must not close the obligation.
  const { env, db } = makeEnv();
  const id = envelope(db, { docType: 'accreditation_v1', userId: 9 });
  obligation(db, 9, 'accreditation_v1');

  assert.equal(await satisfyObligationFromEnvelope(env, id), null,
    'accreditation_v1 was satisfied by signature — that needs counsel, not a code change');
  assert.equal(rowOf(db, 9, 'accreditation_v1').status, 'pending');
});

test('partner_msa_v1 is left to its own satisfier', async () => {
  // `services/partnerDeals.ts` already satisfies this at deal signature, with the
  // deal's own bookkeeping. A second writer here would race it.
  const { env, db } = makeEnv();
  const id = envelope(db, { docType: 'partner_services', userId: 11 });
  obligation(db, 11, 'partner_msa_v1');

  assert.equal(await satisfyObligationFromEnvelope(env, id), null,
    'partner_msa_v1 now has two satisfiers, which can race');
  assert.equal(rowOf(db, 11, 'partner_msa_v1').status, 'pending');
});

test('the 3-way NDA satisfies no obligation — it settles a pairwise row', async () => {
  const { env, db } = makeEnv();
  const id = envelope(db, { docType: 'nda_3way_founder_investor_axal', userId: 12 });
  obligation(db, 12, 'founder_nda_v1');

  assert.equal(await satisfyObligationFromEnvelope(env, id), null);
  assert.equal(rowOf(db, 12, 'founder_nda_v1').status, 'pending',
    'the 3-way NDA closed the platform founder NDA, which is a different agreement');
});

test('an envelope still out for signature satisfies nothing', async () => {
  const { env, db } = makeEnv();
  const id = envelope(db, { docType: 'founder_nda_v1', userId: 13, status: 'sent' });
  obligation(db, 13, 'founder_nda_v1');

  assert.equal(await satisfyObligationFromEnvelope(env, id), null,
    'an unsigned envelope satisfied an obligation');
  assert.equal(rowOf(db, 13, 'founder_nda_v1').status, 'pending');
});

test('an envelope with no user satisfies nothing, and does not throw', async () => {
  const { env, db } = makeEnv();
  const id = envelope(db, { docType: 'founder_nda_v1', userId: null });
  assert.equal(await satisfyObligationFromEnvelope(env, id), null);
});

test('a missing envelope returns null rather than throwing', async () => {
  // The DocuSign poller and the signing route both call this inside a try/catch,
  // but a throw here would still abort the hooks after it.
  const { env } = makeEnv();
  assert.equal(await satisfyObligationFromEnvelope(env, 424242), null);
});

/* ------------------------------------------------------------------ *
 * Idempotency — the poller sees the same envelope more than once
 * ------------------------------------------------------------------ */

test('a second pass changes nothing', async () => {
  const { env, db } = makeEnv();
  const id = envelope(db, { docType: 'founder_nda_v1', userId: 14, uuid: 'once' });
  obligation(db, 14, 'founder_nda_v1');

  const first = await satisfyObligationFromEnvelope(env, id);
  assert.equal(first?.changed, true);
  const after = rowOf(db, 14, 'founder_nda_v1');

  const second = await satisfyObligationFromEnvelope(env, id);
  assert.deepEqual(second, { key: 'founder_nda_v1', changed: false },
    'the second pass reported a change, so the DocuSign poller would re-stamp the '
    + 'expiry on every sweep and the agreement would never come due');
  assert.deepEqual(rowOf(db, 14, 'founder_nda_v1'), after, 'the row moved on a second pass');
});

test('a waived obligation is never resurrected', async () => {
  // The role-prune waives obligations that do not apply to a role. A stray
  // envelope must not drag one back into force.
  const { env, db } = makeEnv();
  const id = envelope(db, { docType: 'mentor_nda_axal', userId: 15 });
  obligation(db, 15, 'mentor_nda_v1', 'waived');

  const out = await satisfyObligationFromEnvelope(env, id);
  assert.equal(out?.changed, false, 'a waived obligation was rewritten');
  assert.equal(rowOf(db, 15, 'mentor_nda_v1').status, 'waived');
});

test('a row stranded at in_review is picked up', async () => {
  // The Trust Center's Start button flips pending -> in_review and collects
  // nothing, and renders no further action for in_review — so rows are already
  // stuck there. Signing has to rescue them, or they stay stuck forever.
  const { env, db } = makeEnv();
  const id = envelope(db, { docType: 'founder_nda_v1', userId: 16 });
  obligation(db, 16, 'founder_nda_v1', 'in_review');

  const out = await satisfyObligationFromEnvelope(env, id);
  assert.equal(out?.changed, true, 'an in_review row was not rescued by a real signature');
  assert.equal(rowOf(db, 16, 'founder_nda_v1').status, 'satisfied');
});

test('one user signing does not satisfy another user', async () => {
  const { env, db } = makeEnv();
  const id = envelope(db, { docType: 'founder_nda_v1', userId: 17 });
  obligation(db, 17, 'founder_nda_v1');
  obligation(db, 18, 'founder_nda_v1');

  await satisfyObligationFromEnvelope(env, id);
  assert.equal(rowOf(db, 18, 'founder_nda_v1').status, 'pending',
    'the UPDATE is not scoped to the signer, so one signature closed the whole platform');
});

/* ------------------------------------------------------------------ *
 * The TTL source
 * ------------------------------------------------------------------ */

test('the TTL comes from ROLE_MATRIX and is consistent per key', () => {
  // `ttlForObligation` returns the first role's value for a key. That is only
  // sound while every role agrees, and nothing else checks it — two roles
  // disagreeing would make an obligation's expiry depend on which role seeded it.
  const DAY = 24 * 3600 * 1000;
  assert.equal(ttlForObligation('tos_v1'), null, 'tos_v1 must never expire');
  assert.equal(ttlForObligation('privacy_v1'), null);
  assert.equal(ttlForObligation('mentor_disclaimer_v1'), null);
  for (const k of ['founder_nda_v1', 'investor_nda_v1', 'mentor_nda_v1'] as const) {
    assert.equal(ttlForObligation(k), 730 * DAY, `${k} is not a 24-month agreement any more`);
  }
  assert.equal(ttlForObligation('accreditation_v1'), 365 * DAY);
  // A key no role seeds is undefined, NOT null — the satisfier treats those as
  // "not mine", and collapsing the two would make it write a never-expiring row.
  assert.equal(ttlForObligation('partner_msa_v1'), undefined,
    'partner_msa_v1 is seeded by partnerDeals, not ROLE_MATRIX; if that changed, '
    + 'recheck that the signature satisfier still declines it');
});
