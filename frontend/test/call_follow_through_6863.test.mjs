/**
 * D6863 (#6863, canvas D6053, RAC16 to RAC28) — a call's follow-through on the
 * founder's call page: the filter chips and selection, Remind with its sheet
 * and result, Export, Start a new call from a closed one, and Record a
 * commitment with its conflicts; a co-founder's refusals, the switched-off and
 * unreadable states.
 *
 * Mounted on a stubbed `fetch` that answers `GET /api/round-calls/:uid/follow-through`
 * as the Worker does. Every venture, call, person and figure is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/call_follow_through_6863.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CallFollowThrough from '../src/pages/founder/CallFollowThrough.jsx';
import {
  blockLine, chipCount, exportRow, lineConflict, remindResult, successorBody, toggleFilter, typedCents, visibleRecipients,
} from '../src/pages/founder/callFollowThroughModel.js';

const h = React.createElement;
const rec = (id, o = {}) => ({ recipient_id: id, named: true, origin: 'chosen', name: `Firm ${id}`, investor_user_id: id, reasons: [], group: 'not_opened',
  delivery_state: 'notified', opened_at: null, data_room_requested_at: null, responded_at: null, commitment_cents: null, committed_at: null,
  last_reminded_at: null, reminder_count: 0, block: null, next_reminder_from: null, line: null, in_pipeline: null, ...o });
const RECIPIENTS = [
  rec(1, { group: 'opened_unanswered', opened_at: '2099-10-03' }),
  rec(2),
  { ...rec(3, { origin: 'match', reasons: ['Climate'] }), named: false, name: undefined, investor_user_id: undefined },
  rec(4, { block: 'limit', reminder_count: 2, last_reminded_at: '2099-10-12T10:00:00.000Z' }),
  rec(5, { group: 'not_delivered', delivery_state: 'not_delivered' }),
  rec(6, { group: 'responded', responded_at: '2099-10-08', commitment_cents: 5000000, committed_at: '2099-10-08', block: 'responded', in_pipeline: true,
    line: { status: 'soft', stage: 'committed', amount_cents: 5000000, currency: 'USD', from_this_call: false } }),
  rec(7, { group: 'responded', responded_at: '2099-10-09', commitment_cents: 7500000, block: 'responded', in_pipeline: true,
    line: { status: 'wired', stage: 'committed', amount_cents: 5000000, currency: 'USD', from_this_call: false } }),
];
const read = (o = {}) => ({
  venture: { name: 'Lumen' },
  call: { uid: 'call-1', name: 'Bridge', state: 'sent', target_close: '2099-11-27', sent_at: '2099-10-01', closed_at: null, project_id: 7 },
  relation: 'owner', can: { remind: true, export: true, record: true, start_new: false },
  remind: { on: true, reason: null, sentence: null, limit: 2, spacing_days: 3 }, start_new: null,
  counts: { recipients: 7, not_opened: 3, opened_unanswered: 1, not_delivered: 1, responded: 2 },
  recipients: RECIPIENTS, exports: [], source: null, ...o,
});

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});

async function mounted(page, { write, call = { uid: 'call-1', name: 'Bridge', closed_at: '2099-10-12', amount_cents: 40000000, minimum_cheque_cents: 2500000, terms: 'Plain', instrument: 'safe' } } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const writes = []; const drafts = [];
  globalThis.fetch = async (u, options = {}) => {
    const url = String(u); const method = String(options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== 'GET') { writes.push({ method, url, body }); return write ? write(url, body) : response({}); }
    if (url === '/api/round-calls/call-1/follow-through') return typeof page === 'function' ? page() : response(page);
    return never();
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(CallFollowThrough, { uid: 'call-1', call, onOpenDraft: (c) => drafts.push(c) }))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    writes, drafts, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id}`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async tick(id) { await act(async () => { props(byId(id)).onChange({ target: {} }); }); await flush(); },
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; restore(); },
  };
}

/* ------------------------------------------------------------------ the model */

test('chips: counts are the Worker\'s, All clears the others, emptying them shows everyone', () => {
  // Mutation checked: All not clearing; a missing count drawn as 0.
  assert.equal(chipCount(read(), 'all'), 7);
  assert.equal(chipCount({ counts: {} }, 'not_opened'), null, 'a missing count is not zero');
  assert.deepEqual(toggleFilter(['not_opened', 'opened_unanswered'], 'all'), ['all']);
  assert.deepEqual(toggleFilter(['not_opened'], 'not_opened'), ['all']);
  assert.deepEqual(toggleFilter(['not_opened'], 'not_delivered'), ['not_opened', 'not_delivered']);
  assert.deepEqual(visibleRecipients(read(), ['not_delivered']).map((r) => r.recipient_id), [5]);
});

