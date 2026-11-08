// D4574 (#4574, H5) — CycleRoute fetches each cycle step's module when that step
// draws, not every step with the route (#4573 §2: one chunk of about 1,100 KiB raw).
//
//   - `lazyStep` draws its skeleton (or nothing, with `fallback: null`), then the
//     step with the props it was given; a chunk that fails to load reaches the
//     route's error boundary as the chunk error RouteErrorBoundary recovers from;
//   - every step CycleRoute names is a dynamic import of a module that still
//     exports that name, and none of those modules is imported statically there
//     any more (a revert to a static import fails here);
//   - the routes, deep links and render sites that reach the steps are unchanged.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/cycle_route_lazy_steps_d4574.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { lazyStep } from '../src/pages/cycles/lazyStep.jsx';
import { isChunkLoadError } from '../src/lib/chunkLoadError.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ROUTE = read('frontend/src/pages/cycles/CycleRoute.jsx');

class Catch extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? h('p', { 'data-testid': 'caught' }, String(this.state.error.message)) : this.props.children; }
}

async function mount(el) {
  const restore = installDocument();
  const prevError = console.error;
  console.error = () => {}; // React logs a caught render error; the boundary below is what is asserted.
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  await act(async () => { root.render(h(Catch, null, el)); });
  return {
    has: (id) => Boolean(by(id)), text: (id) => txt(by(id)), all: () => txt(container),
    async settle() { await act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); }); },
    async unmount() { await act(async () => root.unmount()); console.error = prevError; restore(); },
  };
}

/** A load whose answer the test releases, so the fallback can be seen first. */
function deferred(mod) {
  let release;
  const gate = new Promise((r) => { release = r; });
  return { load: () => gate.then(() => mod), release: () => release() };
}

function Step({ word }) { return h('p', { 'data-testid': 'the-step' }, `step ${word}`); }

test('a lazy step draws the skeleton, then the step with its props', async () => {
  const d = deferred({ Step });
  const Lazy = lazyStep(d.load, 'Step');
  const m = await mount(h(Lazy, { word: 'one' }));
  try {
    assert.equal(m.has('cycle-step-loading'), true, 'the skeleton holds the place');
    assert.equal(m.has('the-step'), false);
    d.release(); await m.settle();
    assert.equal(m.has('cycle-step-loading'), false);
    assert.equal(m.text('the-step'), 'step one', 'the props reach the step');
  } finally { await m.unmount(); }
});

test('a default export, and `fallback: null` for a slot the page sizes (a tab bar, a door)', async () => {
  const d = deferred({ default: Step });
  const Lazy = lazyStep(d.load, 'default', { fallback: null });
  const m = await mount(h(Lazy, { word: 'two' }));
  try {
    assert.equal(m.has('cycle-step-loading'), false, 'no skeleton');
    assert.equal(m.all(), '', 'nothing drawn while it loads');
    d.release(); await m.settle();
    assert.equal(m.text('the-step'), 'step two');
  } finally { await m.unmount(); }
});

