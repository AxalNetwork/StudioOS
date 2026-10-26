// D1023 (#2860, part 8 of #2432) — Instruments (CT3, CT3b), the instrument
// drawer (CT4) and Option pool (CT5, CT5c). Fixtures follow the Worker's shapes
// (services/capTableRecord.ts, routes/captable.ts /today and /simulate,
// services/capTableRegister.ts equityPlanBody, the 409A read) and every figure
// is worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  CANNOT_CONVERT_LINE, EMPTY_FILTERS, bindingLine, convertBody, convertView, filterInstruments, instrumentHref,
  instrumentView, over100, price, recordInstruments, todayShares,
} from '../src/pages/raise/captable/instrumentsModel.js';
import {
  EXERCISES_NOT_RECORDED, burnDown, eventBody, filterGrants, grantRows, harbourChecks, isCarta, poolTarget, poolTiles,
  valuationBody, vestedFoot,
} from '../src/pages/raise/captable/poolModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const iss = (o) => ({ status: 'recorded', source: 'typed', origin: 'owner', from_holder: null, from_class_uid: null, class_uid: null, related_uid: null, shares: null, amount_cents: null, currency: 'USD', price_per_share_micros: null, issued_on: null, terms: {}, document_ref: null, ...o });
const INSTRUMENTS = [
  iss({ uid: 'i-north', kind: 'safe', holder: { holder_id: null, name: 'Northwind Angels' }, amount_cents: 15000000, issued_on: '2026-09-02', source: 'connector_mercury', document_ref: 'data_room_files:9',
    terms: { cap_cents: 1000000000, discount_bps: 1500, basis: 'post_money', mfn: true, interest_bps: null, maturity_on: null } }),
  iss({ uid: 'i-harbor', kind: 'safe', holder: { holder_id: null, name: 'Harbor Seed Fund' }, amount_cents: 25000000, issued_on: '2026-07-14', source: 'document',
    terms: { cap_cents: 800000000, discount_bps: 2000, basis: 'pre_money', mfn: true, interest_bps: null, maturity_on: null } }),
  iss({ uid: 'i-kai', kind: 'safe', holder: { holder_id: null, name: 'Kai Angel' }, amount_cents: 5000000, issued_on: '2026-10-01',
    terms: { cap_cents: null, discount_bps: null, basis: 'post_money', mfn: null, interest_bps: null, maturity_on: null } }),
  iss({ uid: 'i-note', kind: 'note', holder: { holder_id: null, name: 'Angel Note' }, amount_cents: 10000000, issued_on: '2025-08-01',
    terms: { cap_cents: null, discount_bps: 2000, basis: null, mfn: false, interest_bps: 800, maturity_on: '2027-08-01' } }),
  iss({ uid: 'i-old', kind: 'safe', holder: { holder_id: null, name: 'Old Fund' }, amount_cents: 2000000, issued_on: '2025-01-01',
    terms: { cap_cents: 400000000, discount_bps: null, basis: 'post_money', mfn: false } }),
];
const POOL = { uid: 'c3', name: 'Options', kind: 'option_pool', authorized_shares: 1500000, issued: null, options_granted: 382000, options_exercised: 0, unallocated: 1118000 };
const RECORD = {
  project_id: 3,
  currency: { code: 'USD', source: 'default' },
  classes: { available: true, reason: null, rows: [{ uid: 'c1', name: 'Common', kind: 'common' }, { uid: 'c3', name: 'Options', kind: 'option_pool' }] },
  by_holder: { available: true, reason: null, rows: [
    { holder_id: 12, name: 'Ada Founder', kind: 'founder', shares: 8000000, options: 0, by_class: [] },
    { holder_id: 15, name: 'Jo Rivera', kind: 'employee', shares: 0, options: 300000, by_class: [] },
    { holder_id: 16, name: 'Kai Engineer', kind: 'advisor', shares: 0, options: 82000, by_class: [] },
  ] },
  by_class: { available: true, reason: null, rows: [{ uid: 'c1', name: 'Common', kind: 'common', issued: 8000000 }, POOL] },
  instruments: { available: true, reason: null, rows: INSTRUMENTS },
  issuances: { available: true, reason: null, rows: [
    iss({ uid: 'g1', kind: 'grant', holder: { holder_id: 15, name: 'Jo Rivera' }, class_uid: 'c3', shares: 300000, price_per_share_micros: 300000, issued_on: '2026-02-02', document_ref: 'data_room_files:11' }),
    iss({ uid: 'g2', kind: 'grant', holder: { holder_id: 16, name: 'Kai Engineer' }, class_uid: 'c3', shares: 82000, price_per_share_micros: 420000, issued_on: '2026-07-01' }),
    iss({ uid: 'cv1', kind: 'conversion', holder: { holder_id: null, name: 'Old Fund' }, class_uid: 'c1', shares: 50000, related_uid: 'i-old', issued_on: '2025-06-01' }),
    // Neither converts anything: a correction names its row, and a void conversion is no conversion.
    iss({ uid: 'cr1', kind: 'correction', holder: { holder_id: null, name: 'Northwind Angels' }, shares: 0, related_uid: 'i-north', issued_on: '2026-09-03' }),
    iss({ uid: 'cv2', kind: 'conversion', status: 'void', holder: { holder_id: null, name: 'Harbor Seed Fund' }, class_uid: 'c1', shares: 1, related_uid: 'i-harbor', issued_on: '2026-09-04' }),
  ] },
  proposals: { available: true, reason: null, rows: [] },
};
const NOT_MODELLED = [
  { uid: 'i-kai', name: 'Kai Angel', kind: 'safe', reason: 'no_cap_or_discount', sentence: 'It has no cap and no discount on record, so it cannot convert.' },
  { uid: 'i-note', name: 'Angel Note', kind: 'note', reason: 'basis_not_recorded', sentence: 'Its basis is not recorded, so it is not modelled.' },
];
// Today's start: 8,000,000 + 1,118,000 + 300,000 + 82,000 = 9,500,000 shares.
const TODAY = {
  project_id: 3, currency: 'USD',
  today: { available: true, reason: null, source: 'record', not_modelled: NOT_MODELLED, result: {
    founding: [{ holder: 'Ada Founder', type: 'founder', shares: 8000000 }, { holder: 'Option Pool', type: 'option_pool', shares: 1118000 }, { holder: 'Jo Rivera', type: 'options', shares: 300000 }, { holder: 'Kai Engineer', type: 'options', shares: 82000 }],
    post_money_check: { fraction: 0.015, pct: 1.5, over_100: false },
    mfn: [
      { name: 'Northwind Angels', later: [{ name: 'Kai Angel', cap: null, verdict: 'no_change', ordered_by: 'date' }] },
      { name: 'Harbor Seed Fund', later: [{ name: 'Northwind Angels', cap: 10000000, verdict: 'no_change', ordered_by: 'date' }] },
    ],
  } },
  model: { uid: 'm1', name: 'Cap table · model', inputs: { rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000 }] } },
};
const CONVERSIONS = [
  { name: 'Northwind Angels', instrument: 'safe', basis: 'post_money', mfn: true, amount: 150000, accrued_interest: 0, converting_amount: 150000, cap_price: 0.82, discount_price: 0.876, round_price: 1.03, binding: 'cap', price_per_share: 0.82, shares: 182927, pct_after_round: 1.3205 },
  { name: 'Harbor Seed Fund', instrument: 'safe', basis: 'pre_money', mfn: true, amount: 250000, accrued_interest: 0, converting_amount: 250000, cap_price: 0.61, discount_price: 0.824, round_price: 1.03, binding: 'cap', price_per_share: 0.61, shares: 409836, pct_after_round: 2.9586 },
];
const SIM = { source: 'record', currency: 'USD', not_modelled: NOT_MODELLED,
  result: { rounds: [{ name: 'Next round', price_per_share: 1.03, conversions: CONVERSIONS, post_money_check: { fraction: 0.015, pct: 1.5, over_100: false } }], post_money_check: { fraction: 0.015, pct: 1.5, over_100: false }, warnings: [] } };
