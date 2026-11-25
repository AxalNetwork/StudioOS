/**
 * D8080 part 2 (#8080): HQ › AI agents › Roster › Registry, built to the landed canvas (D4137-p4, SA20 to SA24).
 *
 *   1. The address: /hq/ai-agents/roster/registry[/:name] opens the registry; a persona key still opens its page.
 *   2. Stage groups keep the canvas's order, and an entry with no recorded stage is never guessed into one.
 *   3. The five drift marks: Drift · n, Agrees · 0, Not applicable, Not recorded; never a bare zero for a
 *      platform agent the sync does not compare.
 *   4. Counts, filters in the address, and the CSV (formula cells quoted, null left empty).
 *   5. The states: Not recorded (no sync yet), Unavailable with Try again, Refused, Loading in the table's shape.
 *   6. The table, the detail (manifest, drift handoffs, how to change it) and the phone card render what the
 *      route sends, in light and dark classes.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ai_agents_registry_8080.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { viewFor } from '../src/pages/hq/aiAgents/aiAgentsModel.js';
import {
  capabilitySummary, countsLine, driftHandoff, driftMark, filterAgents, filtersFrom, filtersSearch, manifestPath, readState,
  registryCsv, shortCommit, shortDigest, stageGroups, utcStamp,
} from '../src/pages/hq/aiAgents/registryModel.js';
import {
  AgentBody, DriftMark, LoadingRegistry, NotSynced, PhoneCard, RefusedRegistry, StageTable, UnreadableRegistry,
} from '../src/pages/hq/aiAgents/Registry.jsx';

const PAGE = readFileSync(new URL('../src/pages/hq/aiAgents/HqAiAgentsPage.jsx', import.meta.url), 'utf8');
const SHA = 'a'.repeat(64);
const COMMIT = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0';
const agent = (over = {}) => ({
  name: 'keeper', version: '0123456789ab', stage: null, kind: 'platform', owner: 'S21', identity: 'studioos-landing-bot',
  runner_pool: 'trusted', status: 'paused', manifest_sha: SHA, manifest_commit: COMMIT, synced_at: '2026-11-24 17:42:09',
  capabilities: ['code.read', 'code.commit', 'issue.read', 'issue.write', 'ci.read'], models: [], cost_profile: null,
  security_profile: null, live_copies: null, drift: null, drift_count: null, last_run: null, ...over,
});
const venture = (over = {}) => agent({ name: 'market-researcher', kind: 'venture', stage: 'research', status: 'live', identity: 'session', live_copies: 3, drift: [], drift_count: 0, models: ['claude-sonnet'], ...over });
const html = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));

test('8080 p2: the registry has its own address beside the personas', () => {
  assert.deepEqual(viewFor('/hq/ai-agents/roster/registry'), { tab: 'roster', sub: 'registry', agent: null });
  assert.deepEqual(viewFor('/hq/ai-agents/roster/registry/landing-bot'), { tab: 'roster', sub: 'registry-agent', agent: 'landing-bot' });
  assert.deepEqual(viewFor('/hq/ai-agents/roster/vesta'), { tab: 'roster', sub: 'agent', agent: 'vesta' });
  assert.deepEqual(viewFor('/hq/ai-agents/roster'), { tab: 'roster', sub: 'list', agent: null });
  assert.match(PAGE, /<RosterSwitch \/>/);
  assert.match(PAGE, /view\.sub === 'registry' \|\| view\.sub === 'registry-agent' \? <Registry view=\{view\} \/> : <RosterList \/>/);
});

test('8080 p2: the read is recorded, not recorded, or unreadable; never an empty catalogue', () => {
  assert.equal(readState({ status: 'recorded', agents: [] }), 'recorded');
  assert.equal(readState({ status: 'not_recorded', agents: [] }), 'not_recorded');
  for (const bad of [null, undefined, {}, { status: 'recorded' }, { status: 'other', agents: [] }]) assert.equal(readState(bad), 'unreadable');
});

test('8080 p2: stage groups keep the canvas order; no stage is its own group, never guessed', () => {
  const list = [agent({ name: 'z' }), venture({ name: 'op', stage: 'operate' }), venture({ name: 'res' }), venture({ name: 'b', stage: 'build', live_copies: 2 })];
  const g = stageGroups(list);
  assert.deepEqual(g.map((x) => x.key), ['research', 'build', 'operate', 'none']);
  assert.equal(g[3].label, 'Stage not recorded');
  assert.equal(g[1].copies, 2);
  assert.equal(g[3].copies, null, 'a group of platform agents has no copies recorded, not zero');
});

test('8080 p2: the five drift marks', () => {
  assert.deepEqual(driftMark(agent()), { kind: 'not_recorded', label: 'Not recorded' });
  assert.deepEqual(driftMark(venture({ live_copies: 0 })), { kind: 'not_applicable', label: 'Not applicable' });
  assert.deepEqual(driftMark(venture({ live_copies: null })), { kind: 'not_recorded', label: 'Not recorded' }, 'copies not recorded is never Agrees');
  assert.deepEqual(driftMark(venture()), { kind: 'agrees', label: 'Agrees · 0', count: 0 });
  assert.deepEqual(driftMark(venture({ drift_count: 2, drift: [{}, {}] })), { kind: 'drift', label: 'Drift · 2', count: 2 });
  assert.match(html(React.createElement(DriftMark, { agent: venture({ drift_count: 3 }) })), /data-drift="drift"[^>]*><svg aria-hidden="true"[^]*Drift · 3/);
  assert.match(html(React.createElement(DriftMark, { agent: agent() })), /data-drift="not_recorded"[^>]*>[^]*Not recorded/);
  assert.match(html(React.createElement(DriftMark, { agent: venture({ live_copies: 0 }) })), /Not applicable/);
});

test('8080 p2: counts, capabilities and stamps say what they count', () => {
  assert.equal(countsLine([agent(), agent({ name: 'b' })]), '2 entries · 2 platform · 0 venture · live copies not recorded · drift not compared');
  assert.equal(countsLine([agent(), venture({ live_copies: 4, drift_count: 2 }), venture({ name: 'v2', live_copies: 1 })]),
    '3 entries · 1 platform · 2 venture · 5 live copies · drift on 1 entry (2 fields)');
  assert.deepEqual(capabilitySummary(['code.read', 'code.commit', 'issue.read']), { count: 3, domains: 2, text: '3 in 2 domains', byDomain: [['code', 2], ['issue', 1]] });
  assert.equal(capabilitySummary([]).text, '0 in 0 domains');
  assert.equal(capabilitySummary(['ci.read']).text, '1 in 1 domain');
  assert.equal(utcStamp('2026-11-24 17:42:09'), '24 Nov 2026, 17:42 UTC');
  for (const bad of [null, '', 'yesterday', '2026-13-01 00:00:00']) assert.equal(utcStamp(bad), 'Not recorded');
  assert.equal(shortCommit(COMMIT), 'b1c2d3e');
  assert.equal(shortCommit('nope'), 'Not recorded');
  assert.equal(shortDigest(SHA), 'sha256:aaaa…aaaa');
  assert.equal(shortDigest('abc'), 'Not recorded');
  assert.equal(manifestPath('keeper'), 'agents/keeper.agent.yml');
});

test('8080 p2: stage and status filters live in the address; unknown values are dropped', () => {
  assert.deepEqual(filtersFrom('?stage=build&status=live&q=key'), { stage: 'build', status: 'live', q: 'key' });
  assert.deepEqual(filtersFrom('?stage=scale&status=gone'), { stage: '', status: '', q: '' });
  assert.equal(filtersSearch({ stage: 'none', status: '', q: '' }), '?stage=none');
  assert.equal(filtersSearch({ stage: '', status: '', q: '' }), '');
  const list = [agent(), venture(), venture({ name: 'paused-one', status: 'paused' })];
  assert.deepEqual(filterAgents(list, { stage: 'none', status: '', q: '' }).map((a) => a.name), ['keeper']);
  assert.deepEqual(filterAgents(list, { stage: '', status: 'paused', q: '' }).map((a) => a.name), ['keeper', 'paused-one']);
  assert.deepEqual(filterAgents(list, { stage: '', status: '', q: 'LANDING' }).map((a) => a.name), ['keeper'], 'search reads the identity too');
});

test('8080 p2: the CSV keeps null empty and quotes a cell a spreadsheet would run', () => {
  const csv = registryCsv([agent({ owner: '=HYPERLINK("x")' }), venture()]).trim().split('\n');
  assert.equal(csv[0], 'name,version,stage,kind,owner,identity,runner_pool,status,capabilities,models,cost_profile,security_profile,live_copies,drift_fields,manifest_commit,synced_at');
  assert.match(csv[1], /^keeper,0123456789ab,,platform,"'=HYPERLINK\(""x""\)",/);
  assert.match(csv[1], /,,,,,b1c2d3e4/, 'cost, security, copies and drift stay empty, never 0');
  assert.match(csv[2], /,3,0,b1c2/);
});

test('8080 p2: the states are distinct, and none is an empty catalogue', () => {
  const nr = html(React.createElement(NotSynced));
  assert.match(nr, /The registry has not synced yet/);
  assert.match(nr, /This is not zero agents/);
  assert.match(nr, /does not run it yet/, 'the screen does not claim the deploy syncs it');
  const un = html(React.createElement(UnreadableRegistry, { onRetry: () => {} }));
  assert.match(un, /data-platform-state="unavailable"/);
  assert.match(un, /The registry could not be read\./);
  assert.match(un, /Try again/);
  assert.match(un, /href="\/hq\/ai-agents\/roster"/);
  const rf = html(React.createElement(RefusedRegistry));
  assert.match(rf, /data-platform-state="refused"/);
  assert.match(rf, /for super admins/);
  assert.doesNotMatch(rf, /Try again/, 'a refusal is an answer, not a retry');
  const ld = html(React.createElement(LoadingRegistry));
  assert.match(ld, /role="status"[^>]*>Reading the registry…/);
  assert.match(ld, /data-platform-state="loading"/);
});

test('8080 p2: the stage table shows what the route sends, Not recorded where it sends null', () => {
  const [g] = stageGroups([agent()]);
  const out = html(React.createElement(StageTable, { group: g }));
  assert.match(out, /aria-label="Stage not recorded agents"/);
  assert.match(out, /href="\/hq\/ai-agents\/roster\/registry\/keeper"/);
  assert.match(out, /5 in 3 domains/);
  assert.match(out, /None: it makes no model call/);
  assert.match(out, /Not recorded · Not recorded/, 'cost and security are not recorded, never guessed');
  assert.match(out, /live copies not recorded/);
  assert.match(out, /dark:bg-gray-900/);
  assert.doesNotMatch(out, />0</, 'no zero is drawn for a platform agent');
});

test('8080 p2: the detail is the manifest as recorded, its drift with handoffs, and how to change it', () => {
  const a = venture({ drift_count: 2, drift: [
    { name: 'market-researcher', field: 'capabilities', manifest_value: 'research.read', runtime_value: 'research.read company.write', agent_uid: 'ag-1', seen_at: '2026-11-24 17:42:00' },
    { name: 'market-researcher', field: 'budgets', manifest_value: null, runtime_value: '150', agent_uid: 'ag-1', seen_at: '2026-11-24 17:42:00' },
  ] });
  const out = html(React.createElement(AgentBody, { agent: a }));
  assert.match(out, /Manifest as recorded/);
  assert.match(out, /agents\/market-researcher\.agent\.yml/);
  assert.match(out, /href="\/hq\/ai-agents\/operations\/policies"/);
  assert.match(out, /href="\/hq\/ai-agents\/operations\/spend"/);
  assert.match(out, /2 fields disagree/);
  assert.match(out, /research\.read company\.write/);
  assert.match(out, /Last runs[^]*data-platform-state="not_recorded"/);
  assert.match(out, /sha256:aaaa…aaaa/);
  assert.deepEqual(driftHandoff('status'), { to: '/hq/ai-agents/operations', label: 'Open Runs' });
  const plat = html(React.createElement(AgentBody, { agent: agent() }));
  assert.match(plat, /does not compare it/);
  assert.doesNotMatch(plat, /registry-drift/);
});

test('8080 p2: a phone card is a 44 px target with the drift word', () => {
  const out = html(React.createElement(PhoneCard, { agent: venture({ drift_count: 1 }), onOpen: () => {} }));
  assert.match(out, /min-h-\[64px\]/);
  assert.match(out, /Drift · 1/);
  assert.match(out, /Venture/);
  assert.match(out, /Live/);
});
