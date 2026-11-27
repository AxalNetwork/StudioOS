/**
 * D4811 (#4811) part 22 — the owner's two answers of 2026-11-13:
 *   1. "Executed everywhere": the agreements' status words read Executed, while
 *      the stored and API value stays `signed`.
 *   2. Closings takes the agreement lifecycle: a closing line's paper (D1216's
 *      staged envelope) reads Prepared / Ready for signature / Sent · awaiting
 *      signature / Executed / Voided, never a word of its own, and the states
 *      with no lifecycle word are not forced into one.
 * Every title and name is synthetic.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/contracts_executed_closings_4811.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AGREEMENT_SORT_OPTIONS, AGREEMENT_STATES, AGREEMENT_STATUS_FILTERS, CLOSING_PAPER_UNMAPPED, NO_EVIDENCE_WARNING,
  agreementRowSemantics, closingPaperLifecycle, lifecycleBadge,
} from '../src/lib/contractLifecycle.js';
import { ATTENTION_LABELS, metricCells } from '../src/pages/admin/contracts/contractMetrics.js';
import { repairOf } from '../src/pages/admin/contracts/attentionQueues.js';
import { paperWord } from '../src/pages/closing/deskModel.js';
import { paperPhrase, paperState, roomLines } from '../src/pages/closing/roomModel.js';
import PaperState from '../src/pages/closing/PaperState.jsx';

const stage = (position, role, state) => ({ position, role, name: null, state, sent_at: null, signed_at: null });
const env = (over = {}) => ({ uid: 'p1', title: 'Synthetic SAFE', complete: false, countersign: false, voided: false, stages: [], ...over });

/* ── 1. Executed everywhere ─────────────────────────────────────────── */

test('the status chips read Executed for the stored `signed` value, and match the metric strip cell', () => {
  // Mutation checked: label the third chip 'Signed' → the labels fail; give it value 'executed' → the values fail.
  assert.deepEqual(AGREEMENT_STATUS_FILTERS.map(([label]) => label), ['All', 'Awaiting signature', 'Executed', 'Voided']);
  assert.deepEqual(AGREEMENT_STATUS_FILTERS.map(([, value]) => value), ['', 'awaiting_signature', 'signed', 'void'],
    'the API filter values do not change');
  const executed = metricCells({ attention: { awaiting: 1, executed: { total: 2, this_year: 2, this_month: 1 }, stalled: { count: 0 }, repair: { count: 0, evidence: 0, unlinked: 0 } } })
    .find((c) => c.key === 'executed');
  const chip = AGREEMENT_STATUS_FILTERS.find(([label]) => label === executed.label);
  assert.ok(chip, 'the strip cell and a chip share one word');
  assert.equal(chip[1], executed.drill.filters.status, 'and open the same records');
  assert.ok(Object.isFrozen(AGREEMENT_STATUS_FILTERS) && AGREEMENT_STATUS_FILTERS.every(Object.isFrozen));
});

test('no agreements status word, sort or warning says Signed; the sort keeps the API field', () => {
  // Mutation checked: restore 'Signed, newest' → the regex fails; rename the value to executed_at → the field check fails.
  const words = [
    ...AGREEMENT_STATUS_FILTERS.map(([label]) => label),
    ...AGREEMENT_SORT_OPTIONS.map(([, label]) => label),
    ...Object.values(AGREEMENT_STATES).map((s) => s.label),
    NO_EVIDENCE_WARNING, ATTENTION_LABELS.repair_evidence,
  ];
  for (const w of words) assert.doesNotMatch(w, /\bsigned\b/i, w);
  assert.deepEqual(AGREEMENT_SORT_OPTIONS.find(([value]) => value === 'signed_at:desc'), ['signed_at:desc', 'Executed, newest']);
  assert.equal(ATTENTION_LABELS.repair_evidence, 'Marked executed with no execution evidence');
});