const COMPARE = {
  canonical: { uid: 'm1', name: 'Main', inputs: { rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000 }] },
    result: { rounds: [{ name: 'Seed', ledger: [{ holder: 'Option Pool', type: 'option_pool', shares: 1804000 }, { holder: 'Ada Founder', type: 'founder', shares: 8000000 }] }] } },
  variants: [{ uid: 'v1', name: 'Seed · bigger round', inputs: { rounds: [{ name: 'Seed', pre_money: 12000000, investment: 4000000, top_up_payer: 'post_money' }] }, result: null }],
};
const PLAN = {
  scope: { kind: 'venture', project_id: 3 },
  pools: [{ id: 1, name: 'Options', shares_authorized: 1500000, shares_issued: 382000, shares_available: 1118000, source: 'manual' }],
  grants: [
    { id: 1, holder_id: 15, start_date: '2025-03-01', cliff_months: 12, total_months: 48, total_shares: 300000, vested_shares: 118750, source: 'manual' },
    { id: 2, holder_id: 16, start_date: '2026-04-01', cliff_months: 0, total_months: 24, total_shares: 82000, vested_shares: 20500, source: 'manual' },
  ],
  summary: { pool_count: 1, grant_count: 2, shares_authorized: 1500000, shares_issued: 382000, shares_available: 1118000, granted_shares: 382000, vested_shares: 139250, unvested_shares: 242750 },
};
const V409A = { ok: true, project_id: 3, as_of: '2026-10-25', current: { valuation_date: '2026-03-03', fmv_per_share: 0.42, provider: 'Valuation firm', method: null },
  status: { state: 'valid', expires_on: '2027-03-03', reason: 'Safe harbour in force until 2027-03-03.' },
  triggers: [
    { kind: 'priced_round', label: 'a priced financing round', fired: true, occurred_on: '2026-10-09', note: '' },
    { kind: 'secondary_transaction', label: 'a secondary sale of shares', fired: false, occurred_on: null, note: '' },
  ], history: [], events: [] };

/* ------------------------------------------------------------------ *
 * Instruments: the model
 * ------------------------------------------------------------------ */

test('the record\'s instruments in its own units: a SAFE\'s missing figures say so, a note\'s interest and maturity, the status from a recorded conversion', () => {
  const [north, harbor, kai, note, old] = recordInstruments(RECORD);
  assert.deepEqual(
    { holder: north.holder, type: north.type, amount: north.amount, cap: north.cap, discount: north.discount, basis: north.basis, check: north.check, mfn: north.mfn, interest: north.interest, signed: north.signed, document: north.document, status: north.status, source: north.source },
    { holder: 'Northwind Angels', type: 'SAFE', amount: '$150,000', cap: '$10,000,000', discount: '15%', basis: 'Post-money', check: false, mfn: 'Yes', interest: null, signed: '2 Sep 2026', document: 'Data room file', status: 'outstanding', source: 'Mercury' },
  );
  assert.equal(harbor.basis, 'Pre-money');
  assert.equal(harbor.check, true, 'a pre-money SAFE carries the Check note');
  assert.equal(harbor.document, null, 'no document is "No document", never invented');
  assert.equal(kai.cap, 'Not recorded');
  assert.equal(kai.discount, 'Not recorded', 'never 0%');
  assert.equal(kai.mfn, 'Not recorded');
  assert.equal(kai.cannotConvert, true);
  assert.equal(note.type, 'Convertible note');
  assert.equal(note.interest, '8% · matures 1 Aug 2027');
  assert.equal(note.basis, 'Not recorded');
  assert.equal(note.cannotConvert, false, 'a discount alone converts');
  assert.equal(old.status, 'converted', 'a recorded conversion names it');
  assert.equal(old.statusWord, 'Converted');
  assert.equal(recordInstruments({ ...RECORD, instruments: { rows: [iss({ uid: 'x', kind: 'note', holder: { name: 'N' }, terms: {} })] } })[0].interest, 'Not recorded · maturity not recorded');
  assert.deepEqual(recordInstruments(null), []);
});

