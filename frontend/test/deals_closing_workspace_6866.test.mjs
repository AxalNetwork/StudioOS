/**
 * D6866 (#6866, canvas D6158 DX17 to DX26) — the closing workspace for one
 * deal at /deals/closing?deal=<id>.
 *
 *   · tabs Checklist, Paper, Conditions, Transfer, Audit with their counts;
 *     an investor has no Audit tab, and a failed read's count says Unavailable;
 *   · every status is a word and a glyph; Overdue needs a due date that passed
 *     while Pending;
 *   · conditions read open first, then Met, then Waived;
 *   · Record transfer is on only when the gate read says nothing holds it: a
 *     hold names its count, a hold on a decision the caller cannot see has no
 *     count, an unreadable gate keeps the button off, and only an Admin records;
 *   · the Audit tab merges checklist moves, transfers, paper and closing events
 *     newest first, and a closing event with no actor name reads "Not recorded" (D6889);
 *   · the before-close rules are the three `completeClosing` enforces;
 *   · the side sheet sends only what changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  LOADING, UNREADABLE, ok, UNAVAILABLE_WORD, DISCLAIMER,
  itemStatus, checklistSummary, paperState, paperRows, conditionRows,
  transferHold, transferRows, auditRows, closeRules, workspaceTabs, itemPatch,
} from '../src/pages/investor/deals/closingWorkspaceModel.js';
import { StatusWord } from '../src/pages/investor/deals/ClosingWorkspace.jsx';
import { closingRows, ready } from '../src/pages/investor/deals/closingListModel.js';

const read = (rel) => readFileSync(rel, 'utf8');
const WS = codeOnly(read('frontend/src/pages/investor/deals/ClosingWorkspace.jsx'));
const ZONE = codeOnly(read('frontend/src/pages/investor/deals/ClosingZone.jsx'));
const TODAY = '2026-11-14';

test('a checklist item is a word and a glyph; Overdue needs a passed due date while Pending', () => {
  assert.deepEqual(itemStatus({ state: 'done' }, TODAY), { key: 'done', word: 'Done', glyph: '✓' });
  assert.equal(itemStatus({ state: 'blocked' }, TODAY).word, 'Blocked');
  assert.equal(itemStatus({ state: 'skipped' }, TODAY).glyph, '–');
  assert.deepEqual(itemStatus({ state: 'pending', due_date: '2026-11-10' }, TODAY), { key: 'overdue', word: 'Overdue · 4 days', glyph: '◷' });
  assert.equal(itemStatus({ state: 'pending', due_date: '2026-11-13' }, TODAY).word, 'Overdue · 1 day');
  assert.equal(itemStatus({ state: 'pending', due_date: '2026-11-14' }, TODAY).key, 'pending', 'due today is not overdue');
  assert.equal(itemStatus({ state: 'pending' }, TODAY).key, 'pending', 'no due date is never Overdue');
  assert.equal(itemStatus({ state: 'done', due_date: '2026-11-01' }, TODAY).key, 'done', 'a done item is not overdue');
});

test('the checklist summary counts each state and the tab reads "done of total"', () => {
  const list = { template_slug: 'safe', items: [
    { state: 'done' }, { state: 'done' }, { state: 'pending', due_date: '2026-11-20' },
    { state: 'pending', due_date: '2026-11-10' }, { state: 'blocked' }, { state: 'skipped' },
  ] };
  const s = checklistSummary(ok(list), TODAY);
  assert.equal(s.tab, '2 of 6');
  assert.deepEqual([s.done, s.pending, s.overdue, s.blocked, s.skipped], [2, 1, 1, 1, 1]);
  assert.equal(checklistSummary(ok(null), TODAY).state, 'none');
  assert.equal(checklistSummary(ok({ items: [] }), TODAY).state, 'empty');
  assert.equal(checklistSummary(UNREADABLE, TODAY).state, 'unreadable');
  assert.equal(checklistSummary(LOADING, TODAY).state, 'loading');
});

test('paper reads in the lifecycle words, only this deal, with signatures per envelope', () => {
  assert.equal(paperState({ status: 'completed' }).word, 'Executed');
  assert.equal(paperState({ status: 'sent', signed_count: 2 }).word, 'Partly signed');
  assert.equal(paperState({ status: 'sent', signed_count: 0 }).word, 'Sent');
  assert.equal(paperState({ status: 'voided' }).word, 'Voided');
  assert.equal(paperState({ status: 'declined' }).word, 'Rejected');
  const p = paperRows(ok([
    { id: 1, deal_id: 7, status: 'completed', document_title: 'SAFE · Investor A', signed_count: 2, recipient_count: 2, sent_at: '2026-11-02', completed_at: '2026-11-04T10:00' },
    { id: 2, deal_id: 7, status: 'sent', document_title: 'Subscription', signed_count: 2, recipient_count: 3, sent_at: '2026-11-09' },
    { id: 3, deal_id: 8, status: 'completed', document_title: 'Other deal' },
  ]), 7);
  assert.equal(p.rows.length, 2, 'another deal’s envelope is not listed');
  assert.equal(p.rows[0].title, 'Subscription', 'newest sent first');
  assert.equal(p.rows[0].signatures, '2 of 3 signed');
  assert.equal(p.rows[1].executed, '2026-11-04');
  assert.equal(p.executed, 1);
  assert.equal(p.partly, 1);
  assert.equal(paperRows(UNREADABLE, 7).state, 'unreadable');
});

test('conditions read open first, then Met, then Waived; the tab says "n open" or "none open"', () => {
  const c = conditionRows(ok([
    { uid: 'w', deal_id: 5, status: 'waived', body: 'W', created_at: '2026-11-04' },
    { uid: 'm', deal_id: 5, status: 'met', body: 'M', created_at: '2026-11-04' },
    { uid: 'o1', deal_id: 5, status: 'open', body: 'O1', created_at: '2026-11-12' },
    { uid: 'o2', deal_id: 5, status: 'open', body: 'O2', created_at: '2026-11-13' },
    { uid: 'x', deal_id: 9, status: 'open', body: 'other deal' },
  ]), 5);
  assert.deepEqual(c.rows.map((r) => r.uid), ['o2', 'o1', 'm', 'w']);
  assert.equal(c.tab, '2 open');
  assert.equal(c.rows[0].owner, null, 'an owner that is not recorded stays null, never a guess');
  assert.equal(conditionRows(ok([]), 5).tab, 'none open');
});

test('Record transfer: on only when nothing holds it; a hold says why, an unreadable gate stays off', () => {
  assert.deepEqual(transferHold(ok({ held: false }), true), { state: 'clear', enabled: true, reason: null });
  const held = transferHold(ok({ held: true, open_conditions: 2 }), true);
  assert.equal(held.enabled, false);
  assert.match(held.reason, /^2 open conditions hold this\./);
  assert.match(transferHold(ok({ held: true, open_conditions: 1 }), true).reason, /^1 open condition holds this\./);
  const hidden = transferHold(ok({ held: true, open_conditions: null }), true);
  assert.equal(hidden.state, 'held_hidden');
  assert.equal(hidden.count, null, 'a hold on a decision you cannot see has no count');
  const ur = transferHold(UNREADABLE, true);
  assert.equal(ur.enabled, false, 'an unreadable hold never turns Record transfer on');
  assert.equal(ur.retry, true);
  assert.equal(transferHold(LOADING, true).enabled, false);
  assert.deepEqual(transferHold(ok({ held: false }), false), { state: 'refused', enabled: false, reason: 'An Admin records transfers.' });
});

test('transfers total says what it counts, all time on this deal', () => {
  const t = transferRows(ok([
    { uid: 'a', amount_cents: 60000000, recorded_at: '2026-11-09T11:10', recorded_by_name: 'Name A', phone_verified: 1 },
    { uid: 'b', amount_cents: 25000000, recorded_at: '2026-11-12T15:40', recorded_by_name: null, phone_verified: 0 },
  ]));
  assert.equal(t.count, 2);
  assert.equal(t.totalCents, 85000000);
  assert.equal(t.rows[0].uid, 'b', 'newest first');
  assert.equal(t.rows[0].phoneVerified, false);
  assert.equal(transferRows(UNREADABLE).state, 'unreadable');
});

test('the Audit tab merges every record newest first; a closing event with no actor name reads Not recorded', () => {
  const transfers = transferRows(ok([{ uid: 't', amount_cents: 100, recorded_at: '2026-11-12T15:40', recorded_by_name: 'Name A' }]));
  const paper = paperRows(ok([{ id: 1, deal_id: 3, status: 'completed', document_title: 'SAFE', sent_at: '2026-11-02', completed_at: '2026-11-06' }]), 3);
  const a = auditRows({
    events: ok([{ item_label: 'Board consent', from_state: 'pending', to_state: 'done', at: '2026-11-13T10:05', actor_name: 'Name B' }]),
    transfers,
    paper,
    closing: ok({ events: [{ event: 'line_withdrawn', created_at: '2026-11-10T14:00' }] }),
  });
  assert.deepEqual(a.rows.map((r) => r.kind), ['Checklist', 'Transfers', 'Closing', 'Paper', 'Paper']);
  assert.equal(a.rows[0].what, 'Item “Board consent” moved Pending → Done');
  assert.equal(a.rows[2].who, null);
  assert.equal(a.rows[2].whoNote, 'Not recorded');
  assert.equal(a.rows[2].what, 'Line withdrawn');
  assert.deepEqual(a.counts, { All: 5, Checklist: 1, Paper: 2, Transfers: 1, Closing: 1 });
  const partial = auditRows({ events: UNREADABLE, transfers, paper, closing: ok(null) });
  assert.deepEqual(partial.unavailable, ['checklist history']);
});

test('before close, each unmet rule is written beside the unavailable Close action', () => {
  const rules = closeRules({ status: 'open', lines: [{ status: 'received' }, { status: 'sent' }, { status: 'withdrawn' }], captable: { state: 'not_ready' } });
  assert.equal(rules.canClose, false);
  assert.deepEqual(rules.rules.map((r) => [r.key, r.met]), [['settled', false], ['one_received', true], ['captable', false]]);
  assert.equal(rules.rules[0].detail, '1 line is not received yet.');
  assert.equal(rules.rules[1].detail, '1 of 2 lines received.', 'withdrawn lines are not counted');
  assert.equal(rules.unmet, 2);
  const proposed = closeRules({ status: 'open', lines: [{ status: 'received' }], captable: { state: 'proposed' } });
  assert.equal(proposed.rules[2].detail, 'Proposed · waiting on the founder.');
  assert.equal(proposed.canClose, false);
  assert.equal(closeRules({ status: 'open', lines: [{ status: 'received' }], captable: { state: 'accepted' } }).canClose, true);
  assert.equal(closeRules(null).state, 'none');
  assert.equal(closeRules({ status: 'closed', closed_at: '2026-12-04T09:00' }).closedAt, '2026-12-04');
});

test('tabs carry their counts; an investor has no Audit tab; a failed read says Unavailable', () => {
  const args = {
    checklist: { tab: '4 of 8' }, paper: { state: 'ready', rows: [1, 2, 3] },
    conditions: { tab: 'none open' }, transfers: { state: 'unreadable' },
  };
  const admin = workspaceTabs({ investor: false, ...args });
  assert.deepEqual(admin.map((t) => t.label), ['Checklist', 'Paper', 'Conditions', 'Transfer', 'Audit']);
  assert.deepEqual(admin.slice(0, 4).map((t) => t.count), ['4 of 8', '3', 'none open', UNAVAILABLE_WORD]);
  assert.ok(!workspaceTabs({ investor: true, ...args }).some((t) => t.key === 'audit'));
});

test('the side sheet sends only what changed, in the route’s names', () => {
  const item = { state: 'pending', owner_label: 'Name A', due_date: '2026-11-10', note: 'n' };
  assert.equal(itemPatch(item, { state: 'pending', owner: 'Name A', due: '2026-11-10', note: 'n' }), null, 'nothing changed, Save stays off');
  assert.deepEqual(itemPatch(item, { state: 'done', owner: 'Name A', due: '2026-11-10', note: 'n' }), { state: 'done' });
  assert.deepEqual(itemPatch(item, { state: 'pending', owner: ' Founder ', due: '', note: 'n' }), { owner_label: 'Founder', due_date: null });
  assert.deepEqual(itemPatch(item, { state: 'pending', owner: 'Name A', due: '2026-11-10', note: '  ' }), { note: null });
  assert.deepEqual(itemPatch({ state: 'pending', owner_name: 'Dana', due_date: null }, { state: 'pending', owner: 'Dana', due: '' }), null, 'a named owner is not resent as a label');
});

test('a status renders its word and glyph, never colour alone', () => {
  const html = renderToStaticMarkup(h(StatusWord, { status: { key: 'overdue', word: 'Overdue · 4 days', glyph: '◷' } }));
  assert.match(html, /◷/);
  assert.match(html, /Overdue · 4 days/);
});

test('the list opens each deal’s workspace, and the zone renders it from ?deal=', () => {
  const rows = closingRows({ deals: ready([{ id: 4, status: 'funded', project_name: 'Tidewater', capital_committed: 0, currency: 'USD' }]), envelopes: ready([]), conditions: ready([]), transfers: ready([]) }, {});
  assert.equal(rows.state, 'ready');
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].href, '/deals/closing?deal=4');
  assert.match(ZONE, /useSearchParams/);
  assert.match(ZONE, /params\.get\('deal'\)/);
  assert.match(ZONE, /<ClosingWorkspace/);
});

test('the workspace reads only routes main serves, asks the gate only as an Admin, and states the disclaimer once', () => {
  for (const r of ['dealClosingChecklist(', 'esignList(', 'icConditions(', 'dealTransfers(', 'transferGate(', 'events(', 'closingsApi.list(', 'closingsApi.read(']) {
    assert.ok(WS.includes(r), r);
  }
  assert.match(WS, /if \(isAdmin\) dealStaffApi\.transferGate/);
  assert.match(WS, /if \(!investor\) dealClosingHistoryApi\.events/);
  assert.equal(WS.split('{DISCLAIMER}').length - 1, 1, 'the disclaimer appears once');
  assert.equal(DISCLAIMER, 'Axal VC records money movement it is told about. It does not move money.');
  assert.match(WS, /tab === 'audit' && !investor/);
});
