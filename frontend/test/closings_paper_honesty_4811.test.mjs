/**
 * D4811 (#4811) part 24 — Closings on the agreement lifecycle: what the read
 * cannot say is not drawn as a lifecycle state. Part 22 maps a closing line's
 * staged paper onto Ready for signature / Sent · awaiting signature / Executed
 * / Voided; this part makes the failed, malformed and unrecorded reads say so:
 *   - a list that is not a list reads "Unreadable", never "No paper sent";
 *   - a live paper with a stage state the Worker never writes reads "Unreadable",
 *     never "Ready for signature";
 *   - a live paper with no stage recorded reads "Not recorded";
 *   - the admin desk's route dialog and third-party drawer read "Reading…" and
 *     "Unreadable" from the line's read, never "No paper sent";
 *   - a line read whose answer carries no list is a failed read on the desk and
 *     in the room.
 * Every title and name is synthetic.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/closings_paper_honesty_4811.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AGREEMENT_STATES, CLOSING_PAPER_HONESTY, CLOSING_STAGE_STATES, closingPaperLifecycle, lifecycleBadge,
} from '../src/lib/contractLifecycle.js';
import { envelopesOf, paperEnvelopes, paperWord } from '../src/pages/closing/deskModel.js';
import { paperPhrase, paperState } from '../src/pages/closing/roomModel.js';
import PaperState from '../src/pages/closing/PaperState.jsx';

const stage = (position, role, state) => ({ position, role, name: null, state, sent_at: null, signed_at: null });
const env = (over = {}) => ({ uid: 'p1', title: 'Synthetic Joinder', complete: false, countersign: false, voided: false, stages: [], ...over });
const src = (f) => readFileSync(new URL(`../src/pages/closing/${f}`, import.meta.url), 'utf8');

test('the four drawn states are the agreement lifecycle\'s own words; Prepared is never drawn', () => {
  // Mutation checked: draw a ready paper with lifecycleBadge('agreement','prepared') → the ready row fails.
  const rows = [
    [[env({ complete: true, stages: [stage(1, 'company', 'signed')] })], 'executed'],
    [[env({ stages: [stage(1, 'company', 'sent')] })], 'sent'],
    [[env({ stages: [stage(1, 'company', 'waiting')] })], 'ready'],
    [[env({ voided: true, stages: [stage(1, 'company', 'sent')] })], 'voided'],
  ];
  for (const [envelopes, key] of rows) {
    const s = closingPaperLifecycle(envelopes);
    assert.equal(s.key, key);
    assert.deepEqual(s.badge, lifecycleBadge('agreement', key));
    assert.equal(s.badge.label, AGREEMENT_STATES[key].label, 'the word is the agreement\'s, not one of Closings\' own');
  }
  assert.deepEqual(rows.map(([e]) => closingPaperLifecycle(e).badge.label), ['Executed', 'Sent · awaiting signature', 'Ready for signature', 'Voided']);
});

test('a list that is not a list is Unreadable, never "No paper sent"', () => {
  // Mutation checked: treat a non-array as [] (part 22's rule) → every row reads "No paper sent" and fails.
  for (const bad of [null, undefined, {}, 'x', 7]) {
    const s = closingPaperLifecycle(bad);
    assert.deepEqual([s.key, s.badge, s.text], ['unreadable', null, CLOSING_PAPER_HONESTY.unreadable], String(bad));
  }
  assert.equal(closingPaperLifecycle([]).text, 'No paper sent', 'an empty list read from the Worker is no paper');
  assert.equal(CLOSING_PAPER_HONESTY.unreadable, 'Unreadable');
});

test('a stage state the Worker never writes is Unreadable, never Ready for signature or Sent', () => {
  // Mutation checked: drop the CLOSING_STAGE_STATES check → the first row reads "Ready for signature";
  // add 'pending' to the known states → it reads Ready and fails.
  const odd = closingPaperLifecycle([env({ stages: [stage(1, 'company', 'pending'), stage(2, 'investor', 'waiting')] })]);
  assert.deepEqual([odd.key, odd.badge, odd.text], ['unreadable', null, 'Unreadable']);
  const missing = closingPaperLifecycle([env({ stages: [stage(1, 'company', 'signed'), { position: 2, role: 'investor' }] })]);
  assert.equal(missing.key, 'unreadable', 'a stage with no state is not counted as waiting');
  assert.deepEqual([...CLOSING_STAGE_STATES], ['waiting', 'awaiting_release', 'sent', 'signed', 'declined', 'void'],
    'the six states services/stagedSigning.ts StageView writes');
  // The Worker's own `complete` still wins: it is read before the stages.
  assert.equal(closingPaperLifecycle([env({ complete: true, stages: [stage(1, 'company', 'signed')] })]).key, 'executed');
});

test('a live paper with no stage recorded is Not recorded, never Ready for signature', () => {
  // Mutation checked: let an empty stage list fall through → it reads "Ready for signature" and fails.
  for (const stages of [[], undefined, null]) {
    const s = closingPaperLifecycle([env({ stages })]);
    assert.deepEqual([s.key, s.badge, s.text], ['unrecorded', null, CLOSING_PAPER_HONESTY.unrecorded], String(stages));
  }
  assert.equal(CLOSING_PAPER_HONESTY.unrecorded, 'Not recorded');
  assert.equal(closingPaperLifecycle([env({ stages: [stage(1, 'company', 'waiting')] })]).text, 'Ready for signature · not sent yet');
});

test('the desk\'s dialogs read Reading… and Unreadable from the line\'s read, never "No paper sent"', () => {
  // Mutation checked: return entry.envelopes for an error → the error row reads "No paper sent";
  // drop the undefined branch in paperWord → loading reads "Unreadable".
  const ok = [env({ stages: [stage(1, 'company', 'sent')] })];
  assert.equal(paperEnvelopes({ status: 'loading', envelopes: [] }), undefined);
  assert.equal(paperEnvelopes({ status: 'error', envelopes: [] }), null);
  assert.equal(paperEnvelopes(undefined), undefined, 'a line not yet read');
  assert.equal(paperEnvelopes({ status: 'ok', envelopes: ok }), ok);
  assert.equal(paperWord(paperEnvelopes({ status: 'loading', envelopes: [] })), 'Reading…');
  assert.equal(paperWord(paperEnvelopes({ status: 'error', envelopes: [] })), 'Unreadable');
  assert.equal(paperWord(paperEnvelopes({ status: 'ok', envelopes: [] })), 'No paper sent');
  assert.equal(paperWord(paperEnvelopes({ status: 'ok', envelopes: ok })), 'Sent · awaiting signature · 0 of 1 signed');
  const desk = src('AdminClosing.jsx');
  assert.match(desk, /<RouteDialog [^>]*envelopes=\{paperEnvelopes\(paper\[open\.line\.uid\]\)\}/);
  assert.match(desk, /<ThirdPartyDrawer [^>]*envelopes=\{paperEnvelopes\(paper\[open\.line\.uid\]\)\}/);
});

test('a line read whose answer carries no list is a failed read on the desk and in the room', () => {
  // Mutation checked: envelopesOf returns [] for a missing list → the null rows fail;
  // put `Array.isArray(d?.envelopes) ? d.envelopes : []` back in either page → the source checks fail.
  assert.equal(envelopesOf({}), null);
  assert.equal(envelopesOf(null), null);
  assert.equal(envelopesOf({ envelopes: 'x' }), null);
  assert.deepEqual(envelopesOf({ envelopes: [] }), []);
  const line = { uid: 'l1', commitment_id: 31 };
  assert.equal(paperPhrase(line, envelopesOf({})), 'Could not be read');
  assert.equal(paperState(line, envelopesOf({})), null);
  for (const f of ['AdminClosing.jsx', 'RecordRoom.jsx']) {
    assert.doesNotMatch(src(f), /Array\.isArray\(\w\?\.envelopes\) \? \w\.envelopes : \[\]/, f);
    assert.match(src(f), /envelopesOf\(/, f);
  }
  assert.match(src('AdminClosing.jsx'), /envelopesOf\(d\) \? \{ status: 'ok', envelopes: envelopesOf\(d\) \} : \{ status: 'error', envelopes: \[\] \}/);
});

test('PaperState draws Unreadable in red with its dark pair, and Not recorded as plain words', () => {
  // Mutation checked: drop the unreadable class → the red check fails; drop `dark:text-red-300` → the dark check fails.
  const html = (state) => renderToStaticMarkup(React.createElement(PaperState, { state }));
  const unreadable = html(closingPaperLifecycle(null));
  assert.match(unreadable, /data-paper-state="unreadable"/);
  assert.match(unreadable, /class="text-red-700 dark:text-red-300">Unreadable</);
  assert.doesNotMatch(unreadable, /lifecycle-agreement/, 'no pill');
  const unrecorded = html(closingPaperLifecycle([env()]));
  assert.match(unrecorded, /data-paper-state="unrecorded"[^>]*><span>Not recorded<\/span>/);
  assert.doesNotMatch(unrecorded, /lifecycle-agreement/);
});
