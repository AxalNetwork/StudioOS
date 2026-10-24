/**
 * D768 (#2092, D720 §11) — every page knows its place: the page map's parity
 * with the canvas and with the app, each profile's home, the boards that share
 * a route, the shell's provider, `useRailOption`, and the rail context a run
 * carries. Providers are mounted in-process; nothing reaches the Worker.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_pages_d768.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { railRoutes } from './_railRoutes.mjs';
import {
  NO_RAIL_ROUTES, PROFILES, RAIL_BOARD_ALIASES, RAIL_PAGES, crumbsOfKey, currentRail, keysOf, pageFor, pageKeyFor, railBody, setCurrentRail,
} from '../src/lib/railPages.js';
import { RailCrumbsProvider, RailPageProvider, useRailCrumbs, useRailOption, useRailPage, useSetRailCrumbs } from '../src/ui/railCrumbs.js';

const CANVAS = JSON.parse(readFileSync('design/incoming/airail-every-page-data/canvas.json', 'utf8'));
/** Every board the canvas draws, as its page key. */
const BOARDS = Object.entries(CANVAS.profiles).flatMap(([profile, sections]) => Object.entries(sections)
  .flatMap(([section, modules]) => [[profile, `${profile} · ${section}`], ...modules.map((m) => [profile, `${profile} · ${section} · ${m}`])]));

// ── parity with the canvas ──────────────────────────────────────────────────

test('every active section and module on the canvas is reached by a route or an alias', () => {
  assert.deepEqual(Object.keys(CANVAS.profiles), PROFILES, 'the six profiles, in the canvas\'s order');
  assert.equal(BOARDS.length, 204);
  // Owner removal, 2026-10-21: the frozen canvas retains the deleted editor.
  const retired = new Set(['Admin · Programs · Assessment runs', 'Super Admin · Content · Assessment Studio']);
  const missing = BOARDS.filter(([profile, k]) => !retired.has(k) && !keysOf(profile).has(k)).map(([, k]) => k);
  assert.deepEqual(missing, []);
  // An alias points at a page a route owns, in its own profile, and says why.
  for (const a of RAIL_BOARD_ALIASES) {
    const profile = crumbsOfKey(a.board).profile;
    assert.ok(RAIL_PAGES[profile].some((p) => p.key === a.to && !p.alias), `${a.board} → ${a.to}`);
    assert.equal(crumbsOfKey(a.to).profile, profile, a.board);
    assert.ok(a.why && a.why.length > 10, a.board);
    assert.ok(BOARDS.some(([, k]) => k === a.board), `${a.board} is a canvas board`);
    assert.ok(!RAIL_PAGES[profile].some((p) => p.key === a.board), `${a.board} has no route of its own`);
  }
  // Every page key the map owns is the canvas's, or flagged off the canvas;
  // an alias route answers its owner's key and carries no flag of its own.
  for (const [profile, pages] of Object.entries(RAIL_PAGES)) {
    for (const p of pages.filter((x) => !x.alias)) {
      assert.equal(crumbsOfKey(p.key).profile, profile, p.key);
      const onCanvas = BOARDS.some(([, k]) => k === p.key);
      assert.equal(onCanvas, !p.offCanvas, `${p.key}: on the canvas, or flagged offCanvas`);
    }
  }
});

// ── parity with the app ─────────────────────────────────────────────────────

const SHELLS = { founder: ['founder'], investor: ['investor'], advisor: ['advisor'], partner: ['partner'], admin: ['admin', 'super_admin'] };
const sample = (route) => route.replace(/:[^/]+/g, 'x').replace(/\/\*$/, '');

test('every route that draws a rail has a page key for each role its guard admits, or says why not', () => {
  const routes = railRoutes().filter((r) => r.rail);
  assert.ok(routes.length > 200, `the census reads the app's rail routes (${routes.length})`);
  const missing = [];
  for (const r of routes) {
    const roles = r.roles.filter((x) => SHELLS[x]);
    const none = NO_RAIL_ROUTES.find((n) => n.route === r.path || (n.prefix && r.path.startsWith(`${n.route}/`)));
    if (!roles.length) { if (!none) missing.push(`${r.path} (no member role)`); continue; }
    for (const role of roles) {
      if (none && none.roles.includes(role)) continue;
      if (!SHELLS[role].some((s) => pageKeyFor(sample(r.path), s))) missing.push(`${r.path} ${role}`);
    }
  }
  assert.deepEqual(missing, []);
  for (const n of NO_RAIL_ROUTES) {
    assert.ok(n.why && n.why.length > 10, n.route);
    const candidates = n.railCount === 0 ? railRoutes() : routes;
    assert.ok(candidates.some((r) => r.path === n.route), `${n.route} is a route of the app`);
  }
});