test('the toolbar: outstanding by default, largest first; Type, Basis and Status narrow it; the search reads the holder', () => {
  const all = recordInstruments(RECORD);
  assert.deepEqual(filterInstruments(all, EMPTY_FILTERS).map((r) => r.uid), ['i-harbor', 'i-north', 'i-note', 'i-kai']);
  assert.deepEqual(filterInstruments(all, { ...EMPTY_FILTERS, status: 'converted' }).map((r) => r.uid), ['i-old']);
  assert.deepEqual(filterInstruments(all, { ...EMPTY_FILTERS, type: 'note' }).map((r) => r.uid), ['i-note']);
  assert.deepEqual(filterInstruments(all, { ...EMPTY_FILTERS, basis: 'pre_money' }).map((r) => r.uid), ['i-harbor']);
  assert.deepEqual(filterInstruments(all, { ...EMPTY_FILTERS, basis: 'unknown' }).map((r) => r.uid), ['i-note']);
  assert.deepEqual(filterInstruments(all, { ...EMPTY_FILTERS, q: ' NORTH' }).map((r) => r.uid), ['i-north']);
  assert.deepEqual(filterInstruments(all, { ...EMPTY_FILTERS, status: '', sort: 'newest' }).map((r) => r.uid), ['i-kai', 'i-north', 'i-harbor', 'i-note', 'i-old']);
  assert.deepEqual(filterInstruments(all, { ...EMPTY_FILTERS, sort: 'holder' }).map((r) => r.holder), ['Angel Note', 'Harbor Seed Fund', 'Kai Angel', 'Northwind Angels']);
});

test('Convert at: a price becomes a round priced on Today\'s share count; a scenario sends its own first round; what is missing is named', () => {
  assert.equal(todayShares(TODAY), 9500000);
  assert.equal(todayShares({ today: { available: false } }), null);
  const p = convertBody('price', { price: '$1.03', raise: '3,000,000' }, { today: TODAY });
  assert.equal(p.sentence, null);
  assert.equal(p.label, '$1.03');
  assert.deepEqual(p.body, { rounds: [{ name: 'Next round', pre_money: 1.03 * 9500000, investment: 3000000 }] });
  assert.equal(convertBody('price', { price: '', raise: '' }, { today: TODAY }).sentence, 'It still needs a price per share and the amount raised.');
  assert.equal(convertBody('price', { price: '0', raise: '1' }, { today: TODAY }).sentence, 'The price per share is a number above zero.');
  assert.equal(convertBody('price', { price: '1', raise: 'lots' }, { today: TODAY }).sentence, 'The amount raised is a number above zero.');
  assert.match(convertBody('price', { price: '1', raise: '1' }, { today: null }).sentence, /share count could not be read/);
  const s = convertBody('scenario', {}, { scenario: COMPARE.variants[0] });
  assert.deepEqual(s.body, { rounds: [COMPARE.variants[0].inputs.rounds[0]] }, 'the scenario\'s round goes as it holds it, its payer too');
  assert.equal(s.label, 'Seed · bigger round');
  assert.equal(convertBody('scenario', {}, { scenario: { inputs: { rounds: [] } } }).sentence, 'That scenario plans no round, so nothing converts in it.');
});

test('the modelled columns and the chart are the engine\'s numbers; what did not convert says why; never a rescaled table', () => {
  const v = convertView(SIM, recordInstruments(RECORD), '$1.03');
  assert.equal(v.title, 'As converted at $1.03');
  assert.deepEqual(v.rows.map((r) => [r.holder, r.converted]), [['Northwind Angels', true], ['Harbor Seed Fund', true], ['Kai Angel', false], ['Angel Note', false]]);
  const [north, harbor, kai, note] = v.rows;
  assert.equal(north.price, '$0.82');
  assert.equal(north.binding, 'Cap price $0.82 beats the discount price $0.88: cap wins');
  assert.equal(north.sharesWord, '182,927');
  assert.equal(north.pctAfter, '1.32%');
  assert.equal(harbor.pctAfter, '2.96%');
  assert.equal(kai.cannotConvert, true);
  assert.equal(kai.reason, 'It has no cap and no discount on record, so it cannot convert.');
  assert.equal(note.cannotConvert, false);
  assert.equal(note.reason, 'Its basis is not recorded, so it is not modelled.');
  assert.equal(v.lead, 'Harbor Seed Fund converts into the most shares at $0.61.');
  assert.deepEqual(v.bars.map((b) => [b.value, b.width, b.hairline]), [['182,927', '44.6%', false], ['409,836', '100.0%', false], ['Cannot convert', '0', true], ['Cannot convert', '0', true]]);
  assert.equal(v.cannotConvert, CANNOT_CONVERT_LINE);
  assert.equal(v.notice, null);
  const over = convertView({ ...SIM, result: { ...SIM.result, rounds: [{ ...SIM.result.rounds[0], post_money_check: { pct: 104, over_100: true } }] } }, recordInstruments(RECORD), '$1.03');
  assert.equal(over.notice, 'These post-money caps promise 104% of the company. They cannot all be honoured. Check the terms.');
  assert.equal(over.rows[0].sharesWord, '182,927', 'the numbers are the engine\'s, not scaled to fit');
  assert.equal(over100({ over_100: false, pct: 99 }), null);
  assert.equal(convertView({ result: { rounds: [] } }, [], 'x'), null);
});

