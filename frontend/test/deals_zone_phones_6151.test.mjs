/**
 * D6151 part 2 (#6151) — the Screening and Compare phone layouts, boards DE26 and DE29 of the Deals v2
 * addendum (D6141): Screening as cards with the decision at full width, Compare as stacked sections under a
 * sticky legend, one open at a time from three ventures. Every venture here is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_zone_phones_6151.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';
import { dealViewsApi } from '../src/lib/api/dealViews.js';
import { ventureScoresApi } from '../src/lib/api/ventureScores.js';
import InvestorScreeningZone from '../src/pages/investor/deals/ScreeningZone.jsx';
import { ComparePhone, CompareView } from '../src/pages/investor/dealflow/Compare.jsx';
import { compareSections } from '../src/pages/investor/dealflow/compareModel.js';
import { scoresOf } from '../src/pages/investor/dealflow/flowModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;

/* ------------------------------------------------------------------ *
 * Screening (DE26)
 * ------------------------------------------------------------------ */

const scope = (key, confidence) => ({ scope: key, state: 'scored', band: 'strong', confidence_word: confidence });
const DESK = { desk: { available: true, total_deals: 2, rows: [
  { deal_id: 1, company: 'Example Robotics', sector: 'Robotics', deal_status: 'scored' },
  { deal_id: 2, company: 'Example Harbor', sector: 'AI', deal_status: 'active' },
] } };
const BATCH = { items: [{ deal_id: 1, locked: false, scopes: [scope('team', 'High')] }, { deal_id: 2, locked: false, scopes: [scope('team', 'Low')] }] };
const FITS = { items: [{ deal_id: 1, state: 'scored', score: 84, confidence_label: 'High' }] };

function stub({ flow = async () => ({ items: [{ deal_id: 2, stage: 'diligence' }] }) } = {}) {
  const saved = { screening: api.dealScreening, passes: dealFlowApi.passes, flow: dealFlowApi.flow, add: dealFlowApi.add, pass: dealFlowApi.pass, fit: dealViewsApi.fit, batch: ventureScoresApi.batch };
  const calls = [];
  api.dealScreening = async () => DESK;
  dealFlowApi.passes = async () => ({ scope: 'you', total: 0, buckets: [], items: [] });
  dealFlowApi.flow = flow;
  dealFlowApi.add = async (body) => { calls.push(['add', body]); return { deal_id: body.deal_id, stage: body.stage }; };
  dealFlowApi.pass = async (id, body) => { calls.push(['pass', id, body]); return { deal_id: id, stage: 'passed', pass: { reason: body.reason } }; };
  dealViewsApi.fit = async () => FITS;
  ventureScoresApi.batch = async () => BATCH;
  return { calls, restore: () => { api.dealScreening = saved.screening; Object.assign(dealFlowApi, { passes: saved.passes, flow: saved.flow, add: saved.add, pass: saved.pass }); dealViewsApi.fit = saved.fit; ventureScoresApi.batch = saved.batch; } };
}
const all = (v, id) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === id);
const by = (v, id) => all(v, id)[0];
const press = async (v, id) => { const n = by(v, id); assert.ok(n, `missing ${id}`); await act(async () => { await v.props(n).onClick({ stopPropagation() {} }); }); };
const settle = async (v) => { for (let i = 0; i < 6; i += 1) await v.flush(); };
// The harness's own reading of a node's text (`_contracts_dom.mjs`).
const textOf = (v, node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map((c) => textOf(v, c)).join('') : node.textContent || '');