test('no two routes claim one key without an alias row, and no route is listed twice', () => {
  for (const [profile, pages] of Object.entries(RAIL_PAGES)) {
    const owners = new Map();
    const routes = new Set();
    for (const p of pages) {
      assert.ok(!routes.has(p.route), `${profile}: ${p.route} is listed twice`);
      routes.add(p.route);
      if (p.alias) { assert.ok(typeof p.alias === 'string' && p.alias.length > 10, `${p.route} says why`); continue; }
      assert.ok(!owners.has(p.key), `${profile}: ${p.key} is claimed by ${owners.get(p.key)} and ${p.route} with no alias row`);
      owners.set(p.key, p.route);
    }
    // An alias answers a key a route owns.
    for (const p of pages.filter((x) => x.alias)) assert.ok(owners.has(p.key), `${profile}: ${p.route} aliases ${p.key}, which no route owns`);
  }
});

// ── pageKeyFor ──────────────────────────────────────────────────────────────

test('pageKeyFor answers each profile\'s home; Admin · Studio has no rail', () => {
  assert.equal(pageKeyFor('/studio', 'founder'), 'Founder · Studio');
  for (const [role, profile] of [['investor', 'Investor'], ['advisor', 'Advisor'], ['partner', 'Operating Partner']]) {
    assert.equal(pageKeyFor('/studio', role), `${profile} · Home`, role);
  }
  assert.equal(pageKeyFor('/hq', 'super_admin'), 'Super Admin · Home');
  for (const route of ['/admin/commissions', '/branch', '/admin/fund-admin']) assert.equal(pageKeyFor(route, 'admin'), 'Admin · Home', route);
  assert.equal(pageKeyFor('/branch', 'branch_admin'), 'Admin · Home');
  for (const role of ['admin', 'super_admin', 'branch_admin']) assert.equal(pageKeyFor('/studio', role), null, role);
  // A profile name works as well as a shell role; anything else is no profile.
  assert.equal(pageKeyFor('/studio', 'Investor'), 'Investor · Home');
  assert.equal(pageKeyFor('/studio', 'exploring'), null);
  assert.equal(pageKeyFor('/studio', undefined), null);
});

test('a route answers its module and every page below it; the section answers the rest', () => {
  assert.equal(pageKeyFor('/validate/customer-research', 'founder'), 'Founder · Validate · Customer research');
  assert.equal(pageKeyFor('/validate/customer-research/42', 'founder'), 'Founder · Validate · Customer research');
  assert.equal(pageKeyFor('/validate/unknown-slug', 'founder'), 'Founder · Validate');
  assert.equal(pageKeyFor('/validate/session/7', 'founder'), 'Founder · Validate · Customer research', 'an alias route');
  assert.equal(pageKeyFor('/nowhere', 'founder'), null);
  // One route, a key per profile.
  assert.equal(pageKeyFor('/network/introductions', 'advisor'), 'Advisor · Network · Introductions');
  assert.equal(pageKeyFor('/network/introductions', 'investor'), 'Investor · Network · Introductions');
  assert.equal(pageKeyFor('/pipeline/leads', 'partner'), 'Operating Partner · Pipeline · Leads');
  assert.equal(pageKeyFor('/pipeline', 'investor'), 'Investor · Deals · Pipeline');
  // D720 §11's table.
  assert.equal(pageKeyFor('/funds/ledger', 'investor'), 'Investor · Fund · Distributions');
  assert.equal(pageKeyFor('/admin', 'super_admin', { search: '?tab=users' }), 'Super Admin · Team · Users');
  // D989 (#2380): the board moved with its page; the old tab is the console's again until it forwards.
  assert.equal(pageKeyFor('/admin/partner-profiles', 'admin'), 'Admin · Approvals · Entity profiles');
  assert.equal(pageKeyFor('/admin/partner-profiles/all', 'admin'), 'Admin · Approvals · Entity profiles');
  assert.equal(pageKeyFor('/admin/assessment', 'admin'), null);
  // An exact route never answers the pages below it.
  assert.equal(pageFor('/admin', 'admin').key, 'Admin · Admin console');
  assert.equal(pageKeyFor('/admin/licences', 'admin'), null, 'Licences is the Super Admin\'s');
});