test('which price won, in words, for each case the engine answers', () => {
  assert.equal(bindingLine({ binding: 'discount', cap_price: 0.9, discount_price: 0.8, round_price: 1 }), 'Discount price $0.80 beats the cap price $0.90: discount wins');
  assert.equal(bindingLine({ binding: 'discount', cap_price: null, discount_price: 0.8, round_price: 1 }), 'Discount price $0.80 beats the round price $1.00: discount wins');
  assert.equal(bindingLine({ binding: 'cap', cap_price: 0.5, discount_price: null, round_price: 1 }), 'Cap price $0.50 beats the round price $1.00: cap wins');
  assert.equal(bindingLine({ binding: 'cap', cap_price: 1.2, discount_price: null, round_price: 1 }), 'Cap price $1.20 is above the round price $1.00, and still applies: no discount is recorded');
  assert.equal(bindingLine(null), 'Not recorded');
  assert.equal(price(0.0123), '$0.0123');
});

test('the instrument drawer: terms with their source, the conversion in steps, MFN against later SAFEs, the exit before conversion', () => {
  const [north, , , note] = recordInstruments(RECORD);
  const v = instrumentView(north, { today: TODAY, sim: SIM });
  assert.equal(v.title, 'Northwind Angels · SAFE');
  assert.deepEqual(v.facts.map((f) => [f.k, f.v]), [['Amount', '$150,000'], ['Valuation cap', '$10,000,000 post-money'], ['Discount', '15%'], ['Basis', 'Post-money'], ['MFN', 'Yes'], ['Signed', '2 Sep 2026']]);
  assert.equal(v.facts[0].sub, 'Mercury · Data room file');
  assert.deepEqual(v.steps.lines, [
    'Cap price = $10,000,000 ÷ 12,195,122 shares = $0.82',
    'Discount price = $1.03 × (1 − 15%) = $0.88',
    'Lower price wins: cap → 182,927 shares → 1.32% after the round',
  ]);
  assert.equal(v.mfn.note, 'MFN: yes. If a later SAFE has better terms, this holder may take them.');
  assert.deepEqual(v.mfn.later, [{ line: 'Kai Angel · cap not recorded', verdict: 'Not recorded' }]);
  assert.equal(v.exit, 'Cash back $150,000, or common at the cap, whichever pays more.');
  assert.equal(instrumentView(north, { today: null, sim: null }).mfn.later, null, 'unread is not "no later SAFE"');
  const n = instrumentView(note, { today: TODAY, sim: SIM });
  assert.equal(n.steps, null);
  assert.equal(n.unconverted, 'Its basis is not recorded, so it is not modelled.');
  assert.equal(n.mfn.note, 'MFN: no.');
  assert.equal(n.exit, 'An exit before conversion is not modelled for a convertible note.');
  assert.deepEqual(n.facts.at(-1), { k: 'Interest · maturity', v: '8% · matures 1 Aug 2027', sub: 'Typed' });
  const noteSim = { ...SIM, result: { rounds: [{ conversions: [{ name: 'Angel Note', binding: 'discount', amount: 100000, accrued_interest: 9333, converting_amount: 109333, cap_price: null, discount_price: 0.824, round_price: 1.03, price_per_share: 0.824, shares: 132686, pct_after_round: 1 }] }] } };
  assert.equal(instrumentView(note, { sim: noteSim }).steps.interest, 'Accrued interest converts too: $100,000 + $9,333 interest = $109,333 converts.');
  assert.equal(instrumentHref('i-north', '?project_id=3'), '/raise/cap-table/instrument/i-north?project_id=3');
});

/* ------------------------------------------------------------------ *
 * Option pool: the model
 * ------------------------------------------------------------------ */

test('the five tiles: the record\'s pool, Vested from the plan, Exercised "Not recorded" until an exercise is on record', () => {
  const v = poolTiles(RECORD, PLAN);
  assert.equal(v.source, 'record');
  assert.equal(v.sourceLine, null);
  assert.deepEqual(v.tiles.map((t) => [t.label, t.value, t.missing]), [
    ['Authorized', '1,500,000', false], ['Granted', '382,000', false], ['Vested', '139,250', false], ['Exercised', 'Not recorded', true], ['Available', '1,118,000', false],
  ]);
  assert.equal(v.tiles[3].sub, EXERCISES_NOT_RECORDED);
  const exercised = { ...RECORD, by_class: { available: true, rows: [{ ...POOL, options_exercised: 4000 }] }, issuances: { rows: [...RECORD.issuances.rows, iss({ kind: 'exercise', from_class_uid: 'c3', class_uid: 'c1', shares: 4000, issued_on: '2026-09-01' })] } };
  assert.equal(poolTiles(exercised, PLAN).tiles[3].value, '4,000');
  assert.equal(poolTiles(RECORD, null).tiles[2].value, 'Could not be read');
  assert.equal(poolTiles(RECORD, undefined).tiles[2].value, 'Reading…');
  assert.equal(poolTiles(RECORD, { ...PLAN, summary: { vested_shares: null } }).tiles[2].value, 'Not recorded');
  const noPool = { ...RECORD, by_class: { available: true, rows: [] } };
  const reg = poolTiles(noPool, PLAN);
  assert.equal(reg.source, 'register');
  assert.match(reg.sourceLine, /entered on StudioOS/);
  assert.equal(reg.tiles[0].value, '1,500,000');
  assert.equal(poolTiles(noPool, { ...PLAN, pools: [{ ...PLAN.pools[0], source: 'connector_carta' }] }).source, 'carta');
  const none = poolTiles(noPool, { pools: [], grants: [], summary: {} });
  assert.equal(none.source, 'none');
  assert.ok(none.tiles.every((t) => t.value === 'Not recorded'), 'nothing stored is never a zero');
  const partial = poolTiles({ ...RECORD, by_class: { available: true, rows: [POOL, { ...POOL, uid: 'c4', authorized_shares: null, unallocated: null }] } }, PLAN);
  assert.equal(partial.tiles[0].value, 'Not recorded', 'a pool with no recorded size makes the total unknown');
});