test('why a row cannot be ticked, the result in words, and the conflicts of a recorded commitment', () => {
  // Mutation checked: the limit line dropped; a Wired line left recordable; another currency left recordable; blank read as 0.
  assert.equal(blockLine(RECIPIENTS[3]), 'Reminded twice · limit reached');
  assert.equal(blockLine({ block: 'too_soon', next_reminder_from: '2099-10-15T10:00:00.000Z' }), 'Next reminder from 15 Oct');
  const res = remindResult({ asked: 12, reminded: 11, not_reminded: [{ name: 'Firm 9', reason: 'account_unavailable' }, { name: null, reason: 'limit' }] });
  assert.equal(res.head, '11 of 12 were reminded on Axal.');
  assert.deepEqual(res.rest, ['Firm 9 was not reminded: Not delivered · account not active.', 'A matching investor was not reminded: reminded twice · limit reached.']);
  assert.equal(lineConflict(RECIPIENTS[6]).kind, 'already_wired');
  assert.equal(lineConflict(RECIPIENTS[6]).off, true);
  assert.equal(lineConflict({ ...RECIPIENTS[5], line: { ...RECIPIENTS[5].line, currency: 'EUR' } }).kind, 'other_currency');
  assert.equal(lineConflict({ ...RECIPIENTS[5], in_pipeline: false, line: null }).kind, 'no_line');
  assert.equal(lineConflict({ ...RECIPIENTS[5], line: { ...RECIPIENTS[5].line, status: 'signed' } }).onlyWired, true);
  assert.equal(lineConflict(RECIPIENTS[5]).kind, 'ok');
  assert.equal(typedCents(''), null, 'blank is not recorded, never $0');
  assert.equal(typedCents('45,000'), 4500000);
  assert.equal(exportRow({ format: 'csv', scope: 'responses', questions_state: 'unreadable', exported_at: '2099-10-13T09:10:00Z', exported_by_name: 'Fay', exported_by_you: true }, 'Seed').marked.text, 'Questions could not be read');
});

test('a new call from a closed one needs its own name and a close date; the terms carry', () => {
  const src = { name: 'Seed extension' };
  assert.equal(successorBody({ name: 'Seed extension', target_close: '2099-12-01', amount: '400000', minimum: '25000', terms: 't' }, src, '2099-11-01').error, 'Give the new call its own name.');
  assert.equal(successorBody({ name: 'Bridge', target_close: '', amount: '400000', minimum: '25000', terms: 't' }, src, '2099-11-01').error, 'Choose a close date, today or later.');
  assert.deepEqual(successorBody({ name: 'Bridge', target_close: '2099-12-01', amount: '400,000', minimum: '25000', terms: ' t ' }, src, '2099-11-01').body,
    { name: 'Bridge', target_close: '2099-12-01', amount_cents: 40000000, minimum_cheque_cents: 2500000, terms: 't' });
});

/* ------------------------------------------------------------------ the page */

test('the owner ticks who has not acted and reminds them; a row at the limit is off and says why; a match stays unnamed', async () => {
  // Mutation checked: the disabled checkbox for a blocked row; Remind sending unticked rows; the result line not drawn.
  const p = await mounted(read(), { write: () => response({ asked: 2, reminded: 1, reminded_ids: [1], not_reminded: [{ recipient_id: 3, name: null, reason: 'not_delivered' }] }) });
  try {
    assert.equal(p.textOf('ft-chip-not_opened'), 'Not opened 3');
    assert.equal(p.textOf('ft-chip-opened_unanswered'), 'Opened, not answered 1');
    assert.equal(p.props('ft-chip-not_opened')['aria-pressed'], true);
    assert.equal(p.props('ft-chip-not_delivered')['aria-pressed'], false);
    assert.match(p.textOf('ft-row-3'), /Matching investor · Climate/);
    assert.doesNotMatch(p.text(), /Firm 3/);
    assert.equal(p.props('ft-check-4').disabled, true);
    assert.equal(p.textOf('ft-why-4'), '⦸ Reminded twice · limit reached');
    assert.equal(p.textOf('ft-last-4'), '12 Oct · 2 of 2');
    assert.equal(p.props('ft-remind').disabled, true, 'nothing ticked');
    await p.tick('ft-check-1'); await p.tick('ft-check-3');
    assert.equal(p.textOf('ft-remind'), 'Remind (2)');
    await p.click('ft-remind');
    assert.match(p.textOf('ft-remind-preview'), /Lumen invited you to a private round call\. It closes on 27 Nov 2099\./);
    assert.match(p.textOf('ft-remind-who'), /Opened, not answered1 · 1 named/);
    assert.match(p.textOf('ft-remind-who'), /1 · 0 named, 1 matching investor \(not named\)/);
    assert.match(p.textOf('ft-remind-limit'), /At most 2 reminders per recipient per call, at least 3 days apart\./);
    assert.equal(p.writes.length, 0, 'nothing is sent before Remind');
    await p.click('ft-remind-confirm');
    assert.deepEqual(p.writes, [{ method: 'POST', url: '/api/round-calls/call-1/remind', body: { recipient_ids: [1, 3] } }]);
    assert.match(p.textOf('ft-remind-result'), /1 of 2 were reminded on Axal\.A matching investor was not reminded: Not delivered\./);
  } finally { await p.close(); }
});