test('the contradiction reads "Marked executed" in the row, the repair queue and the strip', () => {
  // Mutation checked: put 'Marked signed · …' back in agreementRowSemantics → the first assert fails;
  // keep the literal in attentionQueues → the second fails; restore 'signed row' → the third fails.
  const bare = { uid: 'a1', status: 'signed', source: 'documents', signed_at: null, file_key: null, file_sha256: null, envelope_uuid: null, project_name: 'Synthetic Co' };
  assert.equal(agreementRowSemantics(bare).warning, 'Marked executed · no execution evidence');
  assert.equal(repairOf(bare).problem, NO_EVIDENCE_WARNING);
  const repair = metricCells({ attention: { repair: { count: 3, evidence: 1, unlinked: 2 } } }).find((c) => c.key === 'repair');
  assert.deepEqual(repair.lines, ['1 row marked executed with no evidence · 2 unlinked recipients']);
});

test('the Sent pill is the canvas\'s "Sent · awaiting signature"; the other four words are unchanged', () => {
  // Mutation checked: label sent 'Sent' → fails.
  assert.deepEqual(Object.values(AGREEMENT_STATES).map((s) => s.label), ['Prepared', 'Ready for signature', 'Sent · awaiting signature', 'Executed', 'Voided']);
});

/* ── 2. Closings on the agreement lifecycle ─────────────────────────── */

test('each closing paper maps onto the agreement lifecycle, with the same pill objects as an agreement', () => {
  // Mutation checked: map a complete paper to 'sent' → the executed row fails; drop the awaiting_release
  // branch → the countersign detail fails; treat "no stage sent" as sent → the ready row fails.
  const cases = [
    [[env({ complete: true, stages: [stage(1, 'company', 'signed'), stage(2, 'investor', 'signed')] })], 'executed', 'Executed'],
    [[env({ complete: true, countersign: true, stages: [stage(1, 'company', 'signed'), stage(2, 'axal', 'signed')] })], 'executed', 'Executed · countersigned for Axal'],
    [[env({ stages: [stage(1, 'company', 'signed'), stage(2, 'investor', 'sent')] })], 'sent', 'Sent · awaiting signature · 1 of 2 signed'],
    [[env({ stages: [stage(1, 'company', 'sent'), stage(2, 'investor', 'waiting')] })], 'sent', 'Sent · awaiting signature · 0 of 2 signed'],
    [[env({ countersign: true, stages: [stage(1, 'company', 'signed'), stage(2, 'investor', 'signed'), stage(3, 'axal', 'awaiting_release')] })], 'sent', 'Sent · awaiting signature · waiting for Axal’s countersign'],
    [[env({ stages: [stage(1, 'company', 'waiting'), stage(2, 'investor', 'waiting')] })], 'ready', 'Ready for signature · not sent yet'],
    [[env({ voided: true, stages: [stage(1, 'company', 'sent')] })], 'voided', 'Voided'],
  ];
  for (const [envelopes, key, text] of cases) {
    const s = closingPaperLifecycle(envelopes);
    assert.equal(s.key, key, text);
    assert.equal(s.text, text);
    assert.deepEqual(s.badge, lifecycleBadge('agreement', key), `${key} wears the agreement's own pill`);
    assert.equal(paperWord(envelopes), text, 'the admin desk reads the same words');
  }
  assert.equal(closingPaperLifecycle(cases[0][0]).badge.treatment, 'seal', 'only an executed paper is the filled seal');
});

test('the newest live paper is read; voided papers behind it do not change it, and a voided-only line reads Voided', () => {
  // Mutation checked: read list[0] instead of the newest live → the first assert reads Voided.
  const live = env({ uid: 'p2', stages: [stage(1, 'company', 'sent')] });
  const dead = env({ uid: 'p1', voided: true, complete: true });
  assert.equal(closingPaperLifecycle([dead, live]).key, 'sent', 'a voided paper never reads as the live one, even one marked complete');
  assert.equal(closingPaperLifecycle([dead]).key, 'voided');
  assert.equal(closingPaperLifecycle([dead]).badge.treatment, 'void');
});

