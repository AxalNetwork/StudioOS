/**
 * D1063 (#2426) — Validate → Build: the plan at /build/plan and its progress
 * at /build/plan/progress, under Build's header, with "What Validate proved"
 * from the Validate overview's own cards. No proposal, stage or handoff is
 * stored yet, so each module's section and Progress say "Not read here yet",
 * never zero; Founding team takes no proposals.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_plan_d1063.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { NOT_YET, PLAN_TABS, PROVED, SECTIONS, planHref, planSearch, provedCards } from '../src/pages/cycles/buildPlanModel.js';
import BuildPlan, { BuildPlanDoor } from '../src/pages/cycles/BuildPlan.jsx';
import { cyclesApi } from '../src/lib/api/cycles.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;

test('the plan\'s addresses keep only the venture; the four Validate cards in order; every Build module but Founding team takes proposals', () => {
  assert.deepEqual(PLAN_TABS.map((t) => t.path), ['/build/plan', '/build/plan/progress']);
  assert.equal(planSearch('?project_id=7&x=1'), '?project_id=7');
  assert.equal(planSearch('?project_id=abc'), '');
  assert.equal(planHref('progress', '?project_id=7'), '/build/plan/progress?project_id=7');
  const overview = { cards: [{ slug: 'demand-signals' }, { slug: 'verdict' }, { slug: 'problem-discovery' }, { slug: 'customer-research' }, { slug: 'experiments' }] };
  assert.deepEqual(provedCards(overview).map((c) => c.slug), ['problem-discovery', 'experiments', 'demand-signals'], 'in order; a card not sent is left out; no other module');
  assert.deepEqual(PROVED, ['problem-discovery', 'experiments', 'ideal-customer-profile', 'demand-signals']);
  assert.deepEqual(SECTIONS.map((s) => s.slug), ['solution-design', 'prototype-mvp', 'product-roadmap', 'company-creation', 'operating-systems']);
  assert.ok(!SECTIONS.some((s) => s.slug === 'founding-team'), 'Founding team takes no proposals');
});

function harness() {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  return { root, byId, text, props, walk, settle, container, async close() { await act(async () => root.unmount()); restore(); } };
}

test('mounted plan: What Validate proved from the Validate overview, each module waiting, Progress waiting, a failed read said', async () => {
  const t = harness();
  const was = cyclesApi.overview;
  const calls = [];
  cyclesApi.overview = async (...a) => {
    calls.push(a);
    return { cards: [
      { slug: 'problem-discovery', name: 'Problem discovery', state: 'not_recorded', reason: 'No pain theme accepted yet.' },
      { slug: 'customer-research', name: 'Customer research', state: 'not_recorded', reason: 'x' },
      { slug: 'demand-signals', name: 'Demand and urgency signals', state: 'not_recorded', reason: 'No signal confirmed yet.' },
    ] };
  };
  const at = async (key, el) => { await act(async () => t.root.render(h(MemoryRouter, { key, initialEntries: ['/build/plan'] }, el))); await t.settle(); };
  try {
    await at('plan', h(BuildPlan, { tab: 'plan', projectId: 7, search: '?project_id=7', cards: [{ slug: 'solution-design', name: 'Solution design' }] }));
    assert.deepEqual(calls, [['validate', 7]]);
    const proved = t.text(t.byId('plan-proved'));
    assert.match(proved, /What Validate proved.*Problem discovery.*No pain theme accepted yet.*Demand and urgency signals/s);
    assert.doesNotMatch(proved, /Customer research/, 'only the four modules the plan rests on');
    for (const s of SECTIONS) assert.match(t.text(t.byId(`plan-section-${s.slug}`)), new RegExp(`${s.name.replace(/[/]/g, '\\/')}${NOT_YET}`));
    assert.match(t.text(t.byId('plan-wait')), /not a claim that there is nothing to build/);
    assert.match(t.text(t.byId('plan-founding-team')), /Founding team takes no proposals/);
    assert.equal(t.props(t.byId('plan-tab-progress')).href, '/build/plan/progress?project_id=7');
    assert.equal(t.props(t.byId('plan-tab-plan'))['aria-current'], 'page');
    await at('progress', h(BuildPlan, { tab: 'progress', projectId: 7, search: '?project_id=7', cards: [] }));
    assert.match(t.text(t.byId('plan-progress')), /Plan items by stage.*Not read here yet.*nothing here reads as not done/s);
    assert.equal(calls.length, 1, 'Progress makes no Validate read');
    cyclesApi.overview = async () => { throw new Error('down'); };
    await at('down', h(BuildPlan, { tab: 'plan', projectId: 8, search: '', cards: [] }));
    assert.match(t.text(t.byId('plan-proved')), /not a claim that nothing was proved/);
    assert.ok(t.byId('plan-section-prototype-mvp'), 'one failed read never blanks the page');
    await at('door', h(BuildPlanDoor, { search: '?project_id=7&tab=x' }));
    assert.equal(t.props(t.walk(t.byId('build-plan-door')).find((n) => n.tagName === 'A')).href, '/build/plan?project_id=7');
  } finally { cyclesApi.overview = was; await t.close(); }
});

test('wiring: the routes sit ahead of /build/:slug, CycleRoute draws the plan with no Build overview read, the overview opens the plan, and the canvas is in', () => {
  const app = read('frontend/src/App.jsx');
  for (const [path, el] of [['/build/plan', 'buildPlan="plan"'], ['/build/plan/progress', 'buildPlan="progress"']]) {
    const at = app.indexOf(`<Route path="${path}" element={`);
    assert.ok(at > 0 && at < app.indexOf('<Route path="/build/:slug"'), path);
    assert.ok(app.slice(at, app.indexOf('\n', at)).includes(`<CycleRoute cycle="build" ${el} />`), path);
  }
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /\} else if \(buildPlan && cycle === 'build'\) \{/);
  assert.match(route, /if \(record \|\| slug \|\| reporting \|\| buildPlan \|\| !projectId \|\| !def\) return undefined;/);
  assert.match(route, /\{cycle === 'build' && <BuildPlanDoor search=\{q\} \/>\}/);
  for (const f of ['frontend/src/pages/cycles/BuildPlan.jsx', 'frontend/src/pages/cycles/buildPlanModel.js']) {
    assert.doesNotMatch(read(f), /window\.(alert|confirm)|\balert\(|\bconfirm\(/, f);
  }
  assert.ok(read('design/incoming/Validate → Build · Boards.dc.html').includes('VB22'));
});