test('a chunk that fails to load reaches the error boundary as a chunk error; a missing export is an error, never a blank', async () => {
  const broken = lazyStep(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/CapTableTool-x.js')), 'CapTableTabPage');
  const m = await mount(h(broken));
  try {
    await m.settle();
    assert.equal(m.has('caught'), true);
    assert.equal(isChunkLoadError(new Error(m.text('caught'))), true, 'RouteErrorBoundary and main.jsx recognise it and reload once');
  } finally { await m.unmount(); }
  const renamed = lazyStep(async () => ({ Other: Step }), 'Step');
  const n = await mount(h(renamed));
  try {
    await n.settle();
    assert.match(n.text('caught'), /no export Step/);
  } finally { await n.unmount(); }
});

// Every step CycleRoute loads lazily: [local name, module, export].
const STEPS = [...ROUTE.matchAll(/^const (\w+) = lazyStep\(\(\) => import\('([^']+)'\)(?:, '(\w+)')?/gm)].map((m) => [m[1], m[2], m[3] || 'default']);

test('every step is a dynamic import of a module that still exports it, and none is imported statically', async () => {
  const expected = ['OverviewTab', 'ChannelsTab', 'ProspectsPage', 'CampaignsTab', 'ResultsTab', 'NewCampaignPage', 'AdsTab',
    'InterviewRecord', 'CalendarTab', 'CalendarWeek', 'UpdatesHistory', 'ReportingDesk', 'BuildPlan', 'BuildPlanDoor', 'VerdictRecordWithPlan',
    'NarrativeHome', 'NarrativeTabBar', 'NarrativeTabPage', 'CapTableHomeNav', 'CapTableTabPage', 'DataRoomHomeNav', 'DataRoomTabPage', 'DataRoomUpload',
    'UseOfFundsHomeNav', 'UseOfFundsTabPage', 'CapRelHomeNav', 'CapRelTabPage'];
  assert.deepEqual(STEPS.map(([name]) => name).sort(), [...expected].sort());
  const imports = ROUTE.split('\n').filter((l) => /^import\b/.test(l));
  for (const [name, spec, exported] of STEPS) {
    const bare = spec.replace(/\.jsx$/, '');
    assert.equal(imports.some((l) => l.includes(`'${bare}'`) || l.includes(`'${bare}.jsx'`)), false, `${spec} is imported statically again`);
    const mod = await import(new URL(`../src/pages/cycles/${spec.endsWith('.jsx') ? spec : `${spec}.jsx`}`, import.meta.url));
    assert.equal(typeof mod[exported], 'function', `${spec} exports ${exported} (${name})`);
  }
  // Hooks, models and redirects a render reads synchronously stay static.
  // So does Newsletter, a 47-line "Not offered yet" panel: nothing to gain (distribution_newsletter_4495 pins it).
  assert.match(ROUTE, /^import NewsletterTab from '\.\/distribution\/NewsletterTab\.jsx';$/m);
  assert.match(ROUTE, /^import InboxTab, \{ InboxNeedsYou, useInboxUnread \} from '\.\/distribution\/InboxTab\.jsx';$/m);
  assert.match(ROUTE, /^import \{ DataRoomMovedRedirect \} from '\.\.\/raise\/dataroom\/DataRoomMoved';$/m);
  assert.match(ROUTE, /^import \{ NarrativeAdminGate, narrativeFormAccess \} from '\.\.\/raise\/narrative\/NarrativeAdmin';$/m);
  assert.match(ROUTE, /^import \{ lazyStep \} from '\.\/lazyStep\.jsx';$/m);
  assert.match(read('frontend/src/pages/cycles/lazyStep.jsx'), /lazy\(\(\) => load\(\)/);
});

test('the routes, deep links and render sites that reach the steps are unchanged', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /const CycleRoute = lazy\(\(\) => import\('\.\/pages\/cycles\/CycleRoute'\)\);/);
  for (const route of [
    /<Route path="\/validate\/:slug\/:id" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="validate" record \/>\)\} \/>/,
    /<Route path="\/build\/plan" element=\{guard\(labRoles\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\]\), planNotFounder \? <PlanNotFounder \/> : <CycleRoute cycle="build" buildPlan="plan" \/>\)\} \/>/,
    /path="\/raise\/cap-table\/scenarios\/:scenario" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="raise" slug="cap-table" capTableScenario \/>\)\}/,
  ]) assert.match(app, route);
  for (const site of [
    /<CapTableTabPage tab=\{capTableTab\} proposal=\{proposalId\} instrument=\{instrumentId\} scenario=\{scenarioId\} projectId=\{projectId\}/,
    /<NarrativeTabPage tab=\{narrativeTab\} projectId=\{projectId\}/,
    /<BuildPlan tab=\{buildPlan\} projectId=\{projectId\}/,
    /<CapRelTabPage tab=\{capRelTab\} projectId=\{projectId\}/,
    /<DataRoomTabPage tab=\{dataRoomTab\} projectId=\{projectId\}/,
    /<UseOfFundsTabPage tab=\{uofTab\} sub=\{uofSub\} projectId=\{projectId\}/,
    /'customer-research': \(read, ctx\) => <InterviewRecord read=\{read\} \{\.\.\.ctx\} \/>/,
    /distributionTab === 'campaigns' \? <CampaignsTab/,
  ]) assert.match(ROUTE, site);
  assert.match(read('documentation/architecture/decisions/D4574.md'), /^### H5 — /m);
});
