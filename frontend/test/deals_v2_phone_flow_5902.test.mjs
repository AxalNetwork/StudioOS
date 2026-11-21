/**
 * D5902 (#5902, Deals v2 DX3, boards DE03a–DE03d) — Deal flow on a phone:
 *   A. the table as cards: a row on the member's deals is the Deals v2 card
 *      (venture, my stage, round, score strip, the chosen scopes, fit, days,
 *      owner, Open, Move to…, Compare); a round not on their deals keeps Add;
 *   B. the board one stage at a time, its tabs scrolling sideways inside their
 *      strip and reaching Passed when filtered, no drag, Move to… on every card;
 *   C. Filters as a full-height sheet that traps focus and returns it;
 *   D. Compare selection on the phone;
 * and every control a 44 × 44 target.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_phone_flow_5902.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PhoneCards } from '../src/pages/investor/dealflow/FlowTable.jsx';
import { PhoneBoard } from '../src/pages/investor/dealflow/FlowBoard.jsx';
import { flowRows, scoresOf } from '../src/pages/investor/dealflow/flowModel.js';
import { tagHolding } from './_tagHolding.mjs';

const read = (p) => readFileSync(p, 'utf8');
const h = React.createElement;
const DIR = 'frontend/src/pages/investor/dealflow/';
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** The element carrying `data-testid="id"`, with its markup up to the next sibling of the same tag. */
const tagOf = (s, id) => tagHolding(s, `data-testid="${id}"`, (t) => /^<[a-z]/.test(t)) || null;