// Mutation checked: the table not hidden below md (fails); the cards not hidden from md (fails); a card without the
// decision (fails); the card's buttons not full width (fails); a card id shared with the table's (fails); the card's Move
// not moving that deal (fails).
test('DE26: below 768px each venture is a card with its reads and its decision at full width; the table is from 768px up', async () => {
  const s = stub();
  const v = await mountContracts(h(InvestorScreeningZone), '/deals/screening');
  try {
    await settle(v);
    const table = v.nodes().find((n) => n.tagName === 'TABLE');
    assert.match(v.props(table.parentNode).className, /\bhidden\b[^"]*\bmd:block\b/, 'the table is the desktop view');
    assert.match(v.props(by(v, 'screening-cards')).className, /\bmd:hidden\b/, 'the cards are the phone view');
    const cards = all(v, 'screening-card');
    assert.equal(cards.length, 2);
    const first = textOf(v, cards[0]);
    assert.match(first, /Example Robotics[\s\S]*Robotics · scored[\s\S]*Fit84 · High[\s\S]*ConfidenceHigh 1[\s\S]*Material risks[\s\S]*Not recorded[\s\S]*Move to diligence[\s\S]*Pass…/);
    assert.match(textOf(v, cards[1]), /In Diligence/, 'a decided deal shows its decision, not the buttons');
    for (const id of ['screening-move-1-card', 'screening-pass-1-card']) assert.match(v.props(by(v, id)).className, /w-full[^"]*min-h-\[44px\]/, id);
    assert.equal(all(v, 'screening-move-1').length, 1, 'the table keeps its own ids');
    await press(v, 'screening-move-1-card');
    await settle(v);
    assert.deepEqual(s.calls, [['add', { deal_id: 1, stage: 'diligence' }]]);
  } finally { await v.unmount(); s.restore(); }
});

// Mutation checked: the card's Pass opening nothing (fails); an unread flow offering Pass on a card (fails).
test('DE26: Pass on a card opens the same reason dialog; an unread flow offers only Try again', async () => {
  const s = stub();
  const v = await mountContracts(h(InvestorScreeningZone), '/deals/screening');
  try {
    await settle(v);
    await press(v, 'screening-pass-1-card');
    assert.ok(v.text().includes('Pass on Example Robotics?'));
  } finally { await v.unmount(); s.restore(); }
  const s2 = stub({ flow: async () => { const e = new Error('down'); e.status = 503; throw e; } });
  const v2 = await mountContracts(h(InvestorScreeningZone), '/deals/screening');
  try {
    await settle(v2);
    assert.ok(by(v2, 'screening-decision-unread-1-card'));
    assert.equal(by(v2, 'screening-pass-1-card'), undefined);
  } finally { await v2.unmount(); s2.restore(); }
});

/* ------------------------------------------------------------------ *
 * Compare (DE29)
 * ------------------------------------------------------------------ */

const sc = (s, band, conf = 'High') => ({ scope: s, state: 'scored', band, confidence_word: conf });
const CB = { items: [{ deal_id: 1, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Fair', 'Medium')] }, { deal_id: 2, locked: true }, { deal_id: 3, locked: false, scopes: [sc('team', 'Weak', 'Low')] }] };
const venture = (o) => ({ id: '1', name: 'Example Robotics', sector: 'Robotics', round: 'Raising', ask: 1500000, currency: 'EUR', instrument: 'SAFE', valuation: 9000000, close: '2026-12-01',
  inFlow: true, stage: 'diligence', daysInStage: 9, scores: scoresOf(CB, 1), fit: { state: 'recorded', score: 86, confidence_label: 'High' }, traction: { masked: true }, ...o });
const TWO = () => [venture(), venture({ id: '2', name: 'Example Northwind', ask: null, instrument: null, scores: scoresOf(CB, 2), fit: { state: 'unavailable' } })];
const THREE = () => [...TWO(), venture({ id: '3', name: 'Example Copperline', scores: scoresOf(CB, 3) })];
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

// Mutation checked: the legend dropped (fails); a section closed with two ventures (fails); a venture's value missing
// from a row (fails); a missing scope drawn as a bar (fails); the phone layout shown from md (fails).
test('DE29: two ventures, every section open, each row naming every venture with its value or its word', () => {
  const out = html(h(ComparePhone, { ventures: TWO() }));
  assert.match(out, /data-testid="dealflow-compare-phone"[^>]*/);
  assert.match(out, /class="[^"]*\bmd:hidden\b[^"]*" data-testid="dealflow-compare-phone"/);
  assert.match(out, /data-testid="dealflow-compare-legend"[\s\S]*Example Robotics[\s\S]*Example Northwind/);
  assert.doesNotMatch(out, /dealflow-compare-phone-toggle-/, 'with two, nothing is collapsed');
  const sections = compareSections(TWO(), {});
  for (const s of sections) assert.match(out, new RegExp(`data-testid="dealflow-compare-phone-${s.key}"`), s.key);
  const team = out.split('data-testid="dealflow-compare-phone-cell-scope-team-0"')[1].split('data-testid="dealflow-compare-phone-cell-scope-team-1"');
  assert.match(team[0], /Strong/);
  assert.match(team[1].split('</div></div>')[0], /italic[^>]*>[^<]*(Locked|Not open|not shared|closed)/i, 'a locked scorecard is a word, never a bar');
  assert.doesNotMatch(out, /One section open at a time/);
});

// Mutation checked: three ventures not collapsing (fails); more than one section open (fails); the toggle not switching
// the open section (fails).
test('DE29: three or four ventures, one section open at a time', async () => {
  const v = await mountContracts(h(ComparePhone, { ventures: THREE() }));
  try {
    const sections = compareSections(THREE(), {});
    const openCount = () => sections.filter((s) => v.props(by(v, `dealflow-compare-phone-toggle-${s.key}`))['aria-expanded']).length;
    assert.equal(openCount(), 1);
    assert.equal(v.props(by(v, `dealflow-compare-phone-toggle-${sections[0].key}`))['aria-expanded'], true, 'the first is open');
    await press(v, `dealflow-compare-phone-toggle-${sections[1].key}`);
    assert.equal(openCount(), 1);
    assert.equal(v.props(by(v, `dealflow-compare-phone-toggle-${sections[1].key}`))['aria-expanded'], true);
    assert.ok(v.text().includes('One section open at a time'));
    for (const s of sections) assert.match(v.props(by(v, `dealflow-compare-phone-toggle-${s.key}`)).className, /min-h-\[44px\]/);
  } finally { await v.unmount(); }
});

// Mutation checked: the desktop chart or table shown below md (fails); the phone layout missing from the page (fails).
test('DE29: the page draws the phone layout below 768px and the chart and table from 768px up', () => {
  const out = html(h(CompareView, { ventures: TWO() }));
  assert.match(out, /<div class="hidden md:block" data-print="hide"><ul[^>]*data-testid="dealflow-compare-chart"/);
  assert.match(out, /<div class="hidden md:block print:block"><div[^>]*id="compare-table"/);
  assert.match(out, /data-testid="dealflow-compare-phone"/);
});
