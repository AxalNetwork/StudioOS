/**
 * D576 (#1189) — the member's Week 1 checklist follows their plan, with one
 * line naming the status it is ordered for; an admin sees the plan; no
 * ordering is written in the SPA (the Worker's `services/week1Plan.ts` owns
 * the rules).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { orderDeliverables, planLine, stepLabel, STEP_LABELS, actorLabel } from '../src/lib/week1Plan.js';
import { WEEK_DEFS, Week1PlanLine } from '../src/pages/SpinoutLabWorkspace.jsx';
import { Week1Plan } from '../src/pages/admin/AdminApplicantDetail.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const text = (C, props) => renderToStaticMarkup(React.createElement(C, props)).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const I = (n) => `customer_interview_logged_${n}`;
const W1 = WEEK_DEFS[0].deliverables;
const NEGOTIATING = ['project_created', 'market_sizing_completed', 'icp_defined', I(1), I(2), I(3), I(4), I(5), 'profiling_completed', 'market_research_shared'];
const plan = (steps, over = {}) => ({
  rule: 'negotiating', label: 'Licence under negotiation', why: 'A licence is scoped by field of use and market.',
  steps, computed_with_week1_started: false, computed_by: 'user:117', created_at: '2026-10-06 10:00:00', updated_at: '2026-10-06 10:00:00', ...over,
});

test('D576: the Week 1 checklist follows the plan; with no plan it keeps the standard order', () => {
  const ordered = orderDeliverables(W1, plan(NEGOTIATING)).map((d) => d.label);
  assert.deepEqual(ordered, [
    'Create startup record', 'Size TAM / SAM with citations', 'Finalize ICP definition and validation criteria',
    'Log 5 customer interviews', 'Complete skills, values & archetype assessment', 'Export or share initial Market Intel research',
  ]);
  assert.deepEqual(orderDeliverables(W1, null), W1);
  assert.deepEqual(orderDeliverables(W1, { steps: 'nope' }), W1);
  const ws = read('frontend/src/pages/SpinoutLabWorkspace.jsx');
  assert.match(ws, /selectedDef\.num === 1 \? orderDeliverables\(selectedDef\.deliverables, state\?\.week1_plan\) : selectedDef\.deliverables/);
  assert.match(ws, /selectedDef\.num === 1 \? <Week1PlanLine state=\{state\} \/> : null/);
});

test('D576: one line names the status the Week 1 is ordered for, or says why the standard order is shown', () => {
  const rec = text(Week1PlanLine, { state: { week1_plan: plan(NEGOTIATING) } });
  assert.match(rec, /Ordered for: Licence under negotiation\./);
  assert.match(rec, /scoped by field of use/);
  assert.match(text(Week1PlanLine, { state: { week1_plan: null } }), /Ordered for: Not recorded\. No plan was computed from your application, so the standard order is shown\./);
  const bad = text(Week1PlanLine, { state: { week1_plan: null, week1_plan_unreadable: true } });
  assert.match(bad, /Your Week 1 order could not be read\. The standard order is shown\./);
  assert.doesNotMatch(bad, /Not recorded/, 'a failed read is not "none"');
  assert.equal(planLine({ week1_plan_unreadable: true, week1_plan: plan(NEGOTIATING) }).status, 'unreadable');
});

test('D576: an admin sees the plan — status, steps in order, who wrote it — or why there is none', () => {
  const t = text(Week1Plan, { plan: plan(NEGOTIATING), unreadable: false });
  assert.match(t, /Week 1 plan Ordered for: Licence under negotiation/);
  assert.match(t, new RegExp(NEGOTIATING.map((k) => stepLabel(k).replace(/[()/&]/g, '.')).join(' ')));
  assert.match(t, /Written by the member \(user 117\)/);
  assert.match(text(Week1Plan, { plan: plan(NEGOTIATING, { computed_with_week1_started: true }), unreadable: false }), /steps already done kept their places/);
  assert.match(text(Week1Plan, { plan: null, unreadable: false }), /Not recorded: no Week 1 plan has been computed/);
  assert.match(text(Week1Plan, { plan: null, unreadable: true }), /Unreadable: the Week 1 plans could not be read/);
  assert.equal(Object.keys(STEP_LABELS).length, 10);
  assert.equal(actorLabel('system'), 'system');
  assert.match(read('frontend/src/pages/admin/AdminApplicantDetail.jsx'), /<Week1Plan plan=\{a\.week1_plan\} unreadable=\{a\.week1_plan_unreadable\} \/>/);
});

test('D576: no ordering is written in the SPA', () => {
  const lib = read('frontend/src/lib/week1Plan.js');
  assert.doesNotMatch(lib, /not_disclosed|negotiating|signed/, 'a rule was copied into the SPA');
});
