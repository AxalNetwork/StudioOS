/**
 * D4838 PP04 / PP04m (#5937) — Pipeline · Proposals as a follow-up list.
 *
 * The rules (`proposalsFollowUp.js`) are driven with plain rows shaped like
 * `GET /partner/pipeline/proposals`; the zone is mounted through the fake DOM with
 * `api` stubbed, and checked for what a person sees: the five columns with no
 * version column, Opened as Not recorded with the Worker's note, a win rate with its
 * denominator or "No decided quotes", Bulk nudge and the CSV export under More, one
 * card per proposal on a phone, and a row that opens a tabbed sheet whose writes
 * (withdraw, loss reason) still reach their routes.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pipeline_proposals_follow_up_5937.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import PartnerProposalsZone from '../src/pages/partner/pipeline/ProposalsZone.jsx';
import {
  activityOf, lastActivity, nextAction, proposalStrip, sheetTabs, stateOf,
} from '../src/pages/partner/pipeline/proposalsFollowUp.js';

const h = React.createElement;

const row = (over = {}) => ({
  quote_id: 1, client: 'Brightline', need_title: 'Brand system', shape: 'Fixed scope',
  price_dollars: 18000, timeline_weeks: 6, version: 1, versions: [], status: 'submitted', state: 'Sent',
  decided: false, decided_at: null, loss_reason: null, days_since_sent: 2, signal: 'Sent · silent 2 days',
  engagement_id: null, ...over,
});
const NOTE = 'Nothing records that a client opened a proposal. There is no client-side surface to record it on.';
const body = (items, over = {}) => ({
  items, loss_reasons: [], losses_unstated: 0, live_count: items.filter((r) => r.status === 'submitted').length,
  live_value_dollars: 30000, won_count: 0, lost_count: 0, decided_count: 0, withdrawn_count: 0, win_rate_pct: null,
  read_receipts: 'none', read_receipts_note: NOTE, ...over,
});

/* ───────────────────────────── the rules ───────────────────────────── */

test('last activity is the newest recorded thing: decision, then version, then the send', () => {
  assert.deepEqual(lastActivity(row({ days_since_sent: 3 })), { key: 'sent', at: null, days: 3, text: 'Sent 3 days ago' });
  assert.equal(lastActivity(row({ days_since_sent: 0 })).text, 'Sent today');
  const revised = row({ versions: [
    { id: 1, version: 1, change_summary: 'Split into phases', created_at: '2026-10-20T10:00:00Z' },
    { id: 2, version: 2, change_summary: 'Lower fee', created_at: '2026-10-30T10:00:00Z' },
  ] });
  assert.equal(lastActivity(revised).text, 'v2 recorded · Lower fee');
  const lost = { ...revised, status: 'rejected', state: 'Lost', decided: true, decided_at: '2026-11-04T09:00:00Z' };
  assert.equal(lastActivity(lost).text, 'Lost');
  assert.deepEqual(activityOf(lost).map((a) => a.key), ['decided', 'v-2', 'v-1', 'sent'], 'newest first, the send last');
  // NOTHING DATED AND NO AGE IS NOT "today": it is nothing to say.
  assert.equal(lastActivity(row({ days_since_sent: null })), null);
});

test('state says what the record holds, and never "no reply" or "unopened"', () => {
  assert.deepEqual(stateOf(row()), { word: 'Sent', detail: 'no decision recorded' });
  assert.equal(stateOf(row({ state: 'Lost', status: 'rejected' })).detail, 'no reason recorded');
  assert.equal(stateOf(row({ state: 'Lost', status: 'rejected', loss_reason: 'price' })).reason, 'price');
});

test('next action follows the state, and a withdrawn proposal asks for nothing', () => {
  assert.deepEqual(nextAction(row({ days_since_sent: 2 })), { key: 'follow-up', label: 'Follow up', tab: 'overview', urgent: false });
  assert.equal(nextAction(row({ days_since_sent: 7 })).urgent, true, 'the command centre’s seven-day rule');
  assert.deepEqual(nextAction(row({ status: 'rejected', state: 'Lost' })), { key: 'reason', label: 'Record why it was lost', tab: 'outcome', urgent: true });
  assert.equal(nextAction(row({ status: 'rejected', state: 'Lost', loss_reason: 'timing' })).label, 'Review');
  assert.equal(nextAction(row({ status: 'accepted', state: 'Won', engagement_id: 9 })).to, '/delivery/board');
  assert.equal(nextAction(row({ status: 'withdrawn', state: 'Withdrawn' })).label, null);
});