test('two boards on one route keep their own keys when the tab or the anchor tells them apart', () => {
  assert.equal(pageKeyFor('/admin/contracts', 'super_admin'), 'Super Admin · Contracts');
  assert.equal(pageKeyFor('/admin/contracts', 'super_admin', { search: 'tab=ndas' }), 'Super Admin · Contracts · NDAs');
  assert.equal(pageKeyFor('/admin/contracts', 'admin', { search: '?tab=document-types' }), 'Admin · Contracts', 'Document types is HQ\'s');
  assert.equal(pageKeyFor('/admin/revenue', 'super_admin'), 'Super Admin · Revenue');
  for (const [hash, module] of [['#disputes', 'Disputes'], ['#refunds', 'Refunds'], ['#statements', 'Statements'], ['#promotions', 'Promotions']]) {
    assert.equal(pageKeyFor('/admin/revenue', 'super_admin', { hash }), `Super Admin · Revenue · ${module}`, hash);
  }
  assert.equal(pageKeyFor('/admin/revenue', 'super_admin', { hash: '#elsewhere' }), 'Super Admin · Revenue');
});

test('an admin on a member\'s page gets that page\'s key', () => {
  assert.equal(pageKeyFor('/validate/verdict', 'super_admin'), 'Founder · Validate · Verdict');
  assert.equal(pageKeyFor('/practice/sessions', 'admin'), 'Advisor · Practice · Sessions');
  assert.equal(pageKeyFor('/spinout-lab/discovery', 'admin'), 'Founder · Spin-Out Lab');
  // Their own pages first: Messages is the admin's own.
  assert.equal(pageKeyFor('/messages', 'admin'), 'Admin · Messages');
});

// ── the provider, useRailOption, and the run's rail context ──────────────────

function Probe({ seen }) {
  const crumbs = useRailCrumbs();
  const page = useRailPage();
  seen.push({ crumbs, page: page?.page ?? null, option: page?.option?.key ?? null });
  return null;
}
function Option({ k, label }) { useRailOption(k, label); return null; }
function Record({ title, ref }) {
  const set = useSetRailCrumbs();
  React.useEffect(() => { set({ record: title, ref }); return () => set({ record: null }); }, [set, title, ref]);
  return null;
}
let go = null;
function Nav() { go = useNavigate(); return null; }

async function mount(tree, path) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(Nav), tree)); });
  return {
    render: async (next) => act(async () => { root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(Nav), next)); }),
    navigate: async (to) => act(async () => { go(to); }),
    done: async () => { await act(async () => root.unmount()); restore(); },
  };
}
const last = (seen) => seen[seen.length - 1];

test('the shell\'s provider gives every rail its page key, section and module from the route', async () => {
  const seen = [];
  const m = await mount(React.createElement(RailPageProvider, { role: 'investor' }, React.createElement(Probe, { seen })), '/deals/screening');
  try {
    assert.deepEqual(last(seen).crumbs, { section: 'Deals', module: 'Screening', record: null });
    assert.equal(last(seen).page, 'Investor · Deals · Screening');
    assert.deepEqual(currentRail(), { page: 'Investor · Deals · Screening', option: null, record: null });
    await m.navigate('/portfolio');
    assert.deepEqual(last(seen).crumbs, { section: 'Portfolio', module: null, record: null });
    await m.navigate('/nowhere');
    assert.equal(last(seen).crumbs, null, 'no key, no crumbs: the rail falls back to its workspace');
    assert.deepEqual(currentRail(), { page: null, option: null, record: null });
  } finally { await m.done(); }
  assert.deepEqual(currentRail(), { page: null, option: null, record: null }, 'unmounted, it clears');
});

test('useRailOption names the open option as the last crumb and the run\'s option, and clears it on close', async () => {
  const seen = [];
  const tree = (open, record = null) => React.createElement(RailPageProvider, { role: 'founder' },
    React.createElement(RailCrumbsProvider, { section: 'Validate', module: 'Problem discovery' },
      record && React.createElement(Record, { title: 'Manual reconciliation', ref: record }),
      open && React.createElement(Option, { k: 'fill:pain_tag', label: 'Tag pain phrases' }),
      React.createElement(Probe, { seen })));
  const m = await mount(tree(false), '/validate/problem-discovery');
  try {
    assert.deepEqual(last(seen).crumbs, { section: 'Validate', module: 'Problem discovery', record: null });
    await m.render(tree(true));
    assert.deepEqual(last(seen).crumbs, { section: 'Validate', module: 'Problem discovery', record: 'Tag pain phrases' });
    assert.equal(last(seen).option, 'fill:pain_tag');
    assert.deepEqual(currentRail(), { page: 'Founder · Validate · Problem discovery', option: 'fill:pain_tag', record: null });
    await m.render(tree(false));
    assert.deepEqual(last(seen).crumbs, { section: 'Validate', module: 'Problem discovery', record: null }, 'closed, the rail is the page\'s again');
    assert.equal(last(seen).option, null);
    // A record view's title is the crumb, and its ref is the run's record; an option over it wins while open.
    const ref = { type: 'validate/problem-discovery', id: '41' };
    await m.render(tree(false, ref));
    assert.equal(last(seen).crumbs.record, 'Manual reconciliation');
    assert.deepEqual(currentRail(), { page: 'Founder · Validate · Problem discovery', option: null, record: ref });
    await m.render(tree(true, ref));
    assert.equal(last(seen).crumbs.record, 'Tag pain phrases');
    assert.deepEqual(currentRail().record, ref);
  } finally { await m.done(); }
});