test('the burn-down by month from the record, with the model\'s target, and no line for exercises not recorded', () => {
  const b = burnDown(RECORD, COMPARE, '2026-10-25');
  assert.deepEqual(b.points.map((p) => [p.month, p.granted, p.available, p.exercised]), [
    ['2026-02', 300000, 1200000, null], ['2026-03', 300000, 1200000, null], ['2026-04', 300000, 1200000, null], ['2026-05', 300000, 1200000, null],
    ['2026-06', 300000, 1200000, null], ['2026-07', 382000, 1118000, null], ['2026-08', 382000, 1118000, null], ['2026-09', 382000, 1118000, null], ['2026-10', 382000, 1118000, null],
  ]);
  assert.equal(b.exercisesRecorded, false);
  assert.deepEqual(b.target, { shares: 1804000, label: 'Target pool · Cap table · model, Seed · Modelled' });
  assert.equal(b.summary, 'Option pool by month, Feb 2026 to Oct 2026: granted rose to 382,000 of 1,500,000 shares and available is 1,118,000. Exercises are not recorded. The model targets 1,804,000.');
  assert.equal(b.foot, 'Exercises are not recorded yet: record them in History.');
  assert.equal(burnDown({ ...RECORD, by_class: { available: true, rows: [] } }, COMPARE, '2026-10-25'), null);
  assert.equal(burnDown({ ...RECORD, issuances: { rows: [] } }, null, '2026-10-25').empty, 'No grant from the pool is on record yet.');
  const cancelled = { ...RECORD, issuances: { rows: [...RECORD.issuances.rows, iss({ kind: 'cancellation', class_uid: 'c3', shares: -2000, issued_on: '2026-10-02' })] } };
  assert.equal(burnDown(cancelled, null, '2026-10-25').points.at(-1).granted, 380000);
  const long = { ...RECORD, issuances: { rows: [iss({ kind: 'grant', class_uid: 'c3', shares: 10, issued_on: '2023-01-05' })] } };
  assert.equal(burnDown(long, null, '2026-10-25').points.length, 24, 'at most the last 24 months');
  assert.equal(poolTarget(null), null);
});

test('the grants from the venture\'s plan, named, priced and dated from the record\'s grant; the vested foot only when every row records it', () => {
  const rows = grantRows(PLAN, RECORD);
  assert.deepEqual(rows[0], {
    key: 1, holder: 'Jo Rivera', role: 'Employee', roleKey: 'employee', sharesN: 300000, shares: '300,000', strike: '$0.30', grantDate: '2 Feb 2026', grantOn: '2026-02-02',
    vesting: '48 months · 12-month cliff · from 1 Mar 2025', vested: '118,750', exercise: 'Not exercised', document: 'Data room file', carta: false,
  });
  assert.equal(rows[1].vesting, '24 months · no cliff · from 1 Apr 2026');
  assert.equal(rows[1].document, null);
  assert.equal(grantRows({ grants: [{ id: 9, holder_id: 99, total_shares: null, vested_shares: null, cliff_months: null, total_months: null }] }, RECORD)[0].vesting, 'Term not recorded · cliff not recorded · from Not recorded');
  assert.equal(grantRows(null, RECORD), null, 'an unread plan is not an empty one');
  assert.deepEqual(filterGrants(rows, { sort: 'date' }).map((r) => r.holder), ['Kai Engineer', 'Jo Rivera']);
  assert.deepEqual(filterGrants(rows, { role: 'employee' }).map((r) => r.holder), ['Jo Rivera']);
  assert.deepEqual(filterGrants(rows, { q: 'kai', sort: 'shares' }).map((r) => r.holder), ['Kai Engineer']);
  assert.equal(vestedFoot(PLAN), 'Vested 139,250 adds up the 2 rows.');
  assert.equal(vestedFoot({ ...PLAN, summary: { vested_shares: null } }), null);
  assert.equal(isCarta(PLAN), false);
  assert.equal(isCarta({ grants: [{ source: 'connector_carta' }] }), true);
});

test('the 409A\'s dialogs send the Worker\'s fields, and its checks read in the Worker\'s labels', () => {
  assert.deepEqual(valuationBody({ date: '2026-03-03', fmv: '$0.42', provider: ' Valuation firm ', method: 'backsolve', preferred: '', notes: '' }),
    { body: { valuation_date: '2026-03-03', fmv_per_share: 0.42, provider: 'Valuation firm', method: 'backsolve' }, sentence: null });
  assert.equal(valuationBody({ date: '', fmv: '' }).sentence, 'It still needs the valuation date and the FMV per common share.');
  assert.equal(valuationBody({ date: '2026-03-03', fmv: '0' }).sentence, 'The FMV per common share is a number above zero.');
  assert.equal(valuationBody({ date: '2026-03-03', fmv: '1', preferred: '-2' }).sentence, 'The preferred price is a number above zero, or left blank.');
  assert.equal(valuationBody({ date: '2026-03-03', fmv: '1', preferred: '1.03' }).body.preferred_price_per_share, 1.03);
  assert.deepEqual(eventBody({ kind: 'priced_round', date: '2026-10-09', note: '' }), { body: { kind: 'priced_round', occurred_on: '2026-10-09' }, sentence: null });
  assert.equal(eventBody({ kind: 'nonsense', date: 'x' }).sentence, 'It still needs what happened and the date.');
  assert.deepEqual(harbourChecks(V409A).map((c) => [c.fired, c.line]), [
    [true, 'A priced financing round on 9 Oct 2026 may end the safe harbour.'],
    [false, 'A secondary sale of shares · none recorded'],
  ]);
});

