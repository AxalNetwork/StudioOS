/**
 * D8070 part 2 (#8070): HQ › AI agents › Operations › Policies › Capabilities, built to the landed canvas
 * (D4137-p2, SA10 to SA14).
 *
 *   1. The address: /hq/ai-agents/operations/policies/capabilities opens the matrix; Policies keeps its address.
 *   2. The five reserved names are locked whatever a read says, drawn as images, never as buttons.
 *   3. Cells: Granted, Not granted, Locked, Not offered; a grant held outside the ceiling stays Granted.
 *   4. Missing data is Not recorded or Unavailable, never 0: no grant yet, an unreadable ceiling, last use.
 *   5. Grant and revoke go through the mounted routes with the reason; a refusal shows the Worker's code and words.
 *   6. The states (Loading, Unavailable with Try again, Refused) are distinct, and the phone card and dark classes.
 *   7. Nothing here switches enforcement or changes the ceiling.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ai_agents_capabilities_8070.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { viewFor } from '../src/pages/hq/aiAgents/aiAgentsModel.js';
import {
  RESERVED, REASON_MAX, REASON_MIN, cellLabel, cellState, ceilingState, domainCount, domainsOf, effectLine, filterAgents,
  filtersFrom, filtersSearch, isLocked, lastChangeLine, lastRefusalFrom, offeredCount, orderCatalogue, readFailure, readState,
  reasonOk, revokeReview, roleMates, runHref, shortDay, summary, utcStamp, workerRefusal,
} from '../src/pages/hq/aiAgents/capabilityModel.js';
import {
  CapabilityPanel, Legend, Matrix, MatrixLoading, MatrixRefused, MatrixUnreadable, PanelFailure, PhoneCard, SummaryLine,
} from '../src/pages/hq/aiAgents/CapabilityMatrix.jsx';
import { runFromSearch } from '../src/pages/hq/aiAgents/Operations.jsx';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCREEN = read('../src/pages/hq/aiAgents/CapabilityMatrix.jsx');
const MODEL = read('../src/pages/hq/aiAgents/capabilityModel.js');
const CLIENT = read('../src/lib/api/aiAgentsPolicy.js');
const ROUTES = read('../../cloudflare-worker/src/routes/admin_ai_agents_policy.ts');
const SERVICE = read('../../cloudflare-worker/src/services/agentCapabilities.ts');
const MODULE = read('../src/routes/hqAiAgentsCapabilities.jsx');

const NAMES = [
  ['research.read', 1], ['research.write', 1], ['company.read', 1], ['company.write', 1], ['fund.read', 1],
  ['relationships.read', 1], ['relationships.request-introduction', 1],
  ['code.read', 1], ['code.branch', 1], ['code.commit', 1], ['code.pr', 1],
  ['deploy.preview', 1], ['deploy.staging', 1], ['cloud.read', 1], ['finance.read', 1],
  ['legal.read', 1], ['legal.draft', 1], ['email.read', 1], ['email.draft', 1], ['web.search', 1],
  ['code.merge', 0], ['deploy.production', 0], ['cloud.write', 0], ['finance.execute', 0], ['email.send', 0],
];
// As the route sends it: ordered by domain, then name.
const catalogue = NAMES.map(([name, g]) => ({ name, domain: name.split('.')[0], action: name.split('.')[1], grantable: g === 1, sentence: `[What ${name} allows.]` }))
  .sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
const UID_A = 'a'.repeat(32);
const UID_B = 'b'.repeat(32);
const UID_C = 'c'.repeat(32);
const grant = (capability, over = {}) => ({ capability, granted: true, granted_by: '[Iris Chen]', granted_at: '2026-11-02 09:05:00', grant_reason: '[Pilot for the Q4 report]', revoked_by: null, revoked_at: null, revoke_reason: null, ...over });
const revoked = (capability) => grant(capability, { granted: false, revoked_by: '[Iris Chen]', revoked_at: '2026-10-30 09:05:00', revoke_reason: '[Pilot ended]' });
const agents = [
  { uid: UID_A, role_key: 'research', first_name: '[Market', last_name: 'Researcher]', status: 'active', cells: [grant('research.read'), grant('fund.read'), grant('deploy.staging')] },
  { uid: UID_B, role_key: 'research', first_name: '[Competitor', last_name: 'Analyst]', status: 'active', cells: [grant('research.read'), revoked('fund.read')] },
  { uid: UID_C, role_key: 'engineering', first_name: '[Frontend', last_name: 'Builder]', status: 'paused', cells: [grant('code.read')] },
];
const policy = { enforced: false, ceiling: NAMES.filter(([n, g]) => g && n !== 'deploy.staging' && n !== 'relationships.request-introduction').map(([n]) => n) };
const DATA = { catalogue, policy, agents };
const entry = (name) => catalogue.find((e) => e.name === name);
const html = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));

test('8070 p2: the matrix has its own address beside Platform settings', () => {
  assert.deepEqual(viewFor('/hq/ai-agents/operations/policies/capabilities'), { tab: 'operations', sub: 'capabilities' });
  assert.deepEqual(viewFor('/hq/ai-agents/operations/policies'), { tab: 'operations', sub: 'policies' });
  assert.match(MODULE, /path="\/hq\/ai-agents\/operations\/policies\/capabilities" element=\{guard\(\['admin'\], hqOnly\(<HqAiAgentsPage \/>\)\)\}/);
  assert.match(MODULE, /lazy\(\(\) => import\('\.\.\/pages\/hq\/aiAgents\/HqAiAgentsPage'\)\)/);
});

test('8070 p2: the five reserved names are the service\'s, and locked whatever a read says', () => {
  for (const n of RESERVED) assert.match(SERVICE, new RegExp(`\\['${n.replace('.', '\\.')}', 0\\]`));
  assert.equal(RESERVED.length, 5);
  for (const n of RESERVED) {
    assert.equal(isLocked(entry(n)), true, n);
    // A row that claimed the name grantable is still locked: the Worker refuses it at every check.
    assert.equal(isLocked({ ...entry(n), grantable: true }), true, `${n} claimed grantable`);
    assert.equal(cellState(agents[0], { ...entry(n), grantable: true }, policy), 'locked');
    assert.equal(ceilingState({ ...entry(n), grantable: true }, { enforced: true, ceiling: null }), 'locked');
  }
  const out = html(React.createElement(Matrix, { data: DATA, agents, expanded: domainsOf(catalogue).map((g) => g.domain), onToggle() {}, onOpen() {} }));
  for (const n of RESERVED) {
    assert.match(out, new RegExp(`role="img" aria-label="\\[Market Researcher\\], ${n.replace('.', '\\.')}: locked"`), n);
    assert.doesNotMatch(out, new RegExp(`<button[^>]*aria-label="[^"]*${n.replace('.', '\\.')}: `), `${n} is never a button`);
  }
  const pick = html(React.createElement(CapabilityPanel, { data: DATA, target: {}, onTarget() {}, onClose() {}, onSaved() {} }));
  for (const n of RESERVED) assert.match(pick, new RegExp(`${n.replace('.', '\\.')}</code> Locked: never grantable`));
  const list = html(React.createElement(CapabilityPanel, { data: DATA, target: { agent: UID_C }, onTarget() {}, onClose() {}, onSaved() {} }));
  assert.match(list, /<button[^>]*aria-label="\[Frontend Builder\], code\.merge: locked"/, 'the list opens the explanation');
  assert.match(list, /role="img" aria-label="\[Frontend Builder\], deploy\.staging: not offered"/);
  const locked = html(React.createElement(CapabilityPanel, { data: DATA, target: { agent: UID_C, name: 'code.merge' }, onTarget() {}, onClose() {}, onSaved() {} }));
  assert.match(locked, /data-testid="capability-locked"/);
  assert.match(locked, /capability_ungrantable/);
  assert.doesNotMatch(locked, /data-testid="capability-save"/, 'a locked cell has nothing to press');
});

test('8070 p2: cells read Granted, Not granted, Not offered or Locked; a held grant outside the ceiling stays Granted', () => {
  assert.equal(cellState(agents[0], entry('research.read'), policy), 'granted');
  assert.equal(cellState(agents[1], entry('fund.read'), policy), 'not_granted', 'a revoked row is not a grant');
  assert.equal(cellState(agents[1], entry('deploy.staging'), policy), 'not_offered');
  assert.equal(cellState(agents[0], entry('deploy.staging'), policy), 'granted');
  assert.equal(cellState(agents[1], entry('deploy.staging'), { enforced: false, ceiling: null }), 'not_granted', 'a null ceiling offers every name');
  assert.equal(cellState(agents[1], entry('deploy.staging'), null), 'not_granted', 'an unreadable ceiling is not "not offered"');
  assert.equal(cellLabel('[Pitch Writer]', 'email.draft', 'granted'), '[Pitch Writer], email.draft: granted');
  const research = domainsOf(catalogue).find((g) => g.domain === 'research');
  assert.deepEqual(domainCount(agents[0], research), { granted: 1, of: 2, text: '1/2' });
  const code = domainsOf(catalogue).find((g) => g.domain === 'code');
  assert.deepEqual(code.grantable, ['code.read', 'code.branch', 'code.commit', 'code.pr'], 'code.merge is not counted as grantable');
  assert.deepEqual(orderCatalogue(catalogue).slice(0, 3).map((e) => e.name), ['research.read', 'research.write', 'company.read'], 'the canvas order, not the route\'s');
});

test('8070 p2: missing data is Not recorded or Unavailable, never 0', () => {
  const none = summary({ catalogue, policy, agents: agents.map((a) => ({ ...a, cells: [] })) });
  assert.equal(none.grants, null, 'no grant ever recorded is Not recorded');
  const revokedOnly = summary({ catalogue, policy, agents: [{ ...agents[1], cells: [revoked('fund.read')] }] });
  assert.equal(revokedOnly.grants, 0, 'a recorded revoke makes zero a measured figure');
  assert.equal(summary({ catalogue, policy: null, agents }).offered, null);
  assert.equal(offeredCount(catalogue, policy), 18);
  assert.equal(offeredCount(catalogue, { enforced: false, ceiling: null }), 20);
  assert.deepEqual({ ...summary(DATA), offered: summary(DATA).offered }, { agents: 3, grants: 5, offered: 18, grantable: 20, locked: 5 });

  const empty = html(React.createElement(SummaryLine, { data: { catalogue, policy: null, agents: agents.map((a) => ({ ...a, cells: [] })) } }));
  assert.match(empty, /Not recorded/);
  assert.match(empty, /no capability has been granted to any agent yet/);
  assert.match(empty, /data-platform-state="unavailable"/);
  assert.doesNotMatch(empty, />0 grants</);
  assert.doesNotMatch(empty, />0 of 20</);

  const panel = html(React.createElement(CapabilityPanel, { data: DATA, target: { agent: UID_B, name: 'company.read' }, onTarget() {}, onClose() {}, onSaved() {} }));
  assert.match(panel, /Last used<\/dt><dd[^>]*><span[^>]*data-platform-state="not_recorded"/);
  assert.match(panel, /Last change<\/dt><dd[^>]*><span[^>]*data-platform-state="not_recorded"/, 'never held: Not recorded');
  assert.deepEqual(lastChangeLine(null).recorded, false);
  assert.equal(utcStamp('not a date'), null);
  const bare = agents.map((a) => ({ ...a, cells: [] }));
  const notYet = html(React.createElement(Matrix, { data: { ...DATA, agents: bare }, agents: bare, expanded: ['research'], onToggle() {}, onOpen() {} }));
  assert.match(notYet, /aria-label="\[Market Researcher\], fund: nothing granted"/, 'SA12B: an empty mark, not 0/1');
  assert.doesNotMatch(notYet, />0\/\d</);
  assert.equal(shortDay('2026-11-20 14:06:00'), '20 Nov');
  assert.equal(shortDay(null), null);
  const unreadable = html(React.createElement(Matrix, { data: { ...DATA, policy: null }, agents, expanded: ['research'], onToggle() {}, onOpen() {} }));
  assert.match(unreadable, /ceiling unreadable/);
  assert.doesNotMatch(unreadable, /aria-label="[a-z]+: 0 of \d+ offered"/);
});

test('8070 p2: grant and revoke go through the mounted routes, each with a reason', () => {
  for (const r of ["r.get('/capabilities'", "r.post('/capabilities/grant'", "r.post('/capabilities/revoke'"]) assert.ok(ROUTES.includes(r), r);
  assert.match(CLIENT, /grantCapabilities: \(agentUid, capabilities, reason\) => send\('\/grant', 'POST', \{ agent_uid: agentUid, capabilities, reason \}\)/);
  assert.match(CLIENT, /revokeCapability: \(agentUid, capability, reason\) => send\('\/revoke', 'POST', \{ agent_uid: agentUid, capability, reason \}\)/);
  assert.match(SCREEN, /aiAgentsPolicyApi\.grantCapabilities\(agent\.uid, \[entry\.name\], text\)/);
  assert.match(SCREEN, /aiAgentsPolicyApi\.revokeCapability\(agent\.uid, entry\.name, text\)/);
  assert.equal(REASON_MIN, 10);
  assert.equal(REASON_MAX, 200);
  assert.equal(reasonOk('too short'), false);
  assert.equal(reasonOk('x'.repeat(10)), true);
  assert.equal(reasonOk('x'.repeat(200)), true);
  assert.equal(reasonOk('x'.repeat(201)), false);
  assert.equal(reasonOk('   padded   '), false, 'the reason is counted trimmed, as the Worker counts it');

  const g = html(React.createElement(CapabilityPanel, { data: DATA, target: { agent: UID_B, name: 'fund.read' }, onTarget() {}, onClose() {}, onSaved() {} }));
  assert.match(g, /data-testid="capability-grant"/);
  assert.match(g, /Reason <span[^>]*>· required/);
  assert.match(g, /10 to 200 characters/);
  assert.match(g, /data-testid="capability-reason-count">0 \/ 200/);
  assert.match(g, /data-testid="capability-save"[^>]*disabled=""|disabled=""[^>]*data-testid="capability-save"/, 'no reason, no grant');
  assert.match(g, /Revoked by \[Iris Chen\] · 30 Oct 2026, 09:05 UTC/);
  assert.match(g, /Apply to the Research role: \[Competitor Analyst\]/);
  assert.match(g, /\[Market Researcher\] already has it/);
  assert.match(g, /Enforcement is off/);

  const r = html(React.createElement(CapabilityPanel, { data: DATA, target: { agent: UID_A, name: 'research.read' }, onTarget() {}, onClose() {}, onSaved() {} }));
  assert.match(r, /data-testid="capability-revoke"/);
  assert.match(r, /Revoke research\.read/);
  assert.match(r, /keeps fund\.read, deploy\.staging/);
  assert.match(r, /Once enforcement is on, its next run that needs research\.read is refused with capability_missing/);
  assert.match(revokeReview(agents[0], 'research.read', true), /Its next run that needs research\.read is refused with capability_missing/);
  assert.match(effectLine(true), /^Applies from the agent’s next run\. Runs already going finish/);
  assert.doesNotMatch(effectLine(true), /Enforcement is off/);
  assert.match(effectLine(null), /could not be read/);

  const off = html(React.createElement(CapabilityPanel, { data: DATA, target: { agent: UID_B, name: 'deploy.staging' }, onTarget() {}, onClose() {}, onSaved() {} }));
  assert.match(off, /capability_not_offered/);

  const mates = roleMates(agents, agents[1], 'fund.read');
  assert.deepEqual(mates.toGrant.map((a) => a.uid), []);
  assert.deepEqual(mates.already.map((a) => a.uid), [UID_A]);
  assert.deepEqual(roleMates(agents, agents[0], 'company.read').toGrant.map((a) => a.uid), [UID_B], 'only the same role');
});

test('8070 p2: a refusal shows the Worker\'s code and its own sentence; no answer says so', () => {
  const e = Object.assign(new Error('The platform does not offer fund.read to agents this month.'), {
    status: 403, code: 'capability_not_offered',
    data: { error: 'capability_not_offered', message: 'The platform does not offer fund.read to agents this month.', detail: 'The platform does not offer fund.read to agents this month.', capability: 'fund.read' },
  });
  assert.deepEqual(workerRefusal(e), { code: 'capability_not_offered', message: 'The platform does not offer fund.read to agents this month.', answered: true });
  const net = Object.assign(new Error('TypeError: Failed to fetch'), { data: null });
  assert.deepEqual(workerRefusal(net), { code: null, message: null, answered: false });
  const shown = html(React.createElement(PanelFailure, { failure: workerRefusal(e), kind: 'grant', action: 'Grant fund.read' }));
  assert.match(shown, /The Worker refused this grant/);
  assert.match(shown, /<code[^>]*>capability_not_offered<\/code> The platform does not offer fund\.read to agents this month\./);
  assert.match(shown, /Your reason is kept/);
  const lost = html(React.createElement(PanelFailure, { failure: workerRefusal(net), kind: 'grant', action: 'Grant fund.read' }));
  assert.match(lost, /Could not save/);
  assert.doesNotMatch(lost, /Failed to fetch/, 'a network error\'s own text is never shown');
  assert.equal(readFailure({ status: 403 }), 'refused');
  assert.equal(readFailure({ status: 503 }), 'unreadable');
  assert.equal(readFailure(new Error('x')), 'unreadable');
});

test('8070 p2: the last refusal comes from the run log, and opens the run', () => {
  // Only refused runs, newest first, for this agent: a refused filter dropped would call any run its "last refusal".
  assert.match(SCREEN, /adminAiAgentsApi\.runs\(\{ agent: uid, status: 'refused' \}\)/);
  assert.match(SCREEN, /adminAiAgentsApi\.run\(first\.uid\)/);
  assert.deepEqual(lastRefusalFrom({ runs: [] }, null), { state: 'none' });
  assert.deepEqual(lastRefusalFrom(null, null), { state: 'unreadable' });
  assert.deepEqual(lastRefusalFrom({ runs: [{ uid: '4C1A77E2-run', at: '2026-11-20 14:06:00' }] }, { run: { errors: [{ code: 'capability_missing' }] } }),
    { state: 'recorded', uid: '4C1A77E2-run', at: '2026-11-20 14:06:00', code: 'capability_missing' });
  assert.equal(lastRefusalFrom({ runs: [{ uid: 'run-12345678', at: null }] }, null).code, null, 'no detail: code not recorded, not guessed');
  assert.equal(runHref('run-12345678'), '/hq/ai-agents/operations?run=run-12345678');
  assert.equal(runFromSearch('?run=run-12345678'), 'run-12345678');
  assert.equal(runFromSearch('?run=<script>'), null);
  assert.equal(runFromSearch(''), null);
  const out = html(React.createElement(Matrix, {
    data: DATA, agents, expanded: ['research'], onToggle() {}, onOpen() {},
    refusals: { [UID_A]: { state: 'recorded', uid: 'run-12345678', at: '2026-11-20 14:06:00', code: 'capability_missing' }, [UID_B]: { state: 'none' }, [UID_C]: { state: 'unreadable' } },
  }));
  assert.match(out, /href="\/hq\/ai-agents\/operations\?run=run-12345678"[^>]*>.*capability_missing/);
  assert.match(out, /Last refusal: None/);
  assert.match(out, /Last refusal <span[^>]*data-platform-state="unavailable"/);
});

test('8070 p2: filters live in the address; unknown values are dropped', () => {
  const f = filtersFrom('?role=research&status=paused&q=analyst&x=1', agents);
  assert.deepEqual(f, { role: 'research', status: 'paused', q: 'analyst' });
  assert.deepEqual(filtersFrom('?role=nobody&status=removed', agents), { role: '', status: '', q: '' });
  assert.equal(filtersSearch({ role: 'research', status: '', q: '' }), '?role=research');
  assert.deepEqual(filterAgents(agents, { role: 'research', status: '', q: 'competitor' }).map((a) => a.uid), [UID_B]);
  assert.deepEqual(filterAgents(agents, { role: '', status: 'paused', q: '' }).map((a) => a.uid), [UID_C]);
});

test('8070 p2: the matrix draws the ceiling row, collapsed domains and named cells', () => {
  const out = html(React.createElement(Matrix, { data: DATA, agents, expanded: ['research', 'deploy'], onToggle() {}, onOpen() {} }));
  assert.match(out, /role="grid"/);
  assert.match(out, /Platform offers · as set now/);
  assert.match(out, /aria-label="Platform, deploy\.staging: not offered"/);
  assert.match(out, /aria-label="Platform, deploy\.production: locked"/);
  assert.match(out, /aria-expanded="true"[^>]*data-testid="capability-domain-research"/);
  assert.match(out, /aria-expanded="false"[^>]*data-testid="capability-domain-fund"/);
  assert.match(out, /aria-label="\[Market Researcher\], fund: 1 of 1 granted">1\/1/);
  assert.match(out, /<button[^>]*aria-label="\[Market Researcher\], research\.read: granted"/);
  assert.match(out, /<button[^>]*aria-label="\[Competitor Analyst\], research\.write: not granted"/);
  assert.match(out, /role="img" aria-label="\[Competitor Analyst\], deploy\.staging: not offered"/);
  assert.match(out, /<button[^>]*aria-label="\[Market Researcher\], deploy\.staging: granted"/);
  assert.match(out, />Paused</);
  const legend = html(React.createElement(Legend));
  for (const w of ['Granted', 'Not granted', 'Locked · a person does it, never an agent', 'Not offered now']) assert.ok(legend.includes(w), w);
});

test('8070 p2: the states are distinct, and none is an empty matrix or a zero', () => {
  const loading = html(React.createElement(MatrixLoading));
  const unread = html(React.createElement(MatrixUnreadable, { onRetry() {} }));
  const refused = html(React.createElement(MatrixRefused));
  assert.match(loading, /data-platform-state="loading"/);
  assert.match(unread, /data-platform-state="unavailable"/);
  assert.match(unread, /Try again/);
  assert.match(unread, /not a claim that no capability is granted/);
  assert.match(refused, /data-platform-state="refused"/);
  assert.match(refused, /super admins only/);
  assert.doesNotMatch(refused, /Try again/, 'a refusal is an answer, not a retry');
  for (const s of [loading, unread, refused]) assert.doesNotMatch(s, /data-testid="capability-row"/);
});

test('8070 p2: a phone card lists the granted chips and is a 44 px target; dark pairs are present', () => {
  const card = html(React.createElement(PhoneCard, { agent: agents[0], refusal: { state: 'none' }, onOpen() {} }));
  assert.match(card, /min-h-\[64px\]/);
  assert.match(card, /Research · 3 granted/);
  for (const g of ['research.read', 'fund.read', 'deploy.staging']) assert.ok(card.includes(g), g);
  assert.match(card, /Last refusal: None/);
  assert.match(SCREEN, /phone="sheet"/, 'the panel is a bottom sheet on a phone (SA13B)');
  for (const m of SCREEN.matchAll(/className="([^"]*\bbg-white\b[^"]*)"/g)) assert.match(m[1], /dark:bg-/, m[1]);
});

test('8070 p2: nothing here switches enforcement or changes the ceiling', () => {
  for (const src of [SCREEN, MODEL]) {
    assert.doesNotMatch(src, /setCapabilityEnforcement|setCapabilityCeiling/);
    assert.doesNotMatch(src, /\/capabilities\/(enforcement|ceiling)/);
  }
  assert.equal(readState({ catalogue: [], agents: [] }), 'recorded');
  assert.equal(readState({ agents: [] }), 'unreadable');
});