test('never Executed without the Worker\'s own `complete`, never Prepared, and no paper is no state', () => {
  // Mutation checked: read Executed from "every stage signed" alone → the first assert fails;
  // draw no paper as Prepared → the none row fails.
  const allSigned = env({ complete: false, stages: [stage(1, 'company', 'signed'), stage(2, 'investor', 'signed')] });
  assert.notEqual(closingPaperLifecycle([allSigned]).key, 'executed');
  const none = closingPaperLifecycle([]);
  assert.deepEqual([none.key, none.badge, none.text], ['none', null, 'No paper sent']);
  // D4811 part 24: an unread list is not given a state, and is not "No paper sent" either: it reads Unreadable.
  assert.deepEqual(closingPaperLifecycle(null), { key: 'unreadable', badge: null, detail: 'Unreadable', text: 'Unreadable' });
  const every = [[], [env()], [env({ complete: true })], [env({ voided: true })], [env({ stages: [stage(1, 'company', 'sent')] })],
    [env({ stages: [stage(1, 'company', 'declined')] })], [env({ stages: [stage(1, 'company', 'void')] })]];
  for (const e of every) assert.notEqual(closingPaperLifecycle(e).badge?.key, 'prepared', 'no closing store records a paper before it is generated');
});

test('a declined paper and a voided signer envelope keep their own words and draw no lifecycle pill', () => {
  // Mutation checked: map declined to lifecycleBadge('agreement','voided') → the badge assert fails;
  // drop the stage_void branch → it reads "Sent · awaiting signature".
  const declined = closingPaperLifecycle([env({ stages: [stage(1, 'company', 'signed'), stage(2, 'investor', 'declined')] })]);
  assert.deepEqual([declined.key, declined.badge, declined.text], ['declined', null, 'Declined']);
  const stageVoid = closingPaperLifecycle([env({ stages: [stage(1, 'company', 'signed'), stage(2, 'investor', 'void')] })]);
  assert.deepEqual([stageVoid.key, stageVoid.badge, stageVoid.text], ['stage_void', null, CLOSING_PAPER_UNMAPPED.stage_void]);
  assert.deepEqual(Object.keys(CLOSING_PAPER_UNMAPPED), ['declined', 'stage_void'], 'the two states the decision record lists');
});

test('the room reads the same lifecycle; a prospect line and an unread paper keep their own sentences', () => {
  // Mutation checked: return 'Signed' from paperPhrase for a complete paper → the first assert fails.
  const line = { uid: 'l1', commitment_id: 31, status: 'open', route: 'direct', amount_cents: 100, investor_name: 'Synthetic Angel' };
  const done = [env({ complete: true, stages: [stage(1, 'company', 'signed')] })];
  assert.equal(paperPhrase(line, done), 'Executed');
  assert.equal(paperPhrase({ ...line, commitment_id: null }, done), 'No paper for a prospect line');
  assert.equal(paperPhrase(line, null), 'Could not be read');
  assert.equal(paperState(line, null), null, 'an unread paper has no pill');
  assert.equal(paperState({ ...line, commitment_id: null }, done), null);
  const [row] = roomLines({ lines: [line], currency: 'USD' }, { l1: done }, 'founder');
  assert.equal(row.paperState.key, 'executed');
  assert.equal(row.paper, 'Executed');
});

test('PaperState draws the shared pill with its dark pair, and words only where no lifecycle word applies', () => {
  // Mutation checked: render the detail without the badge → the seal check fails; render a badge for
  // declined → the lifecycle-agreement check fails.
  const html = (state, text) => renderToStaticMarkup(React.createElement(PaperState, { state, text }));
  const sent = html(closingPaperLifecycle([env({ stages: [stage(1, 'company', 'signed'), stage(2, 'investor', 'sent')] })]));
  assert.match(sent, /data-testid="lifecycle-agreement"[^>]*data-treatment="progress"/);
  assert.match(sent, /➤<\/span>Sent · awaiting signature/);
  assert.match(sent, /dark:text-gray-400">1 of 2 signed/);
  assert.match(sent, /class="inline-flex flex-wrap/, 'it wraps at phone width');
  const executed = html(closingPaperLifecycle([env({ complete: true })]));
  assert.match(executed, /data-treatment="seal"/);
  assert.match(executed, /dark:bg-white dark:text-\[#18181b\]/, 'the seal has its dark pair');
  const declined = html(closingPaperLifecycle([env({ stages: [stage(1, 'investor', 'declined')] })]));
  assert.doesNotMatch(declined, /lifecycle-agreement/);
  assert.match(declined, /data-paper-state="declined"[^>]*><span>Declined<\/span>/);
  assert.equal(html(null, 'No paper for a prospect line'), 'No paper for a prospect line');
});