test('a co-founder sees Remind and Export off with the reason, and can record a commitment', async () => {
  // Mutation checked: the owner-only line dropped; Export left on for a co-founder; Record off for a co-founder.
  const p = await mounted(read({ relation: 'member', can: { remind: false, export: false, record: true, start_new: false } }));
  try {
    assert.equal(p.textOf('ft-owner-only'), '⦸ Only the venture’s owner can remind or export.');
    assert.equal(p.props('ft-export').disabled, true);
    assert.equal(p.props('ft-remind').disabled, true);
    assert.equal(p.has('ft-sticky'), false, 'no sticky Remind bar for a co-founder');
    assert.equal(p.props('ft-record-6').disabled, false);
    assert.equal(p.props('ft-record-7').disabled, true, 'already Wired');
  } finally { await p.close(); }
});

test('Record a commitment: the typed amount, Signed or Wired, and the note that it differs from the indicated', async () => {
  // Mutation checked: the indicated amount posted instead of the typed one; the differs line missing; the confirm on with a blank amount.
  const p = await mounted(read(), { write: (url, body) => response({ recorded: { status: body.status, amount_cents: body.amount_cents, at: '2099-11-14', prospect_id: 1, round_call_uid: 'call-1' } }) });
  try {
    assert.match(p.textOf('ft-response-6'), /\$50,000Indicated · Soft · not counted/);
    await p.click('ft-record-6');
    assert.match(p.textOf('ft-record-indicated'), /^Indicated \$50,000 on 8 Oct through Bridge/);
    assert.equal(p.props('ft-record-confirm').disabled, true, 'a blank amount records nothing');
    await p.change('ft-record-amount', '45,000');
    assert.equal(p.textOf('ft-record-differs'), '≠ Differs from the indicated $50,000');
    assert.equal(p.textOf('ft-record-confirm'), 'Record as Signed');
    await p.click('ft-record-confirm');
    assert.deepEqual(p.writes, [{ method: 'POST', url: '/api/round-calls/call-1/commitments', body: { recipient_id: 6, status: 'signed', amount_cents: 4500000 } }]);
    assert.match(p.textOf('ft-recorded'), /Recorded as Signed · \$45,000 · Firm 6\./);
  } finally { await p.close(); }
});

test('a closed call: Start a new call is off while another is open, and on opens step 1 with the copied banner', async () => {
  // Mutation checked: the block reason dropped; the copied banner missing; the new draft not handed on.
  const closed = { call: { uid: 'call-1', name: 'Seed extension', state: 'closed', target_close: '2099-10-12', sent_at: '2099-10-01', closed_at: '2099-10-12', project_id: 7 },
    remind: { on: false, reason: 'call_closed', sentence: 'This call is closed. Nobody can be reminded.', limit: 2, spacing_days: 3 } };
  const off = await mounted(read({ ...closed, start_new: { on: false, sentence: 'One call at a time. Bridge is open.' } }));
  try {
    assert.equal(off.props('ft-start-new').disabled, true);
    assert.equal(off.textOf('ft-start-off'), 'Start a new call is off: One call at a time. Bridge is open.');
    assert.equal(off.has('ft-remind-section'), false, 'a closed call has no Remind');
  } finally { await off.close(); }
  const on = await mounted(read({ ...closed, start_new: { on: true, sentence: null } }), {
    call: { uid: 'call-1', name: 'Seed extension', closed_at: '2099-10-12', amount_cents: 50000000, minimum_cheque_cents: 2500000, terms: 'Plain', instrument: 'safe' },
    write: () => response({ call: { uid: 'new-1', state: 'draft', source_call_id: 1 } }, 201),
  });
  try {
    await on.click('ft-start-new');
    assert.equal(on.textOf('ft-copied-banner'), 'Copied from Seed extension, closed 12 Oct. Edit anything below. Nothing is sent; this is a draft.');
    assert.equal(on.props('ft-new-amount').value, '500000');
    await on.change('ft-new-name', 'Bridge'); await on.change('ft-new-close', '2099-12-01');
    await on.click('ft-new-save');
    assert.deepEqual(on.writes.map((w) => [w.url, w.body.name, w.body.amount_cents]), [['/api/round-calls/call-1/successor', 'Bridge', 50000000]]);
    assert.deepEqual(on.drafts.map((c) => c.uid), ['new-1']);
  } finally { await on.close(); }
});

test('switched off draws nothing; a failed read says Unavailable, never an empty list', async () => {
  // Mutation checked: the switched-off read drawn as Unavailable; a failed read drawn as no recipients.
  const off = await mounted(() => response({ error: 'Coming soon', code: 'round_calls_disabled' }, 503));
  try { assert.equal(off.text(), ''); } finally { await off.close(); }
  const bad = await mounted(() => response({ error: 'x', code: 'round_calls_unreadable' }, 500));
  try {
    assert.match(bad.text(), /Unavailable/);
    assert.equal(bad.has('ft-chips'), false);
  } finally { await bad.close(); }
});
