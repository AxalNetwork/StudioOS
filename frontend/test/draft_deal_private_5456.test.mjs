/**
 * D5456 part 2 (#5456, ADP-02) — the Draft Deal dialog saves a private deal preparation: create, then each save
 * names the revision it last saved and an operation key (reused only for a retry of the same payload); a conflict
 * reads as a sentence, never the thrown text; and "Live deal now" (`api.draftDeal`) stays until ADP-04's release.
 *
 *   node --test frontend/test/draft_deal_private_5456.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRIVATE_FIELDS, RELEASE_GAP_NOTE, changesSince, formFromContent, initialContent, keepsKey, operationKeyFor,
  refusalSentence, savedLine,
} from '../src/pages/investor/dealflow/draftPreparationModel.js';

const PARTS = readFileSync(new URL('../src/pages/investor/dealflow/StudioParts.jsx', import.meta.url), 'utf8');
const MODAL = PARTS.slice(PARTS.indexOf('export function DraftDealModal'), PARTS.indexOf('/**', PARTS.indexOf('export function DraftDealModal')));
const LENS = readFileSync(new URL('../src/pages/investor/dealflow/StudioLens.jsx', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('../src/lib/api/adminDealPreparations.js', import.meta.url), 'utf8');
const API = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');

const blank = Object.fromEntries(PRIVATE_FIELDS.map(([k]) => [k, '']));

test('the first save sends only filled fields; blank is never 0, numbers are numbers, text is trimmed', () => {
  assert.deepEqual(initialContent({ ...blank, description: '  A ledger for harbours. ', target_raise: '750000', carry_pct: '0', minimum_check: '' }),
    { description: 'A ledger for harbours.', target_raise: 750000, carry_pct: 0 });
  assert.deepEqual(initialContent(blank), {});
});

test('a later save sends only what changed since the last saved content, and a cleared field as null', () => {
  const saved = { description: 'A ledger.', target_raise: 750000, instrument: 'SAFE' };
  const form = { ...blank, ...formFromContent(saved) };
  assert.deepEqual(changesSince(form, saved), {}, 'nothing changed');
  assert.deepEqual(changesSince({ ...form, target_raise: '900000' }, saved), { target_raise: 900000 });
  assert.deepEqual(changesSince({ ...form, target_raise: '' }, saved), { target_raise: null }, 'a cleared amount is null, not 0');
  assert.deepEqual(changesSince({ ...form, website: 'https://harbor.example.test' }, saved), { website: 'https://harbor.example.test' });
  assert.equal(formFromContent({ target_raise: 0 }).target_raise, '0');
  assert.equal(formFromContent({ target_raise: null }).target_raise, '');
});

test('an operation key is reused only for a retry of the same payload, and kept only when the outcome is unknown', () => {
  let n = 0;
  const mint = () => `draft-key-${++n}`;
  const first = operationKeyFor(null, 'p1', mint);
  assert.equal(operationKeyFor({ key: first, payload: 'p1' }, 'p1', mint), first, 'the retry reuses the key');
  assert.notEqual(operationKeyFor({ key: first, payload: 'p1' }, 'p2', mint), first, 'a changed payload mints a new key');
  assert.equal(keepsKey({ status: 503, code: 'save_outcome_unknown' }), true);
  assert.equal(keepsKey({ status: 503, code: 'create_outcome_unknown' }), true);
  assert.equal(keepsKey(new Error('offline')), true, 'no status: the request may have landed');
  assert.equal(keepsKey({ status: 409, code: 'revision_conflict' }), false);
  assert.equal(keepsKey({ status: 422, code: 'invalid_fields' }), false);
});

test('a conflict reads as a sentence naming the winning revision and the fields, never the thrown text', () => {
  const e = Object.assign(new Error('RAW-SERVER-TEXT'), {
    status: 409, code: 'revision_conflict',
    data: { current: { revision: 2, revision_no: 2 }, fields: [{ key: 'target_raise', yours: 100, current: 900000 }] },
  });
  const line = refusalSentence(e);
  assert.match(line, /Someone else saved this draft after you opened it \(now revision 2\)\. Nothing was saved\./);
  assert.match(line, /Target raise/);
  assert.match(line, /Load the latest version/);
  assert.ok(!line.includes('RAW-SERVER-TEXT'));
  for (const code of ['save_outcome_unknown', 'issuer_reconciliation_required', 'open_preparation_exists', 'preparation_mutations_disabled', 'zzz_unknown']) {
    assert.ok(!refusalSentence(Object.assign(new Error('RAW-SERVER-TEXT'), { status: 400, code })).includes('RAW-SERVER-TEXT'), code);
  }
  assert.equal(refusalSentence({ status: 422, code: 'invalid_fields', data: { fields: { carry_pct: 'percent_out_of_range' } } }), 'Check Carry. Nothing was saved.');
  assert.match(refusalSentence({ status: 503, code: 'save_outcome_unknown' }), /will not be saved twice/);
  assert.match(savedLine(3), /revision 3\. It is not live/);
});

test('the dialog saves through create and save, carrying the revision it last saved; it never shows e.message for a private save', () => {
  assert.match(MODAL, /adminDealPreparationsApi\.create\(\{/);
  assert.match(MODAL, /adminDealPreparationsApi\.save\(draft\.uid, \{ expectedRevision: draft\.revision, operationKey, changes \}\)/);
  assert.match(MODAL, /setDraft\(d => \(\{ \.\.\.d, revision: out\.revision, revisionNo: out\.revision_no/, 'the next save must start from the revision just saved');
  assert.match(MODAL, /setDraft\(\{ uid: out\.preparation_uid, revision: out\.revision/);
  assert.match(MODAL, /setDraft\(\{ uid: reloadUid, revision: d\.revision/, 'Load the latest version resets the revision');
  const priv = MODAL.slice(MODAL.indexOf('const savePrivate'), MODAL.indexOf('const close ='));
  assert.ok(!/e\.message/.test(priv), 'a private save or reload shows e.message');
  assert.match(priv, /setErr\(refusalSentence\(e\)\)/);
  assert.match(priv, /reportError\('DraftDealModal:savePrivate', e\)/);
});

test('the release gap is said plainly, and the live path stays until ADP-04', () => {
  assert.match(RELEASE_GAP_NOTE, /cannot go live/);
  assert.match(RELEASE_GAP_NOTE, /If you need a live deal today, choose Live deal now\./);
  assert.match(MODAL, /\{isPrivate \? RELEASE_GAP_NOTE : /);
  assert.match(MODAL, /data-testid="draft-mode-live">Live deal now</);
  assert.match(MODAL, /await api\.draftDeal\(\{/, 'the live path is kept until ADP-04 (#5458)');
  assert.match(API, /draftDeal: \(data\) => request\('\/deals\/draft'/, 'api.draftDeal retires with ADP-04, not now');
  assert.match(LENS, /onSavedPrivately=\{\(\) => \{ setDraftOpen\(false\); finished\('Saved as a private draft\. It is not live/);
  assert.match(CLIENT, /create: \(\{ companyId, projectId, operationKey, newRound, content \} = \{\}\) => request\('\/admin\/deals', \{/);
});