test('the sheet’s tabs are the issue’s, as the row’s data allows', () => {
  assert.deepEqual(sheetTabs(row()), ['overview', 'proposal', 'activity', 'versions', 'outcome']);
  assert.deepEqual(sheetTabs(row({ price_dollars: null, timeline_weeks: null, days_since_sent: null })),
    ['overview', 'versions', 'outcome'], 'a tab drawn over nothing');
});

test('the strip: no decided quotes is words, a rate carries its denominator, and opens are never counted', () => {
  const none = proposalStrip(body([row()]));
  assert.equal(none.win.value, 'No decided quotes');
  assert.equal(none.opened.recorded, false);
  assert.equal(none.open.value, '1');
  const some = proposalStrip(body([row({ days_since_sent: 9 }), row({ quote_id: 2, days_since_sent: 3 }),
    row({ quote_id: 3, status: 'withdrawn', state: 'Withdrawn', days_since_sent: 30 })],
  { won_count: 8, lost_count: 11, decided_count: 19, win_rate_pct: 42.1 }));
  assert.deepEqual([some.win.value, some.win.note], ['42%', '8 of 19 decided']);
  assert.equal(some.quiet.value, '1', 'only a sent, undecided proposal 7+ days old counts — not a withdrawn one');
  assert.equal(proposalStrip({ ...body([row({ days_since_sent: 9 })]), remainder_error: true }).quiet.value, '1+',
    'a partial read is a floor');
});

/* ───────────────────────────── mounted ───────────────────────────── */

function stub(methods) {
  const saved = {};
  for (const [k, v] of Object.entries(methods)) { saved[k] = api[k]; api[k] = v; }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete api[k]; else api[k] = v; } };
}
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

async function mount(items, extra = {}, over = {}) {
  const restore = stub({ listPartnerProposals: async () => body(items, over), ...extra });
  const m = await mountContracts(h(PartnerProposalsZone));
  await m.flush();
  const byTestid = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  const buttons = (label) => m.nodes().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  const press = async (label, i = 0) => {
    const n = buttons(label)[i];
    if (!n) throw new Error(`Missing button: ${label}`);
    if (m.props(n).disabled) throw new Error(`Disabled button: ${label}`);
    await act(async () => { m.props(n).onClick({ stopPropagation() {} }); });
  };
  return { m, restore, byTestid, buttons, press };
}

const ITEMS = [
  row(),
  row({ quote_id: 2, client: 'Pinecrest', price_dollars: 9500, status: 'rejected', state: 'Lost', decided: true, decided_at: '2026-11-04T09:00:00Z', days_since_sent: 12 }),
  row({ quote_id: 3, client: 'Aster Cloud', price_dollars: 32500, status: 'accepted', state: 'Won', decided: true, decided_at: '2026-10-12T09:00:00Z', engagement_id: 7, versions: [{ id: 31, version: 1, change_summary: 'Phased', created_at: '2026-10-01T09:00:00Z', price_cents: null, note: '' }] }),
];

test('desktop: five columns, no version column, Opened Not recorded with the Worker’s note', async () => {
  const { m, restore, byTestid } = await mount(ITEMS);
  try {
    const table = byTestid('all-proposals');
    const heads = m.nodes().filter((n) => n.tagName === 'TH').map(textOf);
    assert.deepEqual(heads, ['Client', 'Value', 'State', 'Last activity', 'Next action']);
    assert.equal(table.childNodes.find((n) => n.tagName === 'TBODY').childNodes.length, 3);
    assert.doesNotMatch(textOf(table), /\bv\d\b/, 'a version number is drawn in the list');
    const strip = textOf(byTestid('proposals-strip'));
    assert.match(strip, /OpenedNot recorded/);
    assert.doesNotMatch(m.text(), /Unopened|Opened \d|×/, 'an open count is drawn');
    assert.match(textOf(byTestid('read-receipts-note')), /Opens aren’t recorded\. Nothing records that a client opened a proposal/);
    assert.match(textOf(byTestid('proposals-win-rate')), /No decided quotes/);
    assert.match(textOf(table), /Lost.*No reason recorded/, 'the lost row with no reason is not marked');
    assert.match(textOf(table), /Record why it was lost/);
  } finally { await m.unmount(); restore(); }
});

