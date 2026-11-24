/**
 * D5081 part 5 (#5081, RA-12) — Raise's one navigation. The desktop tabs sit under four stage headings
 * (Prepare · Build the story · Prepare diligence · Run the raise), which are headings and not routes; the compact
 * select carries the same stages as optgroups and is the only navigation below 1024px; Calls is Capital
 * relationships' own tab, not a peer of the Raise modules, and every address it had still opens it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_nav_d5081.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CYCLES, RAISE_STAGES, cycleTabGroups, cycleTabs } from '../src/pages/cycles/cycleModel.js';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { TABS as CAP_REL_TABS } from '../src/pages/raise/caprel/capRelModel.js';
import { FIX_NEXT, nextPriorityAction } from '../src/pages/cycles/readinessModel.js';

const h = React.createElement;
const read_ = (p) => readFileSync(p, 'utf8');
const read = read_;
const cards = (cycle) => MODULES[cycle].map((m) => ({ slug: m.slug, name: m.name }));
const header = (cycle, active = null, record = false) => renderToStaticMarkup(h(MemoryRouter, null,
  h(CycleHeader, { cycle, cards: cards(cycle), active, search: '?project_id=7', record, title: record ? 'A record' : undefined, moduleName: 'Cap table' })));

test('the four stages, in RA-12’s order, name every Raise module once and Evidence first', () => {
  assert.deepEqual(RAISE_STAGES.map((g) => g.label), ['Prepare', 'Build the story', 'Prepare diligence', 'Run the raise']);
  const staged = RAISE_STAGES.flatMap((g) => g.keys);
  assert.equal(new Set(staged).size, staged.length, 'no module is in two stages');
  assert.deepEqual([...staged].sort(), ['evidence', ...MODULES.raise.map((m) => m.slug)].sort(), 'every Raise module and Evidence, nothing else');
  assert.deepEqual(RAISE_STAGES[0].keys, ['evidence', 'fundraising-readiness']);
  assert.deepEqual(RAISE_STAGES[3].keys, ['capital-relationships'], 'Run the raise is Capital relationships alone');
});

test('cycleTabGroups: Overview leads with no heading, then the stages; another cycle is one group, as before', async () => {
  const tabs = cycleTabs('raise', cards('raise'), 'cap-table', '?project_id=7');
  const groups = cycleTabGroups('raise', tabs);
  assert.deepEqual(groups.map((g) => [g.label, g.tabs.map((t) => t.name)]), [
    ['', ['Overview']],
    ['Prepare', ['Evidence', 'Fundraising readiness']],
    ['Build the story', ['Investor narrative', 'Pitch']],
    ['Prepare diligence', ['Data room', 'Cap table', 'Use of funds']],
    ['Run the raise', ['Capital relationships']],
  ]);
  assert.equal(groups.flatMap((g) => g.tabs).length, tabs.length, 'grouping drops no tab');
  const build = cycleTabs('build', cards('build'));
  assert.deepEqual(cycleTabGroups('build', build), [{ label: '', tabs: build }]);
  await new Promise((r) => setImmediate(r));
});

test('a module the read sends that no stage names is still drawn, after the stages; an empty stage is left out', () => {
  const tabs = cycleTabs('raise', [{ slug: 'cap-table', name: 'Cap table' }, { slug: 'secondaries', name: 'Secondaries' }]);
  const groups = cycleTabGroups('raise', tabs);
  assert.deepEqual(groups.map((g) => [g.label, g.tabs.map((t) => t.key)]), [['', ['']], ['Prepare', ['evidence']], ['Prepare diligence', ['cap-table']], ['', ['secondaries']]]);
  assert.deepEqual(cycleTabGroups('raise', null), []);
});

test('Calls is Capital relationships’ own tab, not a Raise peer; its addresses still open it', () => {
  assert.equal(CYCLES.raise.history, undefined);
  for (const active of [null, 'capital-relationships', 'evidence']) {
    assert.equal(cycleTabs('raise', cards('raise'), active).some((t) => t.name === 'Calls' || /\/calls\b/.test(t.href)), false, String(active));
  }
  assert.deepEqual(CAP_REL_TABS.map((t) => t.id), ['overview', 'pipeline', 'match', 'outreach', 'commitments', 'calls', 'activity'], 'Commitments and Calls are the tool’s tabs');
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes('<Route path="/raise/capital-relationships/calls/:uid"'), 'one call keeps its page');
  assert.match(read('frontend/src/lib/railPages.js'), /alias\('\/raise\/calls', key\(F, 'Raise', 'Capital relationships'\)/, '/raise/calls still forwards to the Calls tab');
  assert.match(read('frontend/src/pages/raise/caprel/capRelModel.js'), /CLOSING = Object\.freeze\(\{ id: 'closing', label: 'Closing', path: '\/closing' \}\)/, 'Closing is an address under the tool');
});

test('desktop: one list under stage headings; the select is the compact navigation, with the same stages as optgroups', () => {
  const out = header('raise', 'use-of-funds');
  const nav = out.slice(out.indexOf('<nav'), out.indexOf('</nav>'));
  assert.match(nav, /class="mt-1 hidden flex-wrap gap-1\.5 lg:flex items-center"/, 'the list is display:none below 1024px');
  assert.deepEqual([...nav.matchAll(/role="group" aria-label="([^"]+)"/g)].map((m) => m[1]), RAISE_STAGES.map((g) => g.label));
  assert.deepEqual([...nav.matchAll(/<span aria-hidden="true"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]), RAISE_STAGES.map((g) => g.label), 'a visible heading per stage, named once for assistive tech by its group');
  const links = [...nav.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
  assert.equal(links.length, 9, 'Overview, Evidence and the seven modules');
  for (const [name, href] of links) assert.match(href, /[?&]project_id=7\b/, `${name} keeps the venture`);
  assert.equal(links.find(([n]) => n === 'Pitch')[1].startsWith('/raise/pitch?'), true, 'Pitch opens the one Pitch Studio (D4853)');
  assert.match(nav, /aria-current="page"[^>]*>Use of funds</);
  const label = out.slice(out.lastIndexOf('<label', out.indexOf('<select')), out.indexOf('</label>', out.indexOf('<select')));
  assert.match(label, /px-3\.5 lg:hidden/, 'the select is display:none from 1024px');
  assert.deepEqual([...label.matchAll(/<optgroup label="([^"]+)"/g)].map((m) => m[1]), RAISE_STAGES.map((g) => g.label));
  assert.match(label, /<option value="overview">Overview<\/option><optgroup label="Prepare">/, 'Overview sits above the stages');
  assert.doesNotMatch(out, /value="calls"/);
});

test('a record keeps its row above the stages; another cycle draws no stage and no optgroup', () => {
  const rec = header('raise', 'cap-table', true);
  assert.match(rec, /<option value="record"[^>]*>A record<\/option><option value="overview">Overview<\/option><optgroup label="Prepare">/);
  const build = header('build');
  assert.doesNotMatch(build, /role="group"|<optgroup|cycle-tab-stage/);
});

test('Fundraising readiness: Fix next priority opens the first priority’s workflow, or the header has no action', () => {
  const row = (id, cells) => ({ id, cells: { item: id, updated: '2026-11-10', ...cells } });
  const read = (rows) => ({ total: rows.length, rows });
  const records = read([
    row('narrative', { score: 9, evidence: 'measured', missing: null, fix_href: '/raise/investor-narrative' }),
    row('data_room', { score: 3, evidence: 'stated', missing: 'No financials', fix_href: '/raise/data-room/checklist' }),
    row('cap_table', { score: 5, evidence: 'stated', missing: 'No option pool', fix_href: '/raise/cap-table' }),
  ]);
  const act = nextPriorityAction(records);
  assert.equal(act.label, FIX_NEXT);
  assert.equal(act.href, '/raise/data-room/checklist', 'the largest gain first, as the page lists it');
  assert.equal(nextPriorityAction(read([row('narrative', { score: 9, evidence: 'measured', fix_href: '/raise/investor-narrative' })])), null, 'nothing needs attention: no action');
  for (const r of [null, undefined, { state: 'unreadable' }]) assert.equal(nextPriorityAction(r), null, 'a read not here or failed offers nothing');
  assert.equal(nextPriorityAction(read([row('team', { score: 2, missing: 'No CTO', fix_href: '/build/founding-team' })])), null, 'Team is assessed by a person, never a priority');
  assert.match(read_('frontend/src/pages/cycles/CycleRoute.jsx'), /action=\{companyReadOnly \? null : home && Object\.hasOwn\(home, 'action'\) \? home\.action : action\}/);
});

test('the hub stays frozen: CycleRoute and App gain nothing for this part, and the decision is recorded', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.doesNotMatch(route, /cycleTabGroups|RAISE_STAGES/);
  const doc = read('documentation/architecture/decisions/D5081-p5.md');
  assert.match(doc, /^## D5081 part 5 — Raise tools own their pages: the Raise navigation \(#5081\)$/m);
  assert.match(doc, /What the board draws that no read backs/);
});