/* ------------------------------------------------------------------ *
 * The pages, mounted under CycleRoute on a stubbed fetch
 * ------------------------------------------------------------------ */

const OWNER = { id: 2, role: 'founder', founder_id: 20, subscription_tier: 'studio', name: 'Ada Founder' };
const MODULE = { module: { slug: 'cap-table', name: 'Cap table' }, card: { state: 'empty' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };

function handlerFor(o = {}) {
  const at = { record: RECORD, today: TODAY, sim: SIM, compare: COMPARE, plan: PLAN, v409a: V409A, ...o };
  const send = (v) => (typeof v === 'number' ? response({ detail: 'refused' }, v) : response(v));
  return (url, options = {}) => {
    if (url.includes('/captable/scenarios/by-project/3/simulate')) return send(at.sim);
    if (url.includes('/captable/scenarios/by-project/3/today')) return send(at.today);
    if (url.includes('/captable/scenarios/by-project/3/compare')) return send(at.compare);
    if (/\/captable\/409a\/3\/events$/.test(url) && options.method === 'POST') return response({ ok: true, id: 5 }, 201);
    if (/\/captable\/409a\/3$/.test(url) && options.method === 'POST') return response({ ok: true, id: 4 }, 201);
    if (url.includes('/captable/409a/3')) return send(at.v409a);
    if (url.includes('/captable/equity-plan?project_id=3')) return send(at.plan);
    if (url.includes('/captable/record/3')) return send(at.record);
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    if (url.includes('/auth/me')) return response(OWNER);
    return response({});
  };
}

async function mounted(url, o = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  const handle = handlerFor(o);
  globalThis.fetch = async (u, options = {}) => { requests.push([String(u), options.method || 'GET', options.body]); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(OWNER));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/cap-table/instrument/:instrument', element: h(CycleRoute, { cycle: 'raise', slug: 'cap-table', capTableProposal: true }) }),
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    requests, flush, by: (id) => all(id)[0], all, props,
    count: (id) => all(id).length,
    text: (...a) => { const n = a.length ? a[0] : container; assert.ok(n, 'no such node'); return text(n).replace(/\s+/g, ' '); },
    ids: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async press(node) { assert.ok(node, 'no such node'); await act(async () => { await props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async change(node, value) { assert.ok(node, 'no such node'); await act(async () => { props(node).onChange?.({ target: { value } }); }); await flush(); },
    posted: (re) => requests.filter(([u, m]) => re.test(u) && m !== 'GET').map(([u, , b]) => [u, b ? JSON.parse(b) : null]),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('Instruments draws the record\'s instruments with every column, the Check note, "No document" and the source; the toolbar narrows them', async () => {
  const v = await mounted('/raise/cap-table/instruments?project_id=3');
  try {
    assert.ok(v.ids().includes('captable-instruments-page'));
    assert.equal(v.count('captable-inst-row'), 4, 'outstanding by default: the converted SAFE waits for its filter');
    assert.equal(v.count('captable-inst-check'), 1, 'only the pre-money SAFE');
    assert.equal(v.count('captable-inst-nodoc'), 3);
    assert.equal(v.count('captable-inst-notes-only'), 3, 'a SAFE has no interest or maturity');
    assert.equal(v.text(v.by('captable-inst-count')), '4 of 5');
    assert.match(v.text(v.by('captable-inst-table')), /Harbor Seed Fund SAFE \$250,000 \$8,000,000 20% Pre-money ! Check Basis: pre-money, as entered\. Axal’s SAFE template is post-money\./);
    assert.ok(v.hrefs().includes('/raise/cap-table/instrument/i-north?project_id=3'), 'a row opens its drawer');
    assert.ok(v.ids().includes('tag-on-record') && v.ids().includes('tag-modelled'));
    assert.ok(!v.ids().includes('captable-over-100'), 'the caps fit');
    await v.change(v.by('captable-inst-status'), 'converted');
    assert.equal(v.count('captable-inst-row'), 1);
    assert.match(v.text(v.by('captable-inst-table')), /Old Fund/);
    await v.change(v.by('captable-inst-status'), 'outstanding');
    await v.change(v.by('captable-inst-q'), 'zzz');
    assert.ok(v.ids().includes('captable-inst-filtered'));
  } finally { await v.close(); }
});

test('Convert at a next-round price runs a round from Today and draws the modelled columns, the chart and why two did not convert', async () => {
  const v = await mounted('/raise/cap-table/instruments?project_id=3');
  try {
    await v.press(v.by('captable-convert-go'));
    assert.equal(v.text(v.by('captable-convert-refusal')), 'It still needs a price per share and the amount raised.');
    assert.deepEqual(v.posted(/\/simulate$/), [], 'nothing is sent until it is complete');
    await v.change(v.by('captable-convert-price'), '1.03');
    await v.change(v.by('captable-convert-raise'), '3,000,000');
    await v.press(v.by('captable-convert-go'));
    const sent = v.posted(/\/captable\/scenarios\/by-project\/3\/simulate$/);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0][1], { rounds: [{ name: 'Next round', pre_money: 1.03 * 9500000, investment: 3000000 }] });
    assert.equal(v.count('captable-converted-row'), 4);
    assert.equal(v.count('captable-converted-skip'), 2);
    assert.match(v.text(v.by('captable-converted')), /As converted at \$1\.03/);
    assert.match(v.text(v.by('captable-converted-table')), /Northwind Angels \$0\.82 Cap price \$0\.82 beats the discount price \$0\.88: cap wins 182,927 1\.32%/);
    assert.equal(v.count('captable-bar'), 2);
    assert.equal(v.count('captable-bar-cannot'), 2, 'the dashed hairline for what cannot convert');
    assert.equal(v.text(v.by('captable-cannot-line')), CANNOT_CONVERT_LINE);
  } finally { await v.close(); }
});

test('Convert at a scenario sends its first round as it holds it', async () => {
  const v = await mounted('/raise/cap-table/instruments?project_id=3');
  try {
    await v.change(v.by('captable-convert-mode-scenario'));
    await v.change(v.by('captable-convert-scenario'), 'v1');
    await v.press(v.by('captable-convert-go'));
    assert.deepEqual(v.posted(/\/simulate$/)[0][1], { rounds: [COMPARE.variants[0].inputs.rounds[0]] });
    assert.match(v.text(v.by('captable-converted')), /As converted at Seed · bigger round/);
  } finally { await v.close(); }
});

test('the red over-100% notice: before converting, from Today\'s check; after, from the round\'s; the table is never rescaled', async () => {
  const today = { ...TODAY, today: { ...TODAY.today, result: { ...TODAY.today.result, post_money_check: { fraction: 1.04, pct: 104, over_100: true } } } };
  const sim = { ...SIM, result: { ...SIM.result, rounds: [{ ...SIM.result.rounds[0], post_money_check: { pct: 104, over_100: true } }] } };
  const v = await mounted('/raise/cap-table/instruments?project_id=3', { today, sim });
  try {
    assert.equal(v.text(v.by('captable-over-100')), 'These post-money caps promise 104% of the company. They cannot all be honoured. Check the terms.');
    await v.change(v.by('captable-convert-price'), '1.03');
    await v.change(v.by('captable-convert-raise'), '3000000');
    await v.press(v.by('captable-convert-go'));
    assert.equal(v.count('captable-over-100'), 1, 'one notice, over the converted table');
    assert.match(v.text(v.by('captable-converted-table')), /182,927/);
  } finally { await v.close(); }
});

test('the instrument drawer opens over Instruments at its own address, runs the model\'s round and shows the steps; an unknown id says so', async () => {
  const v = await mounted('/raise/cap-table/instrument/i-north?project_id=3');
  try {
    assert.ok(v.ids().includes('captable-instrument-over-instruments'));
    assert.ok(v.ids().includes('captable-instrument'));
    assert.deepEqual(v.posted(/\/simulate$/)[0][1], { rounds: [TODAY.model.inputs.rounds[0]] }, 'the model\'s planned round');
    assert.match(v.text(v.by('captable-instrument-steps')), /Cap price = \$10,000,000 ÷ 12,195,122 shares = \$0\.82 Discount price = \$1\.03 × \(1 − 15%\) = \$0\.88 Lower price wins: cap → 182,927 shares → 1\.32% after the round/);
    assert.match(v.text(v.by('captable-instrument-terms')), /Valuation cap \$10,000,000 post-money Mercury · Data room file/);
    assert.match(v.text(v.by('captable-instrument-mfn')), /Kai Angel · cap not recorded Not recorded/);
    assert.equal(v.text(v.by('captable-instrument-exit')), 'Cash back $150,000, or common at the cap, whichever pays more.');
    await v.press(v.by('captable-instrument-close'));
    assert.ok(!v.ids().includes('captable-instrument'), 'Close returns to Instruments');
    assert.ok(v.ids().includes('captable-instruments-page'));
  } finally { await v.close(); }
  const none = await mounted('/raise/cap-table/instrument/nope?project_id=3');
  try {
    assert.ok(none.ids().includes('captable-instrument-missing'));
  } finally { await none.close(); }
  const noRound = await mounted('/raise/cap-table/instrument/i-north?project_id=3', { today: { ...TODAY, model: null } });
  try {
    assert.deepEqual(noRound.posted(/\/simulate$/), []);
    assert.match(noRound.text(noRound.by('captable-instrument-no-steps')), /No round is planned in your model/);
  } finally { await noRound.close(); }
});

test('Option pool draws the tiles, the burn-down with the target, the 409A\'s checks, Top up the pool and the grants', async () => {
  const v = await mounted('/raise/cap-table/option-pool?project_id=3');
  try {
    assert.ok(v.ids().includes('captable-option-pool-page'));
    assert.equal(v.count('captable-pool-tile'), 4);
    assert.equal(v.count('captable-pool-tile-missing'), 1, 'Exercised, dashed');
    assert.match(v.text(v.by('captable-pool-tiles')), /Authorized 1,500,000 Granted 382,000 Vested 139,250 Exercised Not recorded Record exercises in History Available 1,118,000/);
    assert.ok(v.ids().includes('captable-pool-chart') && v.ids().includes('captable-pool-target') && v.ids().includes('captable-pool-granted'));
    assert.ok(!v.ids().includes('captable-pool-exercised'), 'no line for exercises not recorded');
    assert.match(v.props(v.by('captable-pool-chart'))['aria-label'], /granted rose to 382,000 of 1,500,000 shares/);
    assert.equal(v.count('captable-409a-fired'), 1);
    assert.match(v.text(v.by('captable-409a')), /Safe harbour in force until 2027-03-03\. FMV \$0\.42 per common share/);
    assert.ok(v.hrefs().includes('/raise/cap-table/scenarios?project_id=3'), 'Top up the pool opens Scenarios (D1029)');
    assert.equal(v.count('captable-grant'), 2);
    assert.match(v.text(v.by('captable-grants-table')), /Jo Rivera Employee 300,000 \$0\.30 2 Feb 2026 48 months · 12-month cliff · from 1 Mar 2025 118,750 Not exercised Data room file/);
    assert.equal(v.text(v.by('captable-grants-foot')), 'Vested 139,250 adds up the 2 rows.');
    await v.change(v.by('captable-grants-role'), 'advisor');
    assert.equal(v.count('captable-grant'), 1);
  } finally { await v.close(); }
});

test('Record a valuation and Record an event are dialogs that send the Worker\'s fields; an incomplete one sends nothing', async () => {
  const v = await mounted('/raise/cap-table/option-pool?project_id=3');
  try {
    await v.press(v.by('captable-409a-record-valuation'));
    assert.ok(v.ids().includes('captable-409a-valuation'));
    await v.press(v.by('captable-409a-valuation-go'));
    assert.equal(v.text(v.by('captable-409a-valuation-refusal')), 'It still needs the FMV per common share.');
    assert.deepEqual(v.posted(/\/409a\/3$/), []);
    await v.change(v.by('captable-409a-date'), '2026-10-20');
    await v.change(v.by('captable-409a-fmv'), '0.51');
    await v.change(v.by('captable-409a-provider'), 'Valuation firm');
    await v.press(v.by('captable-409a-valuation-go'));
    assert.deepEqual(v.posted(/\/409a\/3$/).map(([, b]) => b), [{ valuation_date: '2026-10-20', fmv_per_share: 0.51, provider: 'Valuation firm' }]);
    assert.ok(!v.ids().includes('captable-409a-valuation'), 'the dialog closes once it lands');
    await v.press(v.by('captable-409a-record-event'));
    await v.change(v.by('captable-409a-kind'), 'priced_round');
    await v.change(v.by('captable-409a-date'), '2026-10-09');
    await v.press(v.by('captable-409a-event-go'));
    assert.deepEqual(v.posted(/\/409a\/3\/events$/).map(([, b]) => b), [{ kind: 'priced_round', occurred_on: '2026-10-09' }]);
  } finally { await v.close(); }
});

test('with Carta connected the grants are Carta\'s, read only, each with Edit in Carta (CT5c)', async () => {
  const carta = { ...PLAN, grants: PLAN.grants.map((g) => ({ ...g, source: 'connector_carta' })) };
  const v = await mounted('/raise/cap-table/option-pool?project_id=3', { plan: carta });
  try {
    assert.ok(v.ids().includes('captable-grants-carta'));
    assert.ok(!v.ids().includes('captable-grants-table'), 'no table to edit');
    assert.equal(v.count('captable-grant-carta'), 2);
    assert.match(v.text(v.by('captable-grants-carta')), /Jo Rivera · 300,000 options · strike \$0\.30 From Carta · read only Edit in Carta/);
    assert.equal(v.hrefs().filter((x) => x === 'https://app.carta.com/').length, 2);
  } finally { await v.close(); }
});

test('each read answers alone: a failed one says so where its block would be, and never draws "none"', async () => {
  const a = await mounted('/raise/cap-table/option-pool?project_id=3', { plan: 500 });
  try {
    assert.ok(a.ids().includes('captable-grants-unreadable'));
    assert.ok(!a.ids().includes('captable-grants-none'));
    assert.match(a.text(a.by('captable-pool-tiles')), /Vested Could not be read/);
    assert.match(a.text(a.by('captable-409a')), /Safe harbour in force/, 'the 409A still draws');
  } finally { await a.close(); }
  const b = await mounted('/raise/cap-table/option-pool?project_id=3', { v409a: 500, compare: 500 });
  try {
    assert.ok(b.ids().includes('captable-409a-unreadable'));
    assert.ok(b.ids().includes('captable-pool-tiles'), 'the tiles still draw');
    assert.ok(b.ids().includes('captable-pool-target-unreadable') && !b.ids().includes('captable-pool-target'));
  } finally { await b.close(); }
  const c = await mounted('/raise/cap-table/instruments?project_id=3', { today: 500 });
  try {
    assert.equal(c.count('captable-inst-row'), 4, 'the record still draws');
    assert.ok(c.ids().includes('captable-today-unreadable'));
  } finally { await c.close(); }
  const d = await mounted('/raise/cap-table/instruments?project_id=3', { record: 403 });
  try {
    assert.ok(d.ids().includes('captable-inst-refused'));
    assert.ok(!d.ids().includes('captable-inst-none'), 'a refusal is not "none recorded"');
  } finally { await d.close(); }
  const e = await mounted('/raise/cap-table/instruments?project_id=3', { record: { ...RECORD, instruments: { available: true, rows: [] } } });
  try {
    assert.ok(e.ids().includes('captable-inst-none'));
    assert.ok(!e.ids().includes('captable-convert-at'), 'nothing to convert');
  } finally { await e.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the wiring: the drawer\'s route, the client in api.js\'s block, dialogs never pop-ups', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/raise\/cap-table\/instrument\/:instrument" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="raise" slug="cap-table" capTableProposal \/>\)\} \/>/);
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /instrument: instrumentId(?:, scenario: scenarioId)? \} = useParams\(\)/);
  assert.match(route, /<CapTableTabPage tab=\{capTableTab\} proposal=\{proposalId\} instrument=\{instrumentId\}/);
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/capTableRegister\.js';\nexport \* from '\.\/api\/capTableScenarios\.js';\n/);
  const client = read('frontend/src/lib/api/capTableScenarios.js');
  assert.match(client, /today: \(projectId\) => request\(`\$\{base\(projectId\)\}\/today`\)/);
  assert.match(client, /simulate: \(projectId, body\) => request\(`\$\{base\(projectId\)\}\/simulate`, \{ method: 'POST'/);
  for (const f of ['InstrumentsTab.jsx', 'OptionPoolTab.jsx', 'instrumentsModel.js', 'poolModel.js']) {
    assert.doesNotMatch(read(`frontend/src/pages/raise/captable/${f}`), /\b(alert|confirm|prompt)\(/, f);
  }
});