const entry = (o) => ({
  uid: `u${o.deal_id}`, deal_id: 1, venture: 'Acme Robotics', sector: 'Robotics', round_status: 'active', stage: 'screening',
  owner: { user_id: 5, name: 'Nadia Ahmed' }, entered_via: 'invited', entered_at: '2026-10-02 10:00:00', stage_changed_at: '2026-11-08',
  days_in_stage: 6, ask: 1500000, pass: null, note: null, can_open: true, ...o,
});
const FLOW = () => ({ scope: 'firm', by_stage: {}, items: [
  entry({ deal_id: 1 }),
  entry({ deal_id: 2, venture: 'Harbor AI', sector: 'AI tooling', stage: 'diligence' }),
  entry({ deal_id: 3, venture: 'Lumen Grid', sector: 'Energy', stage: 'sourcing' }),
  entry({ deal_id: 6, venture: 'Quayside Pay', sector: 'Fintech', stage: 'passed', days_in_stage: 40 }),
] });
const DEALS = () => [
  ...FLOW().items.map((f) => ({ id: f.deal_id, project_name: f.venture, project_sector: f.sector, status: 'active', currency: 'EUR', instrument: 'SAFE', target_raise: 1500000 })),
  { id: 9, project_name: 'Not Yours Ltd', project_sector: 'Retail', status: 'active', currency: 'EUR', instrument: 'SAFE', target_raise: 900000 },
];
const sc = (scope, band, conf = 'High') => ({ scope, state: 'scored', band, confidence_word: conf });
const BATCH = { not_readable: 0, items: [1, 2, 3, 6, 9].map((id) => ({ deal_id: id, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Fair', 'Medium'), sc('geographic', 'Strong')] })) };
const CARDS = ['team', 'market', 'geographic'];
const ROWS = flowRows('all', { flow: FLOW(), deals: DEALS() }).map((r) => ({ ...r, scores: scoresOf(BATCH, r.id), fit: null }));
const noop = () => {};

test('A: on a phone a row on my deals is the full Deals v2 card; nothing the desktop row offers is missing', () => {
  const inFlow = ROWS.find((r) => r.id === '1');
  assert.ok(inFlow?.inFlow, 'fixture: deal 1 is on my deals');
  const out = html(h(PhoneCards, { rows: ROWS, cards: CARDS, picked: [], onPick: noop, onMove: noop, busy: false, onAdd: noop, page: 1, onPage: noop }));
  const row = out.slice(out.indexOf('data-testid="dealflow-phone-row-1"'), out.indexOf('data-testid="dealflow-phone-row-', out.indexOf('data-testid="dealflow-phone-row-1"') + 10));
  for (const id of ['dealflow-card-1', 'dealflow-card-1-strip', 'dealflow-card-1-team', 'dealflow-card-1-market', 'dealflow-card-1-geographic',
    'dealflow-card-1-fit', 'dealflow-card-1-process', 'dealflow-card-1-transaction', 'dealflow-card-open-1', 'dealflow-move-1', 'dealflow-tick-1']) {
    assert.ok(row.includes(`data-testid="${id}"`), `the phone card draws ${id}`);
  }
  const t = text(row);
  for (const w of ['Acme Robotics', 'Screening', 'Fit to my thesis', 'in stage', 'Open', 'Move to…', 'Compare']) assert.ok(t.includes(w), `the phone card says ${w}`);
  assert.match(t, /\bNA\b|Nadia Ahmed/, 'the owner');
  assert.ok(!/draggable="true"/.test(row), 'a phone card is never dragged');
});

test('A: a round not on my deals keeps Add to my deal flow, with a 44px Compare target', () => {
  const out = html(h(PhoneCards, { rows: ROWS, cards: CARDS, picked: [], onPick: noop, onMove: noop, busy: false, onAdd: noop, page: 1, onPage: noop }));
  const at = out.indexOf('data-testid="dealflow-phone-row-9"');
  assert.ok(at > 0, 'the round not on my deals is listed');
  const row = out.slice(at, out.indexOf('</li>', at));
  assert.match(row, /data-testid="dealflow-phone-add-9"/);
  assert.match(row, /<label class="[^"]*min-h-\[44px\][^"]*min-w-\[44px\][^"]*"><input type="checkbox" aria-label="Compare Not Yours Ltd"/);
});

test('B: the board shows one stage, its tabs scroll in their own strip, each a 44px target, and Passed is a tab when filtered', () => {
  const board = (showPassed) => html(h(PhoneBoard, { rows: ROWS.filter((r) => r.inFlow), cards: CARDS, picked: [], onPick: noop, onMove: noop, busy: false, showPassed }));
  const out = board(false);
  assert.match(tagOf(out, 'dealflow-phone-stage-tabs'), /class="[^"]*\bmax-w-full\b[^"]*\boverflow-x-auto\b/, 'the strip scrolls, the page does not');
  for (const s of ['sourcing', 'screening', 'diligence', 'commit', 'closing']) {
    const tab = tagOf(out, `dealflow-phone-stage-${s}`);
    assert.ok(tab, `a ${s} tab`);
    assert.match(tab, /min-h-\[44px\]/, `${s} is a 44px target`);
    assert.match(tab, /flex-none/, `${s} keeps its width so the strip scrolls rather than squeezing`);
  }
  assert.ok(!tagOf(out, 'dealflow-phone-stage-passed'), 'no Passed tab unless filtered');
  assert.ok(tagOf(board(true), 'dealflow-phone-stage-passed'), 'Passed is a tab when the filter asks for it');
  assert.ok(!/draggable="true"/.test(out), 'no drag on the phone');
  assert.match(out, /data-testid="dealflow-card-3"/, 'the first stage (Sourcing) shows first');
  assert.match(out, /data-testid="dealflow-move-3"/, 'every card has Move to…');
});

test('C: Filters open in the shared Sheet, full height on a phone, focus held and returned; every chip and field is 44px there', () => {
  const controls = read(`${DIR}FlowControls.jsx`);
  assert.match(controls, /<Sheet label="Filters"[^>]*testId="dealflow-filters"/, 'Filters is the shared Sheet');
  const sheet = read('frontend/src/ui/Sheet.jsx');
  assert.match(sheet, /Below 640px it is a full-screen page/, 'the Sheet is full height on a phone');
  assert.match(sheet, /focus returns to the opener on close/i, 'and returns focus');
  assert.match(sheet, /Shift\+Tab stay inside/, 'and holds it');
  assert.match(/const CHIP = \(on\) => `([^`]*)`/.exec(controls)[1], /max-sm:min-h-\[44px\]/, 'filter chips are 44px on a phone');
  assert.match(/const FIELD = '([^']*)'/.exec(controls)[1], /max-sm:min-h-\[44px\]/, 'filter fields are 44px on a phone');
});

test('D: on a phone Compare is picked from each card and opened from the bar, both 44px', () => {
  const flow = read(`${DIR}DealFlow.jsx`);
  assert.match(flow, /<PhoneCards rows=\{shown\}[^>]*onMove=\{move\} busy=\{busy\}/, 'the phone cards get Move to… and the busy flag');
  const bar = flow.slice(flow.lastIndexOf('data-testid="dealflow-compare-bar"'));
  assert.match(bar, /<Link to=\{compareHref\(picked\)\} className="[^"]*max-sm:min-h-\[44px\][^"]*" data-testid="dealflow-compare">Compare<\/Link>/);
  assert.match(bar.slice(0, bar.indexOf('</div>')), /<button type="button" className="[^"]*max-sm:min-h-\[44px\][^"]*" onClick=\{\(\) => setPicked\(\[\]\)\}>Clear<\/button>/);
  assert.match(read(`${DIR}DealCard.jsx`), /<label className=\{`flex items-center gap-1 text-\[12px\] \$\{TARGET\}`\}>\s*<input type="checkbox"[\s\S]{0,240}?data-testid=\{`dealflow-tick-\$\{row\.id\}`\}/, 'the card\'s Compare tick is a 44px target');
  // The Compare page's own phone layout (DE29) is #6151 part 2's. Its PR (#6927) merged into #6893's branch
  // after #6893 had landed, so it is not on main; D5902 records it. This file holds the selection only.
});

test('the decision is recorded', () => {
  const d = read('documentation/architecture/decisions/D5902.md');
  assert.match(d, /^## D5902 — .+ \(#5902\)$/m);
});