test('phone: one card per proposal with client, value, state, last activity and next action', async () => {
  const { m, restore, byTestid } = await mount(ITEMS);
  try {
    const cards = byTestid('proposal-cards').childNodes;
    assert.equal(cards.length, 3);
    const first = textOf(cards[0]);
    for (const part of ['Brightline', '$18K', 'Sent', 'Sent 2 days ago', 'Follow up']) assert.ok(first.includes(part), `card lacks ${part}`);
  } finally { await m.unmount(); restore(); }
});

test('Bulk nudge and the CSV export sit under More, neither removed', async () => {
  const { m, restore, byTestid, press } = await mount(ITEMS);
  try {
    assert.ok(!m.nodes().some((n) => m.props(n)?.role === 'menuitem'), 'the menu is open before More is pressed');
    await press('More ▾');
    const items = m.nodes().filter((n) => m.props(n)?.role === 'menuitem');
    const labels = items.map((n) => textOf(n));
    assert.equal(labels.length, 2);
    assert.ok(labels[0].startsWith('Bulk: nudge unopened'), labels[0]);
    assert.ok(labels[1].startsWith('Export win/loss CSV'), labels[1]);
    assert.equal(m.props(items[0]).disabled, true, 'the nudge became pressable with nothing to send it');
    assert.equal(m.props(items[1]).disabled, false, 'the export stopped running');
    assert.ok(byTestid('proposals-more'));
  } finally { await m.unmount(); restore(); }
});

test('the row opens the sheet with its tabs; Outcome records a loss reason and Withdraw reaches its route', async () => {
  const calls = [];
  const { m, restore, byTestid, press, buttons } = await mount(ITEMS, {
    setPartnerProposalOutcome: async (id, b) => { calls.push(['outcome', id, b]); return { ok: true }; },
    withdrawQuote: async (id) => { calls.push(['withdraw', id]); return { ok: true }; },
  });
  try {
    await press('Pinecrest');
    assert.ok(byTestid('proposal-sheet'));
    const tabs = m.nodes().filter((n) => m.props(n)?.role === 'tab').map(textOf);
    assert.deepEqual(tabs, ['Overview', 'Proposal', 'Activity', 'Versions', 'Outcome']);
    assert.match(textOf(byTestid('proposal-sheet-overview')), /OpenedNot recorded/);
    await press('Outcome');
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const select = walk(byTestid('proposal-sheet-outcome')).find((n) => n.tagName === 'SELECT');
    await act(async () => { m.props(select).onChange({ target: { value: 'price' } }); });
    await m.flush();
    assert.deepEqual(calls[0], ['outcome', 2, { loss_reason: 'price' }]);

    const close = m.nodes().find((n) => n.tagName === 'BUTTON' && m.props(n)['aria-label'] === 'Close proposal' && textOf(n).trim() === '✕');
    await act(async () => { m.props(close).onClick(); });
    assert.equal(byTestid('proposal-sheet'), undefined, 'the sheet did not close');
    // The Next action button opens the sheet on its tab: Follow up → Overview.
    await press('Follow up');
    assert.ok(byTestid('proposal-sheet-overview'));
    assert.match(textOf(byTestid('proposal-sheet-overview')), /nothing here sends mail/);
    await press('Outcome');
    assert.equal(buttons('Withdraw').length, 1);
    await press('Withdraw');
    await m.flush();
    assert.deepEqual(calls[1], ['withdraw', 1]);
  } finally { await m.unmount(); restore(); }
});

test('Versions shows the trail and aims the version form at that proposal', async () => {
  const { m, restore, byTestid, press } = await mount(ITEMS);
  try {
    await press('Aster Cloud');
    await press('Versions');
    assert.match(textOf(byTestid('version-history')), /Version history · Aster Cloud.*v1.*Phased/);
    await press('Record a version');
    assert.equal(byTestid('proposal-sheet'), undefined, 'the sheet stayed open over the form');
    const sel = m.nodes().find((n) => n.tagName === 'SELECT' && n.childNodes.some((o) => textOf(o) === 'Choose one'));
    assert.equal(m.props(sel).value, 3, 'the form is not aimed at the proposal whose sheet asked');
  } finally { await m.unmount(); restore(); }
});
