/**
 * One party never accepts on another's behalf — D354, migration 309.
 *
 * Runs the service's real SQL on SQLite (`_d1_sqlite.mjs`) over the REAL
 * migration 309 DDL, so a wrong predicate fails because the wrong row is
 * written, not because a string moved. The rule is asserted from both sides
 * the prompt names:
 *   * an account that is not a party — a founder with no KYC (founders pass
 *     `requireApprovedKyc` by design, so the party check must refuse them), a
 *     founder of another project, and staff — records nothing;
 *   * a party whose request NAMES another user's id is refused, and neither
 *     party's row changes.
 * Plus: a party's write can only ever touch their own row; a stranger cannot
 * even learn that a draft exists (404, identical to a missing id).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeD1 } from './_d1_sqlite.mjs';
import {
  recordParties, recordPosition, listPositions, CLAUSE_KEYS,
} from '../src/services/cofounderAgreementParties';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MIGRATION = read('cloudflare-worker/sql/migrations/309_cofounder_agreement_parties.sql');
const LEGAL = read('cloudflare-worker/src/routes/legal.ts');
const API = read('frontend/src/lib/api.js');

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, role TEXT, founder_id INTEGER);
  CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER);
  CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER, template_name TEXT, doc_type TEXT DEFAULT 'other');
  ${MIGRATION}
`;
const SEED = `
  INSERT INTO users VALUES (1, 'ada@example.test', 'founder', 10);
  INSERT INTO users VALUES (2, 'Bo@Example.test', 'founder', 20);
  INSERT INTO users VALUES (3, 'eve@example.test', 'founder', 30);
  INSERT INTO users VALUES (4, 'staff@example.test', 'admin', NULL);
  INSERT INTO users VALUES (5, 'inv@example.test', 'investor', NULL);
  INSERT INTO projects VALUES (100, 10);
  INSERT INTO documents VALUES (500, 100, 'cofounder_agreement', 'other');
  INSERT INTO documents VALUES (501, 100, 'nda', 'other');
`;
const U = {
  ada: { id: 1, role: 'founder', founder_id: 10 },
  bo: { id: 2, role: 'founder', founder_id: 20 },
  eve: { id: 3, role: 'founder', founder_id: 30 },
  staff: { id: 4, role: 'admin', founder_id: null },
} as any;

async function setup() {
  const { DB, db } = makeD1(SCHEMA, SEED);
  const env = { DB } as any;
  await recordParties(env, 500, [
    { name: 'Ada', email: 'ADA@example.test' },
    { name: 'Bo', email: 'bo@example.test' },
    { name: 'Cy', email: null },
  ]);
  return { env, db };
}
const rowsOf = (db: any) => db.prepare('SELECT user_id, clause_key, position, note FROM cofounder_clause_positions ORDER BY user_id').all().map((r: any) => ({ ...r }));

test('parties are resolved to accounts by email, case-insensitively; no email means no account', async () => {
  const { db } = await setup();
  const parties = db.prepare('SELECT party_index, name, user_id FROM cofounder_agreement_parties ORDER BY party_index').all();
  assert.deepEqual(parties.map((p: any) => [p.party_index, p.name, p.user_id]), [[0, 'Ada', 1], [1, 'Bo', 2], [2, 'Cy', null]]);
});

test('a party records their own position, and only their own row is written', async () => {
  const { env, db } = await setup();
  const out: any = await recordPosition(env, { documentId: 500, user: U.ada, clauseKey: 'equity', position: 'accepted', note: ' fine ', claimedUserId: undefined });
  assert.ok(!('refused' in out));
  assert.deepEqual(rowsOf(db), [{ user_id: 1, clause_key: 'equity', position: 'accepted', note: 'fine' }]);
  assert.deepEqual(out.positions.map((p: any) => [p.party_index, p.clause_key, p.position]), [[0, 'equity', 'accepted']]);
});

test('a party who names another user’s id is refused, and nothing is written for either', async () => {
  const { env, db } = await setup();
  await recordPosition(env, { documentId: 500, user: U.bo, clauseKey: 'vesting', position: 'needs_alignment', note: null, claimedUserId: undefined });
  const before = rowsOf(db);
  const out: any = await recordPosition(env, { documentId: 500, user: U.ada, clauseKey: 'vesting', position: 'accepted', note: null, claimedUserId: 2 });
  assert.deepEqual(out.refused?.code, 'party_mismatch');
  assert.equal(out.refused.status, 400);
  assert.deepEqual(rowsOf(db), before, 'Bo’s position must be untouched and Ada gains none');
});

test('naming your own id is allowed — the refusal is about another party, not about the field', async () => {
  const { env } = await setup();
  const out: any = await recordPosition(env, { documentId: 500, user: U.bo, clauseKey: 'ip', position: 'accepted', note: null, claimedUserId: 2 });
  assert.ok(!('refused' in out));
});

test('a KYC-less founder who is not a party learns nothing and records nothing', async () => {
  const { env, db } = await setup();
  const out: any = await recordPosition(env, { documentId: 500, user: U.eve, clauseKey: 'equity', position: 'accepted', note: null, claimedUserId: undefined });
  assert.equal(out.refused?.status, 404, 'a stranger gets the same 404 as a missing draft');
  assert.deepEqual(rowsOf(db), []);
  const read: any = await listPositions(env, 500, U.eve);
  assert.equal(read.refused?.status, 404);
});

test('staff may read but never record a position on a party’s behalf', async () => {
  const { env, db } = await setup();
  const read: any = await listPositions(env, 500, U.staff);
  assert.ok(!('refused' in read));
  assert.equal(read.can_record, false);
  const out: any = await recordPosition(env, { documentId: 500, user: U.staff, clauseKey: 'equity', position: 'accepted', note: null, claimedUserId: 1 });
  assert.equal(out.refused?.code, 'party_mismatch');
  const out2: any = await recordPosition(env, { documentId: 500, user: U.staff, clauseKey: 'equity', position: 'accepted', note: null, claimedUserId: undefined });
  assert.equal(out2.refused?.code, 'not_a_party');
  assert.deepEqual(rowsOf(db), []);
});

test('the read carries no emails and no user ids', async () => {
  const { env } = await setup();
  const read: any = await listPositions(env, 500, U.ada);
  assert.deepEqual(read.parties, [
    { party_index: 0, name: 'Ada', has_account: true, is_you: true },
    { party_index: 1, name: 'Bo', has_account: true, is_you: false },
    { party_index: 2, name: 'Cy', has_account: false, is_you: false },
  ]);
  assert.doesNotMatch(JSON.stringify(read), /example\.test|user_id/);
});

test('unknown clauses, bad positions and non-agreement documents are refused', async () => {
  const { env } = await setup();
  assert.equal((await recordPosition(env, { documentId: 500, user: U.ada, clauseKey: 'secret', position: 'accepted', note: null, claimedUserId: undefined }) as any).refused.code, 'invalid_clause');
  assert.equal((await recordPosition(env, { documentId: 500, user: U.ada, clauseKey: 'equity', position: 'signed', note: null, claimedUserId: undefined }) as any).refused.code, 'invalid_position');
  assert.equal((await listPositions(env, 501, U.ada) as any).refused.status, 404, 'only cofounder_agreement documents');
  assert.equal(CLAUSE_KEYS.length, 13);
});

test('the routes pass the session user, gate the write on requireApprovedKyc, and relay refusals', () => {
  const put = LEGAL.slice(LEGAL.indexOf("legal.put('/cofounder-agreement/:docId{[0-9]+}/positions/:clauseKey'"));
  const body = put.slice(0, put.indexOf('\n});'));
  assert.match(body, /const user = await requireApprovedKyc\(c\);/);
  assert.match(body, /\n\s+user,\n/, 'the actor is the session user');
  assert.doesNotMatch(body, /user:\s*\{|userId:\s*body|user_id:\s*body/, 'no request field becomes the actor');
  assert.match(body, /return refuse\(c, out\.refused\.status/);
  assert.match(LEGAL, /await recordParties\(c\.env, Number\(\(doc as any\)\.id\), value\.founders\);/);
});

test('the api.js methods exist and target the mounted routes', () => {
  assert.match(API, /legalCofounderPositions: \(docId\) => request\(`\/legal\/cofounder-agreement\/\$\{encodeURIComponent\(docId\)\}\/positions`\)/);
  assert.match(API, /legalRecordClausePosition: \(docId, clauseKey, \{ position, note \}\) =>/);
});
