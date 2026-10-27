/**
 * D1123 (#3003, migration 602) — SL1's two shares, from the recorded facts:
 *
 *   - the funnel's "Interviewed [n] · [x]% of applied", from interviews an
 *     admin recorded as held; Not recorded keeps its reason, never a zero;
 *   - the Weeks-passed cells' "[passed] of [reached]", the founders who passed
 *     of those who reached the week; a week decided before the ledger keeps
 *     its count and no share.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lab_metrics_d1123.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { overviewFixture } from './_lab_overview_fixture.mjs';
import { buildFunnel, buildHeat } from '../src/pages/admin/lab/labOverviewModel.js';
import { HeatBlock, FunnelBlock } from '../src/pages/admin/lab/LabOverviewBlocks.jsx';
import { interviewOf, cannotAct, outcomeCopy, APPLICATION_REFUSALS } from '../src/pages/admin/lab/applicationsModel.js';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const ok = (data) => ({ status: 'ready', data });
const october = (fx) => fx.blocks.cohorts.items.find((c) => c.cohort === '2026-10');
const html = (C, props) => renderToStaticMarkup(React.createElement(C, props));

test('Weeks passed: a recorded week is "[passed] of [reached]" with its share; nobody reached is no share; a week before the ledger keeps its count', () => {
  const fx = overviewFixture();
  const wk = october(fx).weeks.items;
  wk[0].reached = { available: true, value: 22, passed: 20 };
  wk[1].reached = { available: true, value: 0, passed: 0 };
  const b = buildHeat(ok(fx), NOW);
  const cells = b.rows.find((r) => r.key === '2026-10').cells;
  assert.deepEqual([cells[0].text, cells[0].reached, cells[0].passedOfReached, cells[0].pct], ['20 of 22', 22, 20, 91]);
  assert.equal(cells[0].share, 20 / 22);
  assert.deepEqual([cells[1].text, cells[1].reached, cells[1].share], ['18 passed', 0, undefined], 'a share of nobody is not a share');
  assert.equal(cells[2].text, '17 passed');
  assert.match(cells[2].reachedReason, /reached-week ledger/);
  assert.match(b.note, /^Each cell is founders who passed that week, of those who reached it\. A week decided before reached weeks were recorded says how many passed, never a share\.$/);
  // Every decided week recorded: the canvas's note alone.
  for (const c of fx.blocks.cohorts.items) for (const w of c.weeks.items || []) w.reached = { available: true, value: 5, passed: 4 };
  assert.equal(buildHeat(ok(fx), NOW).note, 'Each cell is founders who passed that week, of those who reached it.');
  // None recorded: the old honesty, never a share.
  assert.match(buildHeat(ok(overviewFixture()), NOW).note, /no cell is a share/);
});

test('the heat draws "[x] of [y]" with the share in its title and the table; a cell without one says why', () => {
  const fx = overviewFixture();
  october(fx).weeks.items[0].reached = { available: true, value: 22, passed: 20 };
  const block = buildHeat(ok(fx), NOW);
  const out = html(HeatBlock, { block, onRetry() {} });
  assert.match(out, /data-testid="lab-heat-2026-10-1"[^>]*>20 of 22/);
  assert.match(out, /title="Oct 2026 · Week 1 · 20 of 22 passed · 91% of those who reached it · 2 failed, 0 in grace"/);
  assert.match(out, /title="Oct 2026 · Week 2 · 18 passed, 1 failed, 1 in grace, 0 not decided\. Week unlock does not persist/);
});

test('the funnel: "Interviewed [n] · [x]% of applied", the past interviews with no outcome yet, and Not recorded with its reason', () => {
  const fx = overviewFixture();
  october(fx).interviewed = { available: true, value: 12, awaiting: 2 };
  let f = buildFunnel(ok(fx));
  assert.equal(f.foot, 'Interviewed 12 · 40% of applied. 2 past interviews have no outcome recorded yet. Interviews are optional, so they sit beside the steps, not in them.');
  assert.deepEqual([f.interviewed.value, f.interviewed.pct, f.interviewed.awaiting], [12, 40, 2]);
  october(fx).interviewed = { available: true, value: 0, awaiting: 1 };
  f = buildFunnel(ok(fx));
  assert.equal(f.foot, 'Interviewed 0 · 0% of applied. 1 past interview has no outcome recorded yet. Interviews are optional, so they sit beside the steps, not in them.');
  october(fx).interviewed = { available: true, value: 3, awaiting: 0 };
  october(fx).applied = { available: true, value: 0 };
  assert.equal(buildFunnel(ok(fx)).foot, 'Interviewed 3. Interviews are optional, so they sit beside the steps, not in them.', 'no share of nothing applied');
  october(fx).interviewed = { recorded: false, reason: '1 interview before 2026-10-20 has no recorded outcome.' };
  assert.match(buildFunnel(ok(fx)).foot, /^Interviewed: Not recorded \(1 interview before 2026-10-20 has no recorded outcome\.\)/);
  october(fx).interviewed = { available: false, reason: 'Interview outcomes could not be read.' };
  assert.match(buildFunnel(ok(fx)).foot, /^Interviewed: Unreadable/);
  october(fx).interviewed = { available: true, value: 12, awaiting: 0 };
  october(fx).applied = { available: true, value: 30 };
  assert.match(html(FunnelBlock, { block: buildFunnel(ok(fx)), onRetry() {}, onChoose() {} }), /Interviewed 12 · 40% of applied\./);
});

test('one application\'s interview: due once its time passed; recorded is its own state; the dialog\'s words and refusals', () => {
  const at = '2026-11-09 20:00:00';
  const d = (latest) => ({ interview: { available: true, latest } });
  assert.equal(interviewOf(d({ status: 'scheduled', scheduled_at: at }), Date.parse('2026-11-09T19:59:00Z')).due, false);
  assert.equal(interviewOf(d({ status: 'scheduled', scheduled_at: at }), Date.parse('2026-11-09T20:00:00Z')).due, true);
  const held = interviewOf(d({ status: 'scheduled', scheduled_at: at, duration_min: 30, outcome: 'held', outcome_at: '2026-11-09 21:00:00' }), Date.parse('2026-11-10T12:00:00Z'));
  assert.deepEqual([held.state, held.word, held.outcome], ['recorded', 'Held', 'held']);
  assert.equal(interviewOf(d({ status: 'scheduled', scheduled_at: at, outcome: 'missed' })).word, 'Missed');
  assert.equal(interviewOf(d({ status: 'cancelled', scheduled_at: at, outcome: 'held' })).state, 'none', 'a cancelled interview is none');
  assert.equal(cannotAct('outcome', { hasInterview: false }), 'There is no interview to record.');
  assert.equal(cannotAct('outcome', { hasInterview: true }), null);
  assert.match(outcomeCopy({ company: 'Northwind Labs' }).sub, /Recorded once\. A held interview counts as interviewed/);
  for (const code of ['outcome_recorded', 'interview_not_yet', 'invalid_outcome']) assert.ok(APPLICATION_REFUSALS[code], code);
});
