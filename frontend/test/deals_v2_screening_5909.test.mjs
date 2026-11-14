/**
 * D4815 (#5909), Deals v2 DX6 — Screening as a decision table (board DE06).
 *
 *   · the summary's four figures come from the reads: Deals to screen,
 *     Scorecards ready, Low-confidence scorecards; Stale screens has no field
 *     behind it and reads Not recorded (named in D4815);
 *   · the table has Venture, Scorecard, Fit, Material risks, Confidence,
 *     Last change and Your decision, with Move to diligence and Pass;
 *   · Pass opens the deal flow's reason dialog: nothing is written until a
 *     reason is chosen, so Passed is reached only with a reason;
 *   · Pass reasons is a secondary view behind a disclosure, closed at first;
 *   · an unreadable read never prints 0, and an unreadable flow offers
 *     Try again, never Pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement as h } from 'react';
import { api } from '../src/lib/api.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';
import { dealViewsApi } from '../src/lib/api/dealViews.js';
import { ventureScoresApi } from '../src/lib/api/ventureScores.js';
import InvestorScreeningZone from '../src/pages/investor/deals/ScreeningZone.jsx';
import {
  NOT_IN_READ, confidenceCell, decisionOf, flowStateOf, isLowConfidence, screeningSummary,
} from '../src/pages/investor/deals/screeningModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const scope = (key, confidence) => ({ scope: key, state: 'scored', band: 'strong', confidence_word: confidence });
const DESK = {
  desk: {
    available: true,
    total_deals: 3,
    rows: [
      { deal_id: 1, company: 'Acme Robotics', sector: 'Robotics', deal_status: 'scored' },
      { deal_id: 2, company: 'Harbor AI', sector: 'AI', deal_status: 'active' },
      { deal_id: 3, company: 'Quayside Pay', sector: 'Fintech', deal_status: 'scored' },
    ],
  },
};
const BATCH = {
  items: [
    { deal_id: 1, locked: false, scopes: [scope('team', 'High'), scope('market', 'Medium')] },
    { deal_id: 2, locked: false, scopes: [scope('team', 'Low'), scope('market', 'Low')] },
    { deal_id: 3, locked: true, reason: 'Not shared.' },
  ],
};
const FLOW = { items: [{ deal_id: 2, stage: 'diligence' }] };
const PASSES = { total: 4, buckets: [{ reason: 'valuation', label: 'Valuation', count: 4, pct: 100 }], unrecorded: 0, unrecorded_note: null };
const FITS = { items: [{ deal_id: 1, state: 'scored', score: 84, confidence_label: 'High' }] };

const stripsOf = (batch) => ({ status: 'ready', items: new Map(batch.items.map((i) => [i.deal_id, i])) });

test('the summary counts from the reads, and Stale screens is Not recorded', () => {
  const flow = flowStateOf({ status: 'ready', data: FLOW });
  const s = screeningSummary({ deals: DESK.desk, strips: stripsOf(BATCH), flow });
  // Harbor AI is in your diligence already, so two are left to screen.
  assert.deepEqual(s.toScreen, { value: '2', state: 'ready' });
  // Quayside's scorecard is locked: not ready, never a low score.
  assert.deepEqual(s.ready, { value: '2', state: 'ready' });
  assert.deepEqual(s.low, { value: '1', state: 'ready' });
  assert.deepEqual(s.stale, { value: null, state: 'not_recorded' });
  assert.deepEqual([...NOT_IN_READ], ['Material risks', 'Last change', 'Stale screens']);
});

test('an unreadable read is a state, never a 0', () => {
  const failedFlow = flowStateOf({ status: 'error', error: { status: 503 } });
  const failedStrips = { status: 'error', items: new Map() };
  const s = screeningSummary({ deals: DESK.desk, strips: failedStrips, flow: failedFlow });
  // Mutation checked: counting an unread flow as "no decisions" → toScreen reads '3' and this fails.
  assert.deepEqual(s.toScreen, { value: null, state: 'unreadable' });
  assert.deepEqual(s.ready, { value: null, state: 'unreadable' });
  assert.deepEqual(s.low, { value: null, state: 'unreadable' });
  const unread = screeningSummary({ deals: { available: false, reason: 'x' }, strips: stripsOf(BATCH), flow: failedFlow });
  for (const k of ['toScreen', 'ready', 'low']) assert.equal(unread[k].value, null, k);
  assert.equal(confidenceCell(failedStrips, 1).text, 'Unreadable');
  // A reader with no deal flow (403) has recorded no decision; that is not a failure.
  assert.equal(flowStateOf({ status: 'error', error: { status: 403 } }).state, 'not_investor');
});

test('Your decision: undecided offers the two actions, an unread flow offers only Try again', () => {
  const flow = flowStateOf({ status: 'ready', data: { items: [{ deal_id: 2, stage: 'diligence' }, { deal_id: 3, stage: 'passed', pass: { reason: 'team' } }, { deal_id: 4, stage: 'screening' }] } });
  assert.equal(decisionOf(flow, 1).kind, 'open');
  assert.equal(decisionOf(flow, 4).kind, 'open', 'a deal at Screening in your flow is still yours to decide');
  assert.deepEqual([decisionOf(flow, 2).kind, decisionOf(flow, 2).text], ['moved', 'In Diligence']);
  assert.deepEqual([decisionOf(flow, 3).kind, decisionOf(flow, 3).text], ['passed', 'Passed · Team']);
  assert.equal(decisionOf(flowStateOf({ status: 'error', error: { status: 500 } }), 1).kind, 'unreadable');
});

test('Confidence counts scored scopes by their word; low confidence is every scored scope Low', () => {
  const strips = stripsOf(BATCH);
  assert.equal(confidenceCell(strips, 1).text, 'High 1 · Medium 1');
  assert.equal(confidenceCell(strips, 2).text, 'Low 2');
  assert.equal(confidenceCell(strips, 3).text, 'Not open to you');
  assert.equal(isLowConfidence(BATCH.items[0]), false);
  assert.equal(isLowConfidence(BATCH.items[1]), true);
  // A scored scope with no word is not guessed Low.
  assert.equal(isLowConfidence({ locked: false, scopes: [scope('team', 'Low'), scope('market', null)] }), false);
});

const by = (v, id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);
const press = async (v, id) => { const n = by(v, id); assert.ok(n, `missing ${id}`); await act(async () => { await v.props(n).onClick({ stopPropagation() {} }); }); };
const settle = async (v) => { for (let i = 0; i < 6; i += 1) await v.flush(); };

function stub({ flow = async () => FLOW } = {}) {
  const saved = {
    screening: api.dealScreening, passes: api.dealPassAnalytics, flow: dealFlowApi.flow, add: dealFlowApi.add,
    update: dealFlowApi.update, pass: dealFlowApi.pass, fit: dealViewsApi.fit, batch: ventureScoresApi.batch,
  };
  const calls = [];
  api.dealScreening = async () => DESK;
  api.dealPassAnalytics = async () => PASSES;
  dealFlowApi.flow = flow;
  dealFlowApi.add = async (body) => { calls.push(['add', body]); return { deal_id: body.deal_id, stage: body.stage }; };
  dealFlowApi.update = async (id, body) => { calls.push(['update', id, body]); return { deal_id: id, stage: body.stage }; };
  dealFlowApi.pass = async (id, body) => { calls.push(['pass', id, body]); return { deal_id: id, stage: 'passed', pass: { reason: body.reason } }; };
  dealViewsApi.fit = async () => FITS;
  ventureScoresApi.batch = async () => BATCH;
  const restore = () => {
    Object.assign(api, { dealScreening: saved.screening, dealPassAnalytics: saved.passes });
    Object.assign(dealFlowApi, { flow: saved.flow, add: saved.add, update: saved.update, pass: saved.pass });
    dealViewsApi.fit = saved.fit; ventureScoresApi.batch = saved.batch;
  };
  return { calls, restore };
}

test('the page: the summary, the seven columns, the decision actions and the secondary Pass reasons', async () => {
  const s = stub();
  const v = await mountContracts(h(InvestorScreeningZone), '/deals/screening');
  try {
    await settle(v);
    const text = v.text();
    for (const label of ['Deals to screen', 'Scorecards ready', 'Low-confidence scorecards', 'Stale screens']) assert.ok(text.includes(label), label);
    for (const col of ['Venture', 'Scorecard', 'Fit', 'Material risks', 'Confidence', 'Last change', 'Your decision']) assert.ok(text.includes(col), col);
    assert.ok(text.includes('84 · High'), 'Fit is the thesis fit read');
    assert.ok(text.includes('In Diligence'), 'a decided deal shows its decision, not the buttons');
    assert.ok(by(v, 'screening-move-1') && by(v, 'screening-pass-1'), 'an undecided deal offers Move to diligence and Pass');
    assert.ok(!by(v, 'screening-pass-2'), 'a deal already in diligence offers Pass again');
    // Pass reasons is behind a closed disclosure: the taxonomy does not lead the page.
    const toggle = by(v, 'screening-passes-toggle');
    assert.equal(v.props(toggle)['aria-expanded'], false);
    assert.ok(!by(v, 'screening-passes'), 'the taxonomy is drawn before it is asked for');
    await press(v, 'screening-passes-toggle');
    assert.ok(by(v, 'screening-passes'), 'the disclosure opens Pass reasons');
    // Phone: 44px targets on the decision actions and the disclosure.
    for (const id of ['screening-move-1', 'screening-pass-1', 'screening-passes-toggle']) assert.match(v.props(by(v, id)).className, /min-h-\[44px\]/, id);

    // Move to diligence adds the deal to the flow at Diligence (it is not in the flow yet).
    await press(v, 'screening-move-1');
    await settle(v);
    assert.deepEqual(s.calls, [['add', { deal_id: 1, stage: 'diligence' }]]);
    assert.ok(v.text().includes('Moved Acme Robotics to Diligence in your deal flow.'));
  } finally { await v.unmount(); s.restore(); }
});

test('Pass opens the reason dialog, and nothing is written without a reason', async () => {
  const s = stub();
  const v = await mountContracts(h(InvestorScreeningZone), '/deals/screening');
  try {
    await settle(v);
    await press(v, 'screening-pass-3');
    assert.ok(v.text().includes('Pass on Quayside Pay?'), 'the deal flow\'s pass dialog opens');
    await press(v, 'dealflow-pass-go');
    // Mutation checked: calling the pass before passBody's reason check → a pass with no reason is sent and this fails.
    assert.deepEqual(s.calls, [], 'a pass was sent with no reason');
    assert.ok(v.text().includes('Choose why you are passing.'));
    const radio = by(v, 'dealflow-pass-reason-valuation');
    await act(async () => { v.props(radio).onChange(); });
    await press(v, 'dealflow-pass-go');
    await settle(v);
    assert.deepEqual(s.calls, [['pass', 3, { reason: 'valuation', revisit: 'next_round' }]]);
    assert.ok(v.text().includes('Passed · Valuation'));
  } finally { await v.unmount(); s.restore(); }
});

test('an unreadable flow says Unreadable with Try again, and offers no Pass', async () => {
  const s = stub({ flow: async () => { const e = new Error('down'); e.status = 503; throw e; } });
  const v = await mountContracts(h(InvestorScreeningZone), '/deals/screening');
  try {
    await settle(v);
    assert.ok(by(v, 'screening-decision-unread-1'));
    assert.ok(!by(v, 'screening-pass-1') && !by(v, 'screening-move-1'), 'an unread flow falls through to a decision');
    assert.equal(v.props(by(v, 'screening-to-screen-state')).children, 'Unreadable');
    assert.doesNotMatch(v.text(), /Deals to screen0/);
  } finally { await v.unmount(); s.restore(); }
});

test('D4815 names the fields with nothing behind them', () => {
  const doc = readFileSync('documentation/architecture/decisions/D4815.md', 'utf8');
  const part = doc.slice(doc.indexOf('### DX6 built'));
  assert.ok(part.length > 20, 'D4815 has no DX6 section');
  for (const f of NOT_IN_READ) assert.ok(part.includes(f), `${f} is not named in D4815`);
});