test('closing one option leaves another opened since, and outside the shell the hook does nothing', async () => {
  const seen = [];
  const tree = (a, b) => React.createElement(RailPageProvider, { role: 'founder' },
    a && React.createElement(Option, { k: 'fill:pain_tag', label: 'A' }),
    b && React.createElement(Option, { k: 'transcribe:interview', label: 'Record a session' }),
    React.createElement(Probe, { seen }));
  const m = await mount(tree(true, false), '/validate');
  try {
    assert.equal(last(seen).crumbs.record, 'A', 'with no page provider below, the shell names the option');
    await m.render(tree(true, true));
    assert.equal(last(seen).option, 'transcribe:interview');
    assert.deepEqual(last(seen).crumbs, { section: 'Validate', module: null, record: 'Record a session' });
    await m.render(tree(false, true));
    assert.equal(last(seen).option, 'transcribe:interview', 'the first closing does not clear the second');
  } finally { await m.done(); }
  const alone = [];
  const m2 = await mount(React.createElement(React.Fragment, null, React.createElement(Option, { k: 'fill:pain_tag', label: 'A' }), React.createElement(Probe, { seen: alone })), '/validate');
  try {
    assert.deepEqual(last(alone), { crumbs: null, page: null, option: null });
    assert.deepEqual(currentRail(), { page: null, option: null, record: null });
  } finally { await m2.done(); }
});

test('every run the rail starts sends rail: { page, option, record }', async () => {
  const bodies = [];
  const orig = globalThis.fetch;
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async (url, init = {}) => { bodies.push([String(url).replace(/^.*\/api/, ''), init.body ? JSON.parse(init.body) : null]); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const { api } = await import('../src/lib/api.js');
    const { eadwynApi } = await import('../src/lib/api/eadwyn.js');
    const rail = { page: 'Founder · Validate · Problem discovery', option: 'fill:pain_tag', record: { type: 'validate/problem-discovery', id: '41' } };
    setCurrentRail(rail);
    assert.deepEqual(railBody(), { rail });
    await api.proposeValidate(7, { kind: 'pain_tag' });
    await api.aiWorkspaceExplain({ workspace: 'Validate', page: '/validate' });
    await api.research.zoneDraftRun('validate/problem-discovery', '7', '/validate');
    await eadwynApi.ask('c1', { question: 'Why?', page: '/validate' });
    assert.deepEqual(bodies.map(([path, b]) => [path, b.rail]), [
      ['/founder/validate/propose/7', rail], ['/ai/workspace/explain', rail], ['/research/drafts', rail], ['/eadwyn/conversations/c1/ask', rail],
    ]);
    // With no page known, the bodies are as they were.
    setCurrentRail(null);
    assert.deepEqual(railBody(), {});
    await api.proposeValidate(7, { kind: 'pain_tag' });
    assert.deepEqual(bodies.at(-1)[1], { kind: 'pain_tag' });
  } finally { globalThis.fetch = orig; setCurrentRail(null); }
});

test('the shell mounts the provider with its shell role, and Validate\'s options call useRailOption', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /<RailPageProvider role=\{shellRole\}>\s*<RailStripSlot\.Provider value=\{railStrip\}>/);
  const cycle = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.match(cycle, /useRailOption\('transcribe:interview', 'Record a session'\)/);
  // D771 (#2097, Grow): every cycle's fill band names itself, not Validate's alone.
  assert.match(cycle, /railOption=\{`fill:\$\{fillKind\}`\}/);
  const fill = readFileSync('frontend/src/workspaces/FillProposals.jsx', 'utf8');
  assert.match(fill, /useRailOption\(railOption && enabled && \(busy === 'run' \|\| items\.length > 0\) \? railOption : null/);
  // The rail's body is D769's (PR 2, #2088): it reads the page key through the provider only.
  const rail = readFileSync('frontend/src/ui/WorkerRail.jsx', 'utf8');
  assert.doesNotMatch(rail, /railPages/);
  assert.match(rail, /const railPage = useRailPage\(\);/);
  // D781 reads the same provider value; it does not add another hook or resolve the map.
  assert.deepEqual(rail.match(/useRailPage\(\)[^;]*;/g), ['useRailPage();']);
  assert.match(rail, /\{\.\.\.\(railPage\?\.page \? \{ 'data-page-key': railPage\.page \} : \{\}\)\}/);
});
