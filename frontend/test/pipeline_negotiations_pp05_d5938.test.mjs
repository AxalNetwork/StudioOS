/**
 * D5938 (#5938, part of #4838) — Pipeline · Negotiations drawn to `Pipeline v2`
 * PP05 (the board), PP05b (the terms sheet) and PP05m (phone, a stage
 * selector).
 *
 * Mounted React tests through the fake DOM in `_contracts_dom.mjs`, with the
 * `api` methods stubbed: what a person sees and what a press writes.
 *
 *   · the lanes are the recorded stages, each headed by its name and count,
 *     and no WIP limit is drawn;
 *   · a card answers who, how much, what is open, who has the ball and how
 *     long it has waited, and a wait nobody recorded reads Not recorded,
 *     never 0;
 *   · a card moves by a button (so by keyboard), writing only its stage;
 *   · the sheet compares We proposed / They proposed / Current position and
 *     marks a difference with ≠ and words, not only colour;
 *   · the Eadwyn counter's "Not sent" and its three controls are drawn only
 *     while a counter draft exists, and nothing says Send counter;
 *   · on a phone the stages are one radio group over one list.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pipeline_negotiations_pp05_d5938.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import PartnerNegotiationsZone from '../src/pages/partner/pipeline/NegotiationsZone.jsx';
import { termsDiffer, waitedText } from '../src/pages/partner/pipeline/NegotiationTermsSheet.jsx';

const h = React.createElement;

function stub(methods, on = api) {
  const saved = {};
  for (const [k, v] of Object.entries(methods)) { saved[k] = on[k]; on[k] = v; }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete on[k]; else on[k] = v; } };
}

const row = (id, who, stage, extra = {}, terms = []) => ({
  quote_id: id, quote_uid: `Q-${id}`, need_title: `Need ${id}`, need_category: 'retainer', quote_status: 'submitted',
  price: 18000, founder_name: who,
  negotiation: { stage, ball: 'us', open_question: 'Cancellation period', days_stalled: 4, open: true, ...extra },
  terms,
});
const BOOK = () => ([
  row(1, 'Verwood', 'terms', {}, [
    { id: 11, label: 'Monthly fee', our_position: '$6,000', their_position: '$6,000', landing: '$6,000', state: 'agreed' },
    { id: 12, label: 'Cancellation period', our_position: '60 days', their_position: '30 days', landing: '', state: 'open' },
    { id: 13, label: 'Overage rate', our_position: '$180 / h', their_position: null, landing: '', state: 'open' },
  ]),
  row(2, 'Marlow Studio', 'terms', { ball: 'them', days_stalled: null, open_question: '' }),
  row(3, 'Kite Systems', 'legal', { days_stalled: 9 }),
  { ...row(4, 'Fjord Data', 'scoping'), negotiation: null },
]);
const body = (items) => ({ items, live_count: 3, live_value_dollars: 54000, awaiting_us_count: 2, awaiting_them_count: 1, stalled_count: 1 });

function finders(m) {
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const all = () => m.nodes();
  const byLabel = (label) => all().find((n) => m.props(n)?.['aria-label'] === label);
  const buttons = (text) => all().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === text);
  const press = async (n) => { await act(async () => { m.props(n).onClick({ stopPropagation() {} }); }); };
  return { textOf, all, byLabel, buttons, press };
}

async function mount({ items = BOOK(), drafts = [], save } = {}) {
  const calls = [];
  let current = items;
  const restore = stub({
    listPartnerNegotiations: async () => body(current),
    savePartnerNegotiation: save || (async (id, patch) => {
      calls.push([id, patch]);
      current = current.map((r) => (r.quote_id === id ? { ...r, negotiation: { ...r.negotiation, ...patch } } : r));
      return {};
    }),
  });
  const restoreResearch = stub({ zoneDrafts: async () => ({ items: drafts }) }, api.research);
  const m = await mountContracts(h(PartnerNegotiationsZone), '/pipeline/negotiations');
  await m.flush(); await m.flush();
  return { m, f: finders(m), calls, done: async () => { await m.unmount(); restore(); restoreResearch(); } };
}

test('the lanes are the four recorded stages, each headed by its name and count; no limit is drawn', async () => {
  const { m, f, done } = await mount();
  try {
    for (const [name, n] of [['Scoping', 0], ['Terms', 2], ['Legal', 1], ['Ready to sign', 0]]) {
      const lane = f.byLabel(`${name}, ${n} negotiations`);
      assert.ok(lane, `no ${name} lane with ${n}`);
      const head = lane.childNodes.find((c) => c.tagName === 'H3');
      assert.equal(f.textOf(head).trim(), `${name}${n}`, `${name}'s header is its name and count`);
      assert.doesNotMatch(f.textOf(head), /\//, 'a lane draws a limit');
    }
    assert.equal(f.byLabel('Closed, 0 negotiations'), undefined, 'closed is drawn as a lane');
    // The untracked quote is not on the board, but is still reachable.
    assert.match(m.text(), /Not on the board · 1/);
    assert.equal(f.buttons('Start tracking').length, 1);
  } finally { await done(); }
});

test('a card answers who, how much, what is open, the ball and the wait — and an unrecorded wait is never 0', async () => {
  const { f, done } = await mount();
  try {
    const card = (who) => f.textOf(f.byLabel(who));
    const verwood = card('Verwood');
    assert.match(verwood, /\$18K · retainer/);
    assert.match(verwood, /Cancellation period/);
    assert.match(verwood, /2 open terms/);
    assert.match(verwood, /Us/);
    assert.match(verwood, /4 days/);
    const marlow = card('Marlow Studio');
    assert.match(marlow, /Client/, 'the ball with them reads Client in words');
    assert.match(marlow, /No blocker named/);
    assert.match(marlow, /Not recorded/);
    assert.match(marlow, /no move logged/);
    assert.doesNotMatch(marlow, /\b0 ?d|\b0 days/, 'a wait nobody recorded is drawn as zero');
    assert.match(card('Kite Systems'), /9 days · stalled/, 'a stalled card says so in words');
    assert.equal(waitedText(null), null);
    assert.equal(waitedText(0), 'Moved today');
    assert.equal(waitedText(1), '1 day');
  } finally { await done(); }
});

test('a card moves by a button, writing only its stage, and lands in the next lane', async () => {
  const { m, f, calls, done } = await mount();
  try {
    const move = f.byLabel('Move Verwood on to Legal');
    assert.ok(move && move.tagName === 'BUTTON', 'the move is a button, so a keyboard reaches it');
    assert.ok(f.byLabel('Move Verwood back to Scoping'), 'a card can move back too');
    assert.equal(f.byLabel('Move Kite Systems on to Ready to sign')?.tagName, 'BUTTON');
    await f.press(move);
    await m.flush();
    assert.deepEqual(calls, [[1, { stage: 'legal' }]], 'the move wrote more than its stage');
    assert.ok(f.byLabel('Legal, 2 negotiations'), 'the card is not in Legal');
    assert.ok(f.byLabel('Terms, 1 negotiations'));
  } finally { await done(); }
});

test('a move the server refuses leaves the card where it was and says so', async () => {
  const { m, f, done } = await mount({ save: async () => { throw new Error('nope'); } });
  try {
    await f.press(f.byLabel('Move Verwood on to Legal'));
    await m.flush();
    assert.ok(f.byLabel('Terms, 2 negotiations'), 'the card moved without the server');
    assert.match(m.text(), /That did not save/);
  } finally { await done(); }
});

test('the terms sheet compares the three positions and marks a difference with ≠ and words', async () => {
  const { m, f, done } = await mount();
  try {
    await f.press(f.buttons('Open terms')[0]);
    const sheet = f.all().find((n) => m.props(n)?.['data-testid'] === 'negotiation-terms-sheet');
    assert.ok(sheet, 'no sheet opened');
    assert.equal(m.props(sheet).role, 'dialog');
    const text = f.textOf(sheet);
    assert.match(text, /Negotiation · Terms/);
    assert.match(text, /Verwood · \$18K/);
    assert.match(text, /TermWe proposedThey proposedCurrent position/);
    const rows = f.all().filter((n) => m.props(n)?.['data-term-row'] !== undefined);
    const rowText = Object.fromEntries(rows.map((r) => [m.props(r)['data-term-row'], f.textOf(r)]));
    assert.match(rowText[12], /^≠Sides differ: Cancellation period60 days30 daysOpen/, 'a difference is not marked');
    assert.doesNotMatch(rowText[11], /≠|Sides differ/, 'an agreed clause is marked as apart');
    assert.match(rowText[11], /\$6,000 · agreed/);
    assert.doesNotMatch(rowText[13], /≠|Sides differ/, 'a clause with one side unrecorded is marked as apart');
    assert.match(rowText[13], /Not recorded/);
    assert.match(text, /≠ marks a term the two sides differ on \(1 of 3\)/);
    assert.equal(termsDiffer({ our_position: ' 30  Days', their_position: '30 days' }), false, 'spacing and case are not a difference');
  } finally { await done(); }
});

test('the Eadwyn counter is drawn “Not sent” only while a draft exists, and nothing says Send counter', async () => {
  const none = await mount();
  try {
    assert.doesNotMatch(none.m.text(), /Not sent/);
    assert.equal(none.f.buttons('Accept counter draft').length, 0);
    assert.equal(none.f.buttons('Edit terms').length, 0);
    assert.doesNotMatch(none.m.text(), /Send counter/);
  } finally { await none.done(); }
  const one = await mount({ drafts: [{ uid: 'd1', body: 'Cancellation 45 days.', accepted: false, cost_usd: 0.01 }] });
  try {
    assert.match(one.m.text(), /Eadwyn counter proposal/);
    assert.match(one.m.text(), /Not sent/);
    assert.match(one.m.text(), /Cancellation 45 days\./);
    for (const b of ['Accept counter draft', 'Edit terms', 'Discard']) assert.equal(one.f.buttons(b).length, 1, `no ${b}`);
    assert.match(one.m.text(), /nothing is sent to the client/);
    assert.doesNotMatch(one.m.text(), /Send counter/);
  } finally { await one.done(); }
});

test('on a phone the stages are one radio group over one list, not four lanes', async () => {
  const saved = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const { m, f, done } = await mount();
  try {
    assert.equal(f.all().find((n) => m.props(n)?.['data-testid'] === 'negotiation-lanes'), undefined, 'the lanes are drawn on a phone');
    const group = f.all().find((n) => m.props(n)?.role === 'radiogroup' && m.props(n)['aria-label'] === 'Stage');
    assert.ok(group, 'no stage selector');
    const radios = group.childNodes.filter((n) => m.props(n)?.role === 'radio');
    assert.deepEqual(radios.map((r) => m.props(r)['aria-label']), ['Scoping, 0', 'Terms, 2', 'Legal, 1', 'Ready to sign, 0']);
    assert.deepEqual(radios.map((r) => f.textOf(r)), ['Scoping 0', 'Terms 2', 'Legal 1', 'Ready 0']);
    // The first stage with a card is chosen, and only its cards are listed.
    assert.deepEqual(radios.map((r) => m.props(r)['aria-checked']), [false, true, false, false]);
    assert.ok(f.byLabel('Verwood') && f.byLabel('Marlow Studio'));
    assert.equal(f.byLabel('Kite Systems'), undefined, 'another stage’s card is listed');
    // Arrow keys move the choice, as a radio group's do.
    await act(async () => { m.props(group).onKeyDown({ key: 'ArrowRight', preventDefault() {} }); });
    assert.ok(f.byLabel('Kite Systems'), 'ArrowRight did not choose Legal');
    assert.equal(f.byLabel('Verwood'), undefined);
    assert.ok(f.byLabel('Legal, 1 negotiations'));
  } finally {
    await done();
    if (saved === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = saved;
  }
});
