/**
 * Co-founder Agreement clause positions on the page — D354.
 *
 * The Worker enforces who may record what (cofounder_agreement_positions_d354
 * .test.ts). These pin what the PAGE claims from the read:
 *   * a clause is "agreed" only when EVERY party with an account accepted it,
 *     and never while a party has no account on file;
 *   * a position the store does not hold is Not recorded, never "accepted";
 *   * the write sends no user id — the actor is the session's;
 *   * a failed read is Unreadable, and a draft from before parties were
 *     recorded says so instead of showing empty positions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  latestAgreementDoc, clauseRows, clauseAgreement, agreementTally,
} from '../src/lib/cofounderPositions.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(raw('frontend/src/pages/SpinoutLabCofounderAgreementPage.jsx'));
const COMPONENT = codeOnly(raw('frontend/src/components/cofounder/ClausePositions.jsx'));
const API = raw('frontend/src/lib/api.js');
const CANVAS = raw('design/canvases/out-of-scope/Co-founder Agreement.dc.html');

const read = (parties, positions) => ({ state: 'ok', data: { parties, positions, can_record: true } });
const A = { party_index: 0, name: 'Ada', has_account: true, is_you: true };
const B = { party_index: 1, name: 'Bo', has_account: true, is_you: false };
const C = { party_index: 2, name: 'Cy', has_account: false, is_you: false };

test('agreed needs every party with an account to accept', () => {
  const r = read([A, B], [
    { clause_key: 'equity', party_index: 0, position: 'accepted', note: null },
  ]);
  assert.equal(clauseAgreement(clauseRows(r, 'equity')), 'open', 'one acceptance is not agreement');
  const r2 = read([A, B], [
    { clause_key: 'equity', party_index: 0, position: 'accepted' },
    { clause_key: 'equity', party_index: 1, position: 'accepted' },
  ]);
  assert.equal(clauseAgreement(clauseRows(r2, 'equity')), 'agreed');
});

test('a party with no account keeps a clause from reading agreed', () => {
  const r = read([A, C], [{ clause_key: 'ip', party_index: 0, position: 'accepted' }]);
  assert.equal(clauseAgreement(clauseRows(r, 'ip')), 'open');
});

test('one "needs alignment" marks the clause, and untouched clauses are open with null positions', () => {
  const r = read([A, B], [
    { clause_key: 'vesting', party_index: 0, position: 'accepted' },
    { clause_key: 'vesting', party_index: 1, position: 'needs_alignment' },
  ]);
  assert.equal(clauseAgreement(clauseRows(r, 'vesting')), 'alignment');
  assert.deepEqual(clauseRows(r, 'dispute').map((x) => x.position), [null, null]);
  assert.deepEqual(agreementTally(r, ['vesting', 'dispute']), { agreed: 0, alignment: 1, open: 1 });
});

test('a failed read yields no rows at all rather than empty positions', () => {
  assert.deepEqual(clauseRows({ state: 'failed' }, 'equity'), []);
});

test('the newest generated draft is the one positions belong to', () => {
  const d = latestAgreementDoc([{ id: 3, created_at: '2026-09-01' }, { id: 9, created_at: '2026-09-20' }, { id: 5, created_at: '2026-09-10' }]);
  assert.equal(d.id, 9);
  assert.equal(latestAgreementDoc([]), null);
});

test('the write sends position and note only — never a user id', () => {
  const m = API.slice(API.indexOf('legalRecordClausePosition:'), API.indexOf('    }),', API.indexOf('legalRecordClausePosition:')) + 7);
  assert.match(m, /body: JSON\.stringify\(\{ position, note: note \?\? null \}\)/);
  assert.doesNotMatch(m, /user_id|userId/);
});

test('the component lets only the signed-in party record, and says why others cannot', () => {
  assert.match(COMPONENT, /\{canRecord && mine && \(/);
  assert.match(COMPONENT, /const mine = rows\.find\(\(r\) => r\.is_you\) \|\| null;/);
  assert.match(COMPONENT, /No account on file<\/Unrecorded>/);
  assert.match(COMPONENT, /<Unrecorded reason="This founder has not recorded a position on this clause\." \/>/);
});

test('the page draws Unreadable on a failed read and names a draft with no parties', () => {
  assert.match(PAGE, /positionsRead\.state === 'failed' \? \(\s*<Unreadable/);
  assert.match(PAGE, /data-testid="positions-no-parties"/);
  assert.match(PAGE, /canRecord=\{positionsRead\.data\.can_record === true\}/);
});

test('the canvas draws Accept / Needs alignment per clause', () => {
  assert.ok(/Needs alignment/.test(CANVAS) && /Accept/.test(CANVAS));
  assert.match(COMPONENT, /Accept term/);
  assert.match(COMPONENT, /Needs alignment/);
});
