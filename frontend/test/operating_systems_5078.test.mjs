/**
 * D5078 (#5078; Build v2 BD20 A/B/C, BD12, BD24 B) — Operating systems as
 * Systems · Cadence · Tools: one prerequisite before a company exists, one
 * state and one action per system, one entry to the cadence workflow with its
 * drafts, Tools that draw their action and why, phone cards, and sync history
 * that says it is the latest 20.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/operating_systems_5078.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  OsCadenceBands, OperatingSystemsView, CadenceView, SystemsList,
} from '../src/pages/cycles/OperatingSystemsHome.jsx';
import { cadenceView, sectionOf, systemRowView, systemsSummaryText, ventureQuery } from '../src/pages/cycles/operatingSystemsModel.js';
import ToolsHistory from '../src/pages/cycles/ToolsHistory.jsx';
import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import buildDef from '../src/pages/cycles/defs/build.jsx';

const ENTRY = '/build/operating-systems?project_id=12';
const html = (el, entry = ENTRY) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const count = (out, re) => (out.match(re) || []).length;
/** The link a test id names: its href (unescaped) and its text, whatever the attribute order. */
function link(out, id) {
  const m = new RegExp(`<a ([^>]*data-testid="${id}"[^>]*)>([^<]*)<`).exec(out);
  if (!m) return null;
  return { href: (/href="([^"]*)"/.exec(m[1]) || [])[1]?.replace(/&amp;/g, '&') ?? null, text: m[2], cls: (/class="([^"]*)"/.exec(m[1]) || [])[1] || '' };
}

const SYSTEMS = {
  state: 'ok', summary: { connected: 2, failing: 1, disconnected: 0, not_connected: 2, total: 5 },
  next: { text: 'Reconnect Accounting', href: '/build/connect?tool=quickbooks&project_id=12' },
  rows: [
    { kind: 'bank', label: 'Bank', state: 'connected', provider: 'Mercury', line: 'Last good sync 9 Nov', owner: 'You', action: { intent: 'manage', text: 'Manage', href: '/build/operating-systems/bank?project_id=12' } },
    { kind: 'accounting', label: 'Accounting', state: 'failing', provider: 'QuickBooks', line: 'Failing since 6 Nov · last good sync 5 Nov', why: 'The token expired.', owner: 'Ada', action: null, reason: 'Only Ada can reconnect it.' },
    { kind: 'payroll', label: 'Payroll', state: 'not_connected', provider: null, line: 'Connect a provider to start', action: { intent: 'connect', text: 'Connect', href: '/build/operating-systems/payroll?project_id=12' } },
    { kind: 'crm', label: 'CRM', state: 'disconnected', provider: 'HubSpot', line: 'Reconnect required · access was revoked', owner: 'You', action: { intent: 'reconnect', text: 'Reconnect', href: '/build/connect?tool=hubspot&project_id=12' } },
    { kind: 'workspace', label: 'Workspace', state: 'not_connected', provider: null, line: 'Connect a provider to start', action: { intent: 'connect', text: 'Connect', href: '/build/operating-systems/workspace?project_id=12' } },
  ],
};
const READ = { card: { state: 'ok' }, parts: { systems: SYSTEMS } };
const NO_COMPANY = { card: { state: 'not_recorded', reason: 'This project has no company scope for connectors.' }, parts: { systems: { state: 'not_recorded', rows: [], summary: null, next: null } } };

test('the section is the hash: Systems by default, Cadence and Tools by name, and the venture is kept', () => {
  // Mutation checked: sectionOf defaulting to tools → the bare address opens Tools.
  assert.deepEqual(['', '#systems', '#cadence', '#tools', '#TOOLS', '#elsewhere'].map(sectionOf), ['systems', 'systems', 'cadence', 'tools', 'tools', 'systems']);
  assert.deepEqual([ventureQuery('?project_id=12&x=1'), ventureQuery('?project=7'), ventureQuery('?project_id=abc'), ventureQuery('')], ['?project_id=12', '?project_id=7', '', '']);
  const out = html(h(OperatingSystemsView, { section: 'cadence', data: READ, projectId: 12, search: '?project_id=12' }));
  assert.match(out, /href="\/build\/operating-systems\?project_id=12#systems"[^>]*>Systems</);
  assert.match(out, /<a [^>]*aria-current="page"[^>]*>Cadence</);
  assert.equal(count(out, /aria-current="page"/g), 1, 'one current section');
  assert.match(out, /href="\/build\/operating-systems\?project_id=12#tools"[^>]*>Tools</);
});

