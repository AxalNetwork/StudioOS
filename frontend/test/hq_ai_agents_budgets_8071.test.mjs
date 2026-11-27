/**
 * D9111 (#9111): HQ › AI agents › Operations › Spend › Agent budgets, built to the landed canvas (D4137-p3, SA15 to
 * SA19) over D8071's routes.
 *
 *   1. The model: the share, the meter words (■ At cap, ▲ 80% and over, ○ No cap, ∅ Not applicable, ? Unavailable),
 *      highest share first, a null cap as No cap with use still shown, a failed read never 0.
 *   2. The ceilings in force (the workspace's own, else the platform's, never above it) and the workspace form
 *      refusing a figure above the platform's (SA17F's Above the ceiling).
 *   3. The edit form: only the changed fields, tokens in millions, blank as no cap; Save needs a reason.
 *   4. Halted runs in their own refusal's words.
 *   5. The panel, its states, the edit panel and the phone card render what the routes send; the sponsor's view has
 *      no edit control.
 *   6. The client calls mounted routes; Spend carries the Platform spend / Agent budgets switch.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ai_agents_budgets_8071.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  METER_WORDS, agentMeters, canSave, capsForm, ceilingInForce, ceilingRows, changedCaps, changedCeilings, haltedRows,
  meter, meterShare, setLine, sortByShare, topShare,
} from '../src/pages/hq/aiAgents/budgetsModel.js';
import {
  BudgetsView, EditCapsBody, EditCeilingsBody, LoadingBudgets, PhoneAgentCard, SpendSwitch, UnavailableBudgets,
} from '../src/pages/hq/aiAgents/Budgets.jsx';
import { RefusedBudget, SponsorBudget } from '../src/pages/hq/aiAgents/BudgetParts.jsx';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const PERIOD = { month: '2026-11', day: '2026-11-21', kind: 'calendar_month_utc' };
const agent = (over = {}) => ({
  agent_uid: 'a'.repeat(32), name: 'Sample Builder', role_key: 'cto', scope_kind: 'project', scope_id: 7, scope_name: 'Sample Project',
  period: PERIOD, caps: { tokens: 3_000_000, minutes: 1200, prs_per_day: 5, retries_per_task: 3 },
  used: { tokens: 2_450_000, minutes: 1020, prs_today: 4 }, set_at: '2026-11-03 10:00:00', set_by: 'Sample Admin', ...over,
});
const DATA = {
  platform: { agents_cap: 10, live_agents_cap: 3, ai_spend_cap_cents: 30_000, compute_spend_cap_cents: null },
  workspaces: [{ scope_kind: 'project', scope_id: 7, scope_name: 'Sample Project',
    caps: { agents_cap: 8, live_agents_cap: null, ai_spend_cap_cents: null, compute_spend_cap_cents: null },
    used: { agents: 2, live_agents: 1, ai_spend_microusd: 194_700_000, compute_spend_microusd: 0 } }],
  agents: [
    agent({ agent_uid: 'b'.repeat(32), name: 'Sample Clerk', caps: { tokens: 1_000_000, minutes: null, prs_per_day: null, retries_per_task: null }, used: { tokens: 310_000, minutes: 60, prs_today: 0 } }),
    agent(),
  ],
  halted: [
    { run_uid: 'run-0001', agent_uid: 'a'.repeat(32), task_uid: 'c'.repeat(32), refusal: 'budget_exhausted', ended_at: '2026-11-21 09:14:02' },
    { run_uid: 'run-0002', agent_uid: 'a'.repeat(32), task_uid: 'd'.repeat(32), refusal: 'budget_unreadable', ended_at: '2026-11-20 16:52:00' },
  ],
};

// ── 1. The model ────────────────────────────────────────────────────────────

test('the share is used over cap, rounded; no cap or no use compares nothing; a cap of 0 is reached', () => {
  assert.equal(meterShare(2_450_000, 3_000_000), 82);
  assert.equal(meterShare(5, 5), 100);
  assert.equal(meterShare(3, null), null);
  assert.equal(meterShare(undefined, 3), null);
  assert.equal(meterShare(0, 0), 100);
});

test('meter words: at cap at 100%, near from 80%, within below; No cap keeps the use; Not applicable; Unavailable never 0', () => {
  assert.equal(meter(5, 5).kind, 'at_cap');
  assert.match(meter(5, 5).word, /^■ At cap · 100%$/);
  assert.equal(meter(80, 100).kind, 'near', '80% is the near line');
  assert.match(meter(80, 100).word, /^▲ 80% · 80% and over$/);
  assert.equal(meter(79, 100).kind, 'within');
  assert.equal(meter(79, 100).word, '79%');
  const none = meter(310_000, null, { text: (v) => `${v} t` });
  assert.deepEqual([none.kind, none.word, none.used], ['no_cap', METER_WORDS.no_cap, '310000 t'], 'No cap in words, use still shown');
  assert.equal(METER_WORDS.no_cap, '○ No cap');
  assert.equal(meter(1, 1, { state: 'not_applicable' }).word, '∅ Not applicable');
  const failed = meter(0, 100, { state: 'unavailable' });
  assert.deepEqual([failed.kind, failed.word, failed.used], ['unavailable', '? Unavailable', 'Unavailable']);
  assert.notEqual(failed.used, '0', 'a failed read is never 0');
  assert.equal(meter(undefined, 3).kind, 'not_recorded', 'a use the read does not carry is Not recorded');
  assert.deepEqual([meter(undefined, null).kind, meter(undefined, null).used], ['no_cap', 'Not recorded'], 'no cap and no use: Not recorded, never 0');
});

test('an agent\'s four meters: retries on one task carry no use in the read, so they say Not recorded, never 0', () => {
  const [tokens, minutes, prs, retries] = agentMeters(agent());
  assert.deepEqual([tokens.meter.used, tokens.meter.cap, tokens.meter.share], ['2.45M', '3.00M', 82]);
  assert.deepEqual([minutes.meter.kind, minutes.meter.share], ['near', 85]);
  assert.deepEqual([prs.meter.kind, prs.meter.share], ['near', 80]);
  assert.deepEqual([retries.meter.kind, retries.meter.used], ['not_recorded', 'Not recorded']);
  const unr = agentMeters(agent(), { unavailable: true });
  assert.ok(unr.every((c) => c.meter.kind === 'unavailable' && c.meter.used === 'Unavailable'));
});

test('sorted by the highest share used; an agent with nothing to compare goes last', () => {
  const open = agent({ agent_uid: 'e'.repeat(32), name: 'Sample Open', caps: { tokens: null, minutes: null, prs_per_day: null, retries_per_task: null } });
  const full = agent({ agent_uid: 'f'.repeat(32), name: 'Sample Full', used: { tokens: 3_000_000, minutes: 0, prs_today: 0 } });
  assert.equal(topShare(agent()), 85);
  assert.equal(topShare(open), null);
  assert.deepEqual(sortByShare([open, DATA.agents[0], agent(), full]).map((a) => a.name), ['Sample Full', 'Sample Builder', 'Sample Clerk', 'Sample Open']);
});

test('who set the caps and when; no row is "No caps set yet"; a row naming nobody says Not recorded', () => {
  assert.equal(setLine(agent()), 'Set by Sample Admin · 3 Nov 2026');
  assert.equal(setLine(agent({ set_at: null, set_by: null })), 'No caps set yet');
  assert.equal(setLine(agent({ set_by: null })), 'Set by Not recorded · 3 Nov 2026');
});

// ── 2. Ceilings ─────────────────────────────────────────────────────────────

test('the ceiling in force: the workspace\'s own, else the platform\'s, never above it', () => {
  assert.deepEqual(ceilingInForce(null, null), { cap: null, source: 'none' });
  assert.deepEqual(ceilingInForce(null, 10), { cap: 10, source: 'platform' });
  assert.deepEqual(ceilingInForce(8, null), { cap: 8, source: 'workspace' });
  assert.deepEqual(ceilingInForce(12, 10), { cap: 10, source: 'platform' });
  const rows = ceilingRows(DATA.workspaces[0], DATA.platform);
  assert.deepEqual(rows.map((r) => [r.key, r.cap, r.meter.kind]), [
    ['agents_cap', 8, 'within'], ['live_agents_cap', 3, 'within'], ['ai_spend_cap_cents', 30_000, 'within'], ['compute_spend_cap_cents', null, 'no_cap'],
  ]);
  assert.equal(rows[2].meter.used, '$194.70', 'AI spend from micro-dollars to dollars');
  assert.equal(ceilingRows({ ...DATA.workspaces[0], used: { ...DATA.workspaces[0].used, ai_spend_microusd: null } }, DATA.platform)[2].meter.kind, 'not_recorded',
    'an unrecorded charge is Not recorded, never $0');
});

test('the workspace form sends only changed fields and refuses a figure above the platform\'s (Above the ceiling)', () => {
  const own = DATA.workspaces[0].caps;
  assert.deepEqual(changedCeilings({ agents_cap: '8', live_agents_cap: '2', ai_spend_cap_cents: '', compute_spend_cap_cents: '' }, own, DATA.platform),
    { ok: true, caps: { live_agents_cap: 2 } });
  assert.deepEqual(changedCeilings({ agents_cap: '', ai_spend_cap_cents: '250.00' }, own, DATA.platform).caps, { agents_cap: null, ai_spend_cap_cents: 25_000 });
  const above = changedCeilings({ agents_cap: '11' }, own, DATA.platform);
  assert.deepEqual([above.ok, above.field, above.above], [false, 'agents_cap', true]);
  assert.match(above.message, /Above the platform ceiling of 10/);
  assert.equal(changedCeilings({ agents_cap: '10' }, own, DATA.platform).ok, true, 'at the platform figure is allowed');
  assert.equal(changedCeilings({ compute_spend_cap_cents: '9999' }, own, DATA.platform).ok, true, 'no platform figure: no ceiling');
});

// ── 3. The edit form ────────────────────────────────────────────────────────

test('Edit caps sends only the changed fields; tokens are entered in millions; blank is no cap', () => {
  const a = agent();
  const form = capsForm(a.caps);
  assert.deepEqual(form, { tokens_cap: '3', minutes_cap: '1200', prs_per_day_cap: '5', retries_per_task_cap: '3' });
  assert.deepEqual(changedCaps(form, a.caps), { ok: true, caps: {} });
  assert.deepEqual(changedCaps({ ...form, minutes_cap: '900' }, a.caps), { ok: true, caps: { minutes_cap: 900 } });
  assert.deepEqual(changedCaps({ ...form, tokens_cap: '2.4' }, a.caps), { ok: true, caps: { tokens_cap: 2_400_000 } });
  assert.deepEqual(changedCaps({ ...form, retries_per_task_cap: '' }, a.caps), { ok: true, caps: { retries_per_task_cap: null } });
  const bad = changedCaps({ ...form, minutes_cap: '0' }, a.caps);
  assert.deepEqual([bad.ok, bad.field], [false, 'minutes_cap']);
  assert.equal(changedCaps({ ...form, prs_per_day_cap: '0' }, a.caps).caps.prs_per_day_cap, 0, 'zero PRs a day is a cap');
});

test('Save is offered only with a change and a reason', () => {
  const a = agent();
  const change = changedCaps({ ...capsForm(a.caps), minutes_cap: '900' }, a.caps);
  assert.equal(canSave(change, ''), false);
  assert.equal(canSave(change, '   '), false);
  assert.equal(canSave(change, 'Pilot month'), true);
  assert.equal(canSave(changedCaps(capsForm(a.caps), a.caps), 'Pilot month'), false, 'nothing changed');
  assert.equal(canSave(changedCaps({ minutes_cap: '-1' }, a.caps), 'Pilot month'), false);
});

// ── 4. Halted runs ──────────────────────────────────────────────────────────

test('a halted run says its own refusal: the cap was reached, or the budget could not be read', () => {
  const rows = haltedRows(DATA.halted, DATA.agents, 'project:7');
  assert.deepEqual(rows.map((r) => [r.label, r.line, r.agent, r.when]), [
    ['Cap reached', 'The cap was reached, so the run was halted.', 'Sample Builder', '21 Nov 2026, 09:14 UTC'],
    ['Budget could not be read', 'The budget could not be read, so the run was stopped.', 'Sample Builder', '20 Nov 2026, 16:52 UTC'],
  ]);
  assert.deepEqual(haltedRows(DATA.halted, DATA.agents, 'company:1'), [], 'another workspace\'s runs are not listed');
});

// ── 5. Rendering ────────────────────────────────────────────────────────────

test('SA15: the ceilings, each agent\'s four meters highest share first, and the halted runs', () => {
  const out = html(React.createElement(BudgetsView, { data: DATA, onEdit: () => {}, onEditCeilings: () => {}, onOpenRun: () => {} }));
  assert.match(out, /Workspace ceilings · Sample Project/);
  assert.match(out, /Agents in total/);
  assert.match(out, /Agent budgets · Sample Project/);
  assert.ok(out.indexOf('Sample Builder') < out.indexOf('Sample Clerk'), 'highest share first');
  assert.match(out, /Tokens · Nov 2026/);
  assert.match(out, /2\.45M \/ 3\.00M/);
  assert.match(out, /role="meter"/);
  assert.match(out, /○ No cap/);
  assert.match(out, /Period: Nov 2026 · calendar month, UTC/);
  assert.match(out, /Set by Sample Admin · 3 Nov 2026/);
  assert.match(out, /Cap reached · Sample Builder/);
  assert.match(out, /Open run/);
  assert.match(out, /Edit caps/);
  assert.match(out, /Edit ceilings/);
  assert.doesNotMatch(out, /platform ceiling/i, 'an agent\'s caps show no platform ceiling (main has none)');
});

test('SA17B: no caps set says so in words, and use is still shown', () => {
  const none = { tokens: null, minutes: null, prs_per_day: null, retries_per_task: null };
  const out = html(React.createElement(BudgetsView, { data: { ...DATA, agents: DATA.agents.map((a) => ({ ...a, caps: none })) } }));
  assert.match(out, /No caps are set for Sample Project’s agents\. Usage is still counted\./);
  assert.match(out, /2\.45M used/);
});

test('SA17A and SA17C: Loading in the table\'s shape; Unavailable with Try again, no figure and no 0', () => {
  const loading = html(React.createElement(LoadingBudgets));
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Loading budgets and usage/);
  const failed = html(React.createElement(UnavailableBudgets, { onRetry: () => {} }));
  assert.match(failed, /Unavailable/);
  assert.match(failed, /Try again/);
  assert.match(failed, /none is drawn as 0/);
  assert.doesNotMatch(failed, />0</);
});

test('SA16 and SA17F: each field with its unit, use and who set it; Saving, Save failed, and Above the ceiling on the workspace', () => {
  const a = agent();
  const props = { agent: a, form: capsForm(a.caps), onField: () => {}, reason: '', onReason: () => {} };
  const out = html(React.createElement(EditCapsBody, props));
  assert.match(out, /Tokens per month/);
  assert.match(out, />M</);
  assert.match(out, /Used 2\.45M · 82% of the current 3\.00M · ▲ 80% and over/);
  assert.match(out, /Set by Sample Admin · 3 Nov 2026/);
  assert.match(out, /Reason/);
  assert.doesNotMatch(out, /platform ceiling/i);
  assert.match(html(React.createElement(EditCapsBody, { ...props, saving: true })), /Saving…/);
  assert.match(html(React.createElement(EditCapsBody, { ...props, failed: 'Not saved. The agent budgets could not be read.' })), /role="alert"[^>]*>Not saved\./);

  const ws = DATA.workspaces[0];
  const problem = changedCeilings({ agents_cap: '11' }, ws.caps, DATA.platform);
  const ceil = html(React.createElement(EditCeilingsBody, { workspace: ws, platform: DATA.platform, form: { agents_cap: '11' }, onField: () => {}, reason: '', onReason: () => {}, problem }));
  assert.match(ceil, /platform ceiling 10/);
  assert.match(ceil, /data-testid="above-ceiling"[^>]*>Above the platform ceiling of 10/);
});

test('SA18: the phone card stacks the four meters with a 44 px Edit caps; the phone view links the halted runs', () => {
  const card = html(React.createElement(PhoneAgentCard, { agent: agent(), onEdit: () => {} }));
  assert.equal((card.match(/data-meter=/g) || []).length, 4);
  assert.match(card, /min-h-11[^"]*w-full|w-full[^"]*min-h-11/);
  const view = html(React.createElement(BudgetsView, { data: DATA, phone: true, onEdit: () => {} }));
  assert.match(view, /data-testid="budgets-phone"/);
  assert.match(view, /href="#halted-runs"[^>]*>■ 2 runs halted for budget/);
  const one = html(React.createElement(BudgetsView, { data: { ...DATA, halted: DATA.halted.slice(0, 1) }, phone: true }));
  assert.match(one, /■ 1 run halted for budget/, 'the count is the halted runs, not the agents');
  assert.match(view, /grid-cols-2/);
  assert.doesNotMatch(view, /<table/, 'no table at 390');
});

test('SA19: the surfaces carry dark tokens', () => {
  const out = html(React.createElement(BudgetsView, { data: DATA, onEdit: () => {} }));
  for (const light of out.match(/class="[^"]*bg-white[^"]*"/g) || []) assert.match(light, /dark:bg-/, light);
});

test('SA17D and SA17E: the sponsor sees the four meters and halted runs read only; another team\'s agent is Refused', () => {
  const a = agent();
  const out = html(React.createElement(SponsorBudget, { budget: a, halted: DATA.halted }));
  assert.match(out, /Read only\. An HQ super admin sets these caps\./);
  assert.equal((out.match(/data-meter=/g) || []).length, 4);
  assert.match(out, /Cap reached/);
  assert.doesNotMatch(out, /Edit caps|<input|<button/, 'no edit control for a sponsor');
  const refused = html(React.createElement(RefusedBudget));
  assert.match(refused, /data-platform-state="refused"/);
  assert.match(refused, /No figure is shown/);
});

test('the view switch: Platform spend and Agent budgets', () => {
  const out = html(React.createElement(SpendSwitch, { view: 'budgets', onChange: () => {} }));
  assert.match(out, /aria-pressed="false"[^>]*>Platform spend/);
  assert.match(out, /aria-pressed="true"[^>]*>Agent budgets/);
});

// ── 6. Wiring ───────────────────────────────────────────────────────────────

test('the client calls the mounted D8071 routes; Spend switches; Team draws the sponsor card', () => {
  const client = read('../src/lib/api/aiAgentBudgets.js');
  for (const path of ["'/admin/ai-agents/policy/budgets'", '/agents/${enc(uid)}', '/tasks/${enc(uid)}', "'/workspace'", "'/platform'"]) assert.ok(client.includes(path), path);
  const route = read('../../cloudflare-worker/src/routes/admin_ai_agents_policy.ts');
  for (const r of ["r.get('/budgets'", "r.put('/budgets/agents/:uid'", "r.put('/budgets/tasks/:uid'", "r.put('/budgets/workspace'", "r.put('/budgets/platform'"]) assert.ok(route.includes(r), r);
  assert.ok(read('../src/lib/api/teamAgents.js').includes('agentBudget: (uid) => request(`/teams/agents/${enc(uid)}/budget`)'));
  const ops = read('../src/pages/hq/aiAgents/Operations.jsx');
  assert.match(ops, /<SpendSwitch view=\{view\} onChange=\{setView\} \/>/);
  assert.match(ops, /view === "budgets" \? <Budgets RunDetail=\{RunDetail\} \/> : <PlatformSpend \/>/);
  assert.match(read('../src/pages/team/AgentProfileSheet.jsx'), /<SponsorBudgetCard uid=\{a\?\.uid \|\| uid\} \/>/);
});
