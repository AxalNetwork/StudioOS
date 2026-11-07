/**
 * D4692 (#4692) — the Practice pages handle the Worker's new refusals and 409 conflict.
 *
 * The pure modules are loaded directly (importing a page pulls React and a
 * stylesheet the test loader cannot resolve); the pages are checked as source for
 * the wiring that matters: they show the Worker's words, offer a reload on a
 * stale record, leave inputs alone, and offer only the moves the graph allows.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_practice_conflict_4692.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { failureNote, isStale, CHANGED_CODE } from '../src/pages/advisor/practice/lifecycleConflict.js';
import { canDecideRenewal, decisionsFor, laneMoves } from '../src/pages/advisor/practice/engagementBoard.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ENG = codeOnly(read('frontend/src/pages/advisor/practice/EngagementsZone.jsx'));
const SES = codeOnly(read('frontend/src/pages/advisor/practice/SessionsZone.jsx'));
const WORKER = read('cloudflare-worker/src/routes/advisors.ts');

const conflict = Object.assign(new Error('This record changed while you were looking at it. Reload it and try again.'), { status: 409, code: 'changed_while_looking' });

test('a stale conflict shows the Worker\'s words and is marked for a reload', () => {
  const n = failureNote(conflict, 'fallback');
  assert.deepEqual(n, { ok: false, text: conflict.message, stale: true });
  assert.equal(CHANGED_CODE, 'changed_while_looking');
  // The code is the Worker's: a mutation of either side breaks the offer.
  assert.match(WORKER, /code: 'changed_while_looking'/);
});

test('any other refusal shows its own sentence with no reload, and the fallback only when there is none', () => {
  const full = Object.assign(new Error('Slot full'), { status: 409, code: 'slot_full' });
  assert.deepEqual(failureNote(full, 'x'), { ok: false, text: 'Slot full', stale: false });
  assert.equal(isStale(Object.assign(new Error('a'), { status: 404, code: 'changed_while_looking' })), false);
  assert.equal(isStale(Object.assign(new Error('a'), { status: 409 })), false);
  assert.deepEqual(failureNote({}, 'Nothing was blocked.'), { ok: false, text: 'Nothing was blocked.', stale: false });
});

test('an engagement that was ever signed is never offered Ended on the board, in any lane', () => {
  for (const lane of ['drafting', 'proposed', 'signed', 'renewal_due']) {
    assert.ok(!laneMoves(lane, true).includes('ended'), lane);
  }
  assert.ok(laneMoves('proposed', false).includes('ended'), 'a never-signed proposal can still be abandoned');
  // Its ending goes through the decision form, which then offers only "Ended" outside the signed lanes.
  assert.equal(canDecideRenewal('proposed', true), true);
  assert.equal(canDecideRenewal('proposed', false), false);
  assert.equal(canDecideRenewal('ended', true), false);
  assert.deepEqual(decisionsFor('proposed'), ['ended']);
  assert.deepEqual(decisionsFor('signed'), ['renewed', 'ended']);
});

test('the pages route failures through the shared note, offer the reload, and keep the inputs', () => {
  assert.match(ENG, /setNote\(failureNote\(error, failure\)\)/);
  assert.match(ENG, /note\?\.stale && \(/);
  assert.match(ENG, /data-testid="reload-pr2"/);
  // The decision form is cleared only after the write resolved, never in the catch.
  assert.doesNotMatch(ENG.slice(ENG.indexOf('catch (error)'), ENG.indexOf('finally')), /setDecision|setDeciding/);
  assert.match(ENG, /laneMoves\(e\.lane, e\.ever_signed === true\)/);
  assert.match(SES, /setBlockNote\(failureNote\(e, 'Nothing was blocked\.'\)\)/);
  assert.match(SES, /blockNote\?\.stale && \(/);
  // The block form is closed on success only.
  const catchBlock = SES.slice(SES.indexOf("setBlockNote(failureNote(e,"), SES.indexOf("setBlockNote(failureNote(e,") + 200);
  assert.doesNotMatch(catchBlock, /setBlockForm/);
});