test('BD20 A, BD24 B: no company is one prerequisite with Go to Company Creation, never five Not connected rows', () => {
  // Mutation checked: draw SystemsList without a company → five os-system rows; drop the company check → "Not recorded" rows.
  for (const phone of [false, true]) {
    const out = html(h(OperatingSystemsView, { section: 'systems', data: NO_COMPANY, projectId: 12, search: '?project_id=12', phone }));
    assert.equal(count(out, /data-testid="os-no-company"/g), 1);
    assert.match(out, /Company not linked yet/);
    assert.match(out, /Core company systems become available after this venture has a company\./);
      assert.deepEqual([link(out, 'os-no-company-go')?.href, link(out, 'os-no-company-go')?.text], ['/build/company-creation?project_id=12', 'Go to Company Creation →']);
    assert.equal(count(out, /data-testid="os-system-/g), 0, 'no system rows');
    assert.doesNotMatch(out, /Not connected|Not recorded/);
  }
  // Tools without a company: the same one step, not the tools' own Not recorded line.
  const tools = html(h(OperatingSystemsView, { section: 'tools', data: NO_COMPANY, projectId: 12, search: '?project_id=12', sources: h('i', { 'data-testid': 'the-sources' }) }));
  assert.match(tools, /Tools connect to a company, too/);
  assert.doesNotMatch(tools, /the-sources/);
});

test('BD20 B: each system draws one state, one line and the action its state earns; a non-owner reads who can reconnect', () => {
  // Mutation checked: systemRowView ignoring `reason` → the Accounting row says nothing where its action would be.
  const out = html(h(SystemsList, { systems: SYSTEMS }));
  assert.match(out, /data-testid="os-systems-summary"[^>]*>2 connected · 1 failing · 2 not connected</);
  assert.deepEqual([link(out, 'os-system-action-bank')?.href, link(out, 'os-system-action-bank')?.text], ['/build/operating-systems/bank?project_id=12', 'Manage']);
  assert.deepEqual([link(out, 'os-system-action-payroll')?.href, link(out, 'os-system-action-payroll')?.text], ['/build/operating-systems/payroll?project_id=12', 'Connect']);
  assert.deepEqual([link(out, 'os-system-action-crm')?.href, link(out, 'os-system-action-crm')?.text], ['/build/connect?tool=hubspot&project_id=12', 'Reconnect']);
  assert.match(link(out, 'os-system-action-crm').cls, /bg-violet-700/, 'Reconnect is the row\'s primary');
  assert.doesNotMatch(out, /data-testid="os-system-action-accounting"/, 'no Reconnect for someone else\'s connection');
  assert.match(out, /data-testid="os-system-reason-accounting"[^>]*>Only Ada can reconnect it\.</);
  assert.match(out, /data-testid="os-system-why-accounting"[^>]*>The token expired\.</);
  assert.match(out, /data-testid="os-system-owner-accounting"[^>]*>Connected by Ada</);
  assert.doesNotMatch(out, /Connected by You/);
  assert.match(out, /data-testid="os-system-line-payroll"[^>]*>Connect a provider to start</);
  assert.equal(count(out, /Not recorded/g), 0, 'a system with nothing connected says one line, not three Not recorded facts');
  // Words and tones come from the state alone.
  assert.deepEqual(SYSTEMS.rows.map((r) => systemRowView(r).word), ['Connected', 'Failing', 'Not connected', 'Reconnect required', 'Not connected']);
  assert.equal(systemRowView({ kind: 'x', state: 'weird', action: { href: 'https://evil.example', text: 'Go' } }).action, null, 'an outside link is never drawn');
  assert.equal(systemsSummaryText({ connected: 0, failing: 0, disconnected: 1, not_connected: 4 }), '1 to reconnect · 4 not connected');
  // Phone: the action is a full-width target.
  const phone = html(h(SystemsList, { systems: SYSTEMS, phone: true }));
  assert.match(link(phone, 'os-system-action-bank').cls, /min-h-\[44px\].*w-full/);
});

test('BD20 C: Cadence is one entry to the cadence workflow, its rituals as that workflow reads them, then the drafts', () => {
  // Mutation checked: cadenceView keeping paused rituals → "Old standup" is listed; the entry not keeping the venture → bare /build/cadence.
  const read = {
    store_ready: true,
    rituals: [{ id: 1, name: 'Monday plan', kind: 'plan', frequency: 'weekly', weekday: 1, active: 1 }, { id: 2, name: 'Friday retro', kind: 'retro', frequency: 'weekly', weekday: 5, active: 1 }, { id: 3, name: 'Old standup', kind: 'standup', active: 0 }],
    runs: [{ id: 9, ritual_id: 2, run_date: '2026-11-06', state: 'done' }, { id: 8, ritual_id: 2, run_date: '2026-10-30', state: 'missed' }],
  };
  const view = cadenceView(read);
  assert.deepEqual(view.rituals.map((r) => [r.name, r.last?.run_date ?? null]), [['Monday plan', null], ['Friday retro', '2026-11-06']]);
  const out = html(h(CadenceView, { view, search: '?project_id=12' }));
  assert.equal(count(out, /href="\/build\/cadence\?project_id=12"/g), 1, 'one entry');
  assert.match(out, />Open the operating cadence →</);
  assert.match(out, /Plan · Every Monday/);
  assert.match(out, /Last: Nov 6 · Done/);
  assert.match(out, /No run filed yet/);
  assert.doesNotMatch(out, /Old standup/);
  assert.deepEqual([cadenceView({ store_ready: false }).state, cadenceView(null).state, cadenceView({ rituals: [], runs: [] }).state], ['not_recorded', 'unavailable', 'empty']);
  const failed = html(h(CadenceView, { view: { state: 'unavailable', rituals: [] }, onRetry: () => {} }));
  assert.match(failed, /data-platform-state="unavailable"/);
  // The Monday plan, retro and annotation bands draw under Cadence only.
  const band = h('i', { 'data-testid': 'band' });
  assert.match(html(h(OsCadenceBands, null, band), `${ENTRY}#cadence`), /data-testid="os-cadence-drafts"[\s\S]*data-testid="band"/);
  assert.equal(html(h(OsCadenceBands, null, band), ENTRY), '');
  assert.equal(html(h(OsCadenceBands, null, band), `${ENTRY}#tools`), '');
});

test('BD12: Tools draws every tool with its action and why, the ones not connected, and the latest 20 syncs', () => {
  // Mutation checked: ToolsHistory dropping `not_connected` → no Vercel row; the heading without the label → "Sync history" alone.
  const tools = {
    cols: [{ key: 'tool', label: 'Tool' }, { key: 'state', label: 'State' }, { key: 'feeds', label: 'Feeds' }, { key: 'last_sync', label: 'Last good sync' }, { key: 'action', label: 'Action' }, { key: 'reason', label: 'Why' }],
    rows: [{ id: 'tool-0', keys: { state: 'failing' }, cells: { tool: 'GitHub', state: 'Failing', feeds: 'Product roadmap', last_sync: '2026-11-05 14:02:00', action: null, reason: 'Token rejected. Only Ada can reconnect it.' } }],
    not_connected: [{ id: 'connect-vercel', keys: { state: 'not_connected' }, cells: { tool: 'Vercel', state: 'Not connected', feeds: 'Prototype / MVP', last_sync: null, action: { text: 'Connect', href: '/build/connect?tool=vercel&project_id=12' }, reason: null } }],
    total: 1, state: 'ok',
    syncs: { state: 'ok', limit: 20, label: 'Latest 20', rows: [{ id: 'sync-1', at: '2026-11-05 14:02:00', provider: 'Vercel', state: 'done', text: 'Not recorded' }] },
  };
  const out = html(h(ToolsHistory, { tools, phone: false }));
  assert.match(out, /data-testid="tools-count"[^>]*>1 tool connected · 1 not connected</);
  assert.match(out, /data-testid="tools-row-1" data-state="not_connected"/);
  assert.match(out, /href="\/build\/connect\?tool=vercel&amp;project_id=12"[^>]*>Connect</);
  assert.match(out, /Token rejected\. Only Ada can reconnect it\./);
  assert.match(out, /data-testid="tools-syncs-title"[^>]*>Sync history · latest 20</);
  assert.match(out, /2026-11-05 14:02:00 · Vercel · Synced/);
  // Phone: cards, never a table scrolled sideways; each action a 44px target.
  const phone = html(h(ToolsHistory, { tools, phone: true }));
  assert.doesNotMatch(phone, /<table/);
  assert.equal(count(phone, /data-testid="tools-card-\d+"/g), 2);
  assert.deepEqual([link(phone, 'tools-card-action-1')?.href, link(phone, 'tools-card-action-1')?.text], ['/build/connect?tool=vercel&project_id=12', 'Connect']);
  assert.match(link(phone, 'tools-card-action-1').cls, /min-h-\[44px\]/);
  assert.equal(link(phone, 'tools-card-action-0'), null, 'no action for a tool the viewer cannot repair');
});

test('a home that places its sources draws the Sources region once, in Tools only; the module def wires it', () => {
  // Mutation checked: CycleModulePage ignoring `placesSources` → the Sources region also draws under Systems.
  const part = h('i', { 'data-testid': 'the-part' });
  const def = buildDef.homes.get('operating-systems');
  assert.equal(typeof def, 'function');
  const home = def(READ, { projectId: 12 });
  assert.equal(home.body.placesSources, true);
  assert.equal(home.Bands, OsCadenceBands);
  assert.deepEqual(home.action, { label: 'Reconnect Accounting', href: '/build/connect?tool=quickbooks&project_id=12' });
  assert.equal(def(NO_COMPANY, { projectId: 12 }).action, null, 'no header action before a company exists');
  for (const Page of [CycleModulePage, PhoneModulePage]) {
    const props = { cycle: 'build', slug: 'operating-systems', data: READ, status: 'ready', sources: part, sourcesAction: { label: 'Connect a tool', href: '/build/connect?project_id=12' }, home: home.body, search: '?project_id=12' };
    const systems = html(h(Page, props));
    assert.equal(count(systems, /data-testid="the-part"/g), 0, `${Page.name}: no tools under Systems`);
    assert.equal(count(systems, /data-testid="os-system-/g) > 0, true);
    const toolsTab = html(h(Page, props), `${ENTRY}#tools`);
    assert.equal(count(toolsTab, /data-testid="the-part"/g), 1, `${Page.name}: the tools draw once, under Tools`);
    assert.equal(count(toolsTab, /data-testid="module-sources"/g), 1);
  }
  // The cadence's door is the Cadence section's own entry now, not a module tool link.
  assert.equal(buildDef.tools.get?.('operating-systems') ?? null, null);
});
