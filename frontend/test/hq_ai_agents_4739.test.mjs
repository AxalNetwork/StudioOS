// #4739 (D4160, D4162, D3851): HQ › AI agents. The From Axal lifecycle (SA3 bulk actions, SA4 review, golden
// cases, evals, diff, retire), the Policies controls (models, locks, caps, read tools, engine halt), and the
// words for every refusal. Each button calls its client method with a reason; a refused write shows the
// sentence kept for its code and never the error's own text.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ai_agents_4739.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import { adminHqSkillsApi as skillsApi } from '../src/lib/api/adminHqSkills.js';
import { adminAiAgentsApi as policyApi } from '../src/lib/api/adminAiAgents.js';
import { agentEngineApi } from '../src/lib/api/agentEngine.js';
import { teamAgentsApi } from '../src/lib/api/teamAgents.js';
import { Editor } from '../src/pages/hq/aiAgents/HqAiAgentsPage.jsx';
import { BulkBar } from '../src/pages/hq/aiAgents/SkillLifecycle.jsx';
import { Policies } from '../src/pages/hq/aiAgents/Operations.jsx';
import { BUILD, NOT_RECORDED, skillRow } from '../src/pages/hq/aiAgents/aiAgentsModel.js';
import { POLICY_REFUSALS, SKILL_REFUSALS, bulkLine, policyRefusal, skillRefusal } from '../src/pages/hq/aiAgents/refusals.js';
import {
  actionsFor, blankCase, caseToForm, casesPayload, diffChoices, diffRows, evalLine, formToCase, isAskedReviewer,
} from '../src/pages/hq/aiAgents/skillLifecycleModel.js';
import {
  areaForm, areasPayload, capsForm, capsPayload, haltLine, haltReasonFits, microToUsd, modelOptions, usdToMicro, withTool, withoutTool,
} from '../src/pages/hq/aiAgents/policyModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const REASON = 'Reviewed with the second Super Admin.';
const settle = async (ui) => { await ui.flush(); await ui.flush(); };
const find = (ui, id) => ui.nodes().filter((n) => ui.props(n)?.['data-testid'] === id);
const type = async (ui, id, value) => { const [n] = find(ui, id); assert.ok(n, `no ${id}`); await act(async () => ui.props(n).onChange({ target: { value, checked: true } })); };
const press = async (ui, id) => { const [n] = find(ui, id); assert.ok(n, `no ${id}`); assert.ok(!ui.props(n).disabled, `${id} is disabled`); await act(async () => ui.props(n).onClick({ stopPropagation() {} })); await settle(ui); };
/** A request that was refused: the body on `data`, and raw error text that must never reach the screen. */
const txt = (n) => n.textContent || (n.childNodes ?? []).map(txt).join('');
const refused = (status, error, extra = {}, message = 'RAW socket hang up') => Object.assign(new Error(message), { status, data: { error, ...extra } });
/** Swaps client methods for a test and puts them back. */
function stub(obj, fns) {
  const old = {}; for (const k of Object.keys(fns)) { old[k] = obj[k]; obj[k] = fns[k]; }
  return () => { for (const k of Object.keys(old)) obj[k] = old[k]; };
}

// ─── The model ──────────────────────────────────────────────────────────────

test('H2 is live, and a status offers the actions that status allows', () => {
  assert.equal(BUILD.H2.live, true);
  assert.deepEqual(actionsFor({ status: 'draft' }), { review: true, decide: false, publish: true, evals: true, retire: true, cases: true });
  assert.equal(actionsFor({ status: 'in_review' }).decide, true);
  assert.equal(actionsFor({ status: 'published' }).review, false);
  assert.equal(actionsFor({ status: 'published' }).retire, true);
  assert.deepEqual(Object.values(actionsFor({ status: 'retired' })), [false, false, false, false, false, false]);
  assert.equal(isAskedReviewer({ open: { reviewer: { uid: 'u2' } } }, 'u2'), true);
  assert.equal(isAskedReviewer({ open: { reviewer: { uid: 'u2' } } }, 'u1'), false);
  assert.equal(isAskedReviewer({ open: null }, 'u2'), false);
  assert.equal(isAskedReviewer({ open: { reviewer: { uid: 'u2' } } }, undefined), false);
});

test('every refusal code the Worker sends has its own sentence, and none shows the error text', () => {
  const skills = read('cloudflare-worker/src/routes/admin_hq_skills.ts') + read('cloudflare-worker/src/services/agents/skillPublish.ts')
    + read('cloudflare-worker/src/services/agents/skillLifecycle.ts');
  const codes = new Set([...skills.matchAll(/say\(c, \d+, '([a-z_]+)'/g), ...skills.matchAll(/code: '([a-z_]+)'/g), ...skills.matchAll(/code: '([a-z_]+)' \| '([a-z_]+)'/g)].map((m) => m[1]));
  for (const c of ['golden_cases_failing', 'needs_approval', 'tool_not_read_only']) codes.add(c);
  // Codes that only a campaign or the library seed can send are not this page's.
  const notHere = new Set(['campaign_not_found', 'campaign_busy', 'campaign_cancelled', 'campaign_complete', 'models_fixed', 'models_unavailable', 'not_published', 'check_failed', 'unreadable', 'ok', 'case_invalid_x']);
  for (const c of codes) if (!notHere.has(c)) assert.ok(SKILL_REFUSALS[c], `skill refusal code ${c} has no sentence`);
  const pol = read('cloudflare-worker/src/services/agents/aiPolicy.ts') + read('cloudflare-worker/src/routes/admin_ai_agents_policy.ts');
  for (const m of pol.matchAll(/code: '([a-z_]+)'/g)) assert.ok(POLICY_REFUSALS[m[1]], `policy refusal code ${m[1]} has no sentence`);
  assert.ok(POLICY_REFUSALS.invalid_halt, 'the engine halt’s refusal');

  assert.equal(skillRefusal(refused(403, 'not_reviewer')), SKILL_REFUSALS.not_reviewer);
  assert.match(skillRefusal(refused(409, 'golden_cases_failing', { pass: 7, total: 10 })), /7 of 10/);
  assert.match(skillRefusal(refused(400, 'tool_not_read_only', { tool: 'stripe.refund' })), /stripe\.refund/);
  assert.equal(skillRefusal(refused(500, 'brand_new_code', { message: 'The Worker’s own sentence.' })), 'The Worker’s own sentence.');
  assert.equal(skillRefusal(Object.assign(new Error('RAW socket hang up'), {})), 'That change was not saved.');
  assert.equal(policyRefusal(refused(400, 'invalid_cap')), POLICY_REFUSALS.invalid_cap);
  assert.equal(policyRefusal(new Error('RAW')), 'The change could not be saved. Read the current policy before trying again.');
  for (const t of [SKILL_REFUSALS, POLICY_REFUSALS]) {
    for (const [k, v] of Object.entries(t)) assert.doesNotMatch(typeof v === 'function' ? v({}) : v, /RAW|e\.message|undefined/, k);
  }
});

test('a bulk item reads as done, or as its refusal’s own sentence', () => {
  const nameOf = (u) => ({ a: 'Investor update', b: 'Cap table brief' }[u]);
  assert.equal(bulkLine('publish', { uid: 'a', ok: true, version: 3 }, nameOf), 'Investor update: published as v3.');
  assert.equal(bulkLine('retire', { uid: 'a', ok: true, pinned_agents: 2 }, nameOf), 'Investor update: retired; 2 pinned agents moved.');
  assert.equal(bulkLine('evals', { uid: 'a', ok: true, pass: 9, total: 10 }, nameOf), 'Investor update: evals ran, 9 of 10 passed.');
  assert.equal(bulkLine('publish', { uid: 'b', ok: false, code: 'needs_approval' }, nameOf), `Cap table brief: ${SKILL_REFUSALS.needs_approval}`);
  assert.equal(bulkLine('publish', { uid: 'b', ok: false, code: 'x_new', message: 'Own words.' }, nameOf), 'Cap table brief: Own words.');
});

test('a golden case is a form and the Worker’s body; a changed case is a new one; an email is refused', () => {
  const saved = { uid: 'c1', name: 'Seed round', input: { records: { 'stripe.read': { mrr: 12000 } } }, expect: { output: 'draft', must_include: ['MRR'], must_say_not_recorded: ['churn'], must_not_include: [] } };
  const f = caseToForm(saved);
  assert.equal(f.must_include, 'MRR');
  const same = formToCase(f);
  assert.equal(same.ok, true);
  assert.equal(same.value.uid, 'c1', 'an unchanged case keeps its uid, so it keeps its results');
  assert.deepEqual(same.value.expect, saved.expect);
  const changed = formToCase({ ...f, must_include: 'MRR\nARR' });
  assert.equal('uid' in changed.value, false, 'a changed case is saved as a new one');
  assert.deepEqual(changed.value.expect.must_include, ['MRR', 'ARR']);
  assert.equal(formToCase({ ...f, records: '{' }).field, 'records');
  assert.equal(formToCase({ ...f, records: '{}' }).field, 'records');
  assert.equal(formToCase({ ...f, name: '  ' }).field, 'name');
  assert.equal(formToCase({ ...f, must_include: '', must_say_not_recorded: '', must_not_include: '' }).field, 'must_include');
  assert.match(formToCase({ ...f, records: '{"a": "sue@example.com"}' }).problem, /email/);
  assert.equal(formToCase(blankCase()).ok, false);
  assert.equal(casesPayload([f], 'short').ok, false, 'a reason of 10 characters or more');
  const p = casesPayload([f, { ...f, uid: null, saved: null, name: 'Second' }], REASON);
  assert.equal(p.ok, true);
  assert.equal(p.cases.length, 2);
  assert.equal(casesPayload(Array.from({ length: 21 }, () => f), REASON).ok, false);
  assert.equal(casesPayload([{ ...f, name: '' }], REASON).index, 0);
});

test('the diff reads as changed fields and steps; nothing run reads "Not recorded", never 0 of 0', () => {
  const d = diffRows({ frontmatter: [{ field: 'output_kind', from: 'draft', to: 'brief' }], steps: [{ op: 'keep', text: 'Read' }, { op: 'add', text: 'List the asks' }, { op: 'remove', text: 'Guess' }] });
  assert.equal(d.changed, true);
  assert.deepEqual(d.fields, [{ kind: 'field', label: 'output kind', from: 'draft', to: 'brief' }]);
  assert.deepEqual(d.steps.map((s) => s.kind), ['kept', 'added', 'removed']);
  assert.equal(diffRows({ frontmatter: [], steps: [{ op: 'keep', text: 'Read' }] }).changed, false);
  assert.deepEqual(diffChoices([{ version: 2 }, { version: 1 }]), ['v2', 'v1', 'draft']);
  assert.equal(evalLine({ total: 0, pass: 0 }), NOT_RECORDED);
  assert.equal(evalLine(null), NOT_RECORDED);
  assert.equal(evalLine({ total: 10, pass: 9, meets_bar: true }), '9 of 10 passed, at or above the bar');
  assert.equal(evalLine({ total: 10, pass: 3, meets_bar: false }), '3 of 10 passed, below the bar');
});

test('caps are dollars on screen and micro-dollars on the wire; blank clears, never 0', () => {
  assert.deepEqual(usdToMicro('12.5'), { ok: true, value: 12_500_000 });
  assert.deepEqual(usdToMicro('$250'), { ok: true, value: 250_000_000 });
  assert.deepEqual(usdToMicro(''), { ok: true, value: null });
  for (const bad of ['0', '-1', 'ten', '1.2345678', '1e3']) assert.equal(usdToMicro(bad).ok, false, bad);
  assert.equal(microToUsd(null), '');
  assert.equal(microToUsd(0), '', 'a stored zero is not shown as a cap');
  assert.equal(microToUsd(12_500_000), '12.5');
  const p = capsPayload({ platform_budget: '1000', default_team_cap: '50', max_team_cap: '200', per_run_ceiling: '' }, REASON);
  assert.deepEqual(p.caps, { platform_budget_microusd: 1_000_000_000, default_team_cap_microusd: 50_000_000, max_team_cap_microusd: 200_000_000, per_run_ceiling_microusd: null });
  assert.equal(capsPayload({ platform_budget: 'x' }, REASON).field, 'platform_budget');
  assert.equal(capsPayload({ default_team_cap: '300', max_team_cap: '200' }, REASON).field, 'default_team_cap');
  assert.equal(capsPayload({ platform_budget: '1' }, 'short').ok, false);
  assert.deepEqual(capsForm({ platform_budget_microusd: null, max_team_cap_microusd: 5_000_000 }), { platform_budget: '', default_team_cap: '', max_team_cap: '5', per_run_ceiling: '' });
});

test('models per area: up to three suggestions, the default among them; the other areas stay as they are', () => {
  const policy = { design: { suggested: ['m1', 'm2'], default: 'm1' }, legal_compliance: { suggested: ['m3'], default: 'm3' } };
  assert.deepEqual(areaForm(policy, 'design'), { suggested: ['m1', 'm2'], default: 'm1' });
  assert.deepEqual(areaForm(policy, 'product'), { suggested: [], default: '' });
  const ok = areasPayload(policy, 'design', { suggested: ['m2', 'm1', 'm2'], default: 'm2' });
  assert.deepEqual(ok.areas.design, { suggested: ['m2', 'm1'], default: 'm2' });
  assert.deepEqual(ok.areas.legal_compliance, policy.legal_compliance);
  assert.equal(areasPayload(policy, 'design', { suggested: [], default: '' }).ok, false);
  assert.equal(areasPayload(policy, 'design', { suggested: ['m1'], default: 'm9' }).ok, false);
  assert.equal(areasPayload(policy, 'design', { suggested: ['a', 'b', 'c', 'd'], default: 'a' }).ok, false);
  const opts = modelOptions([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], [{ model: 'b' }], ['b', 'z']);
  assert.deepEqual(opts.map((o) => [o.id, o.locked]), [['a', false], ['b', true], ['z', false]], 'a locked model already chosen stays visible, marked');
});

test('read tools and the engine halt', () => {
  assert.deepEqual(withTool(['a.read_x'], ' HubSpot.Read_Contacts '), { ok: true, tools: ['a.read_x', 'hubspot.read_contacts'] });
  assert.equal(withTool(['a.read_x'], 'a.read_x').ok, false);
  assert.equal(withTool([], 'nodots').ok, false);
  assert.equal(withTool(Array.from({ length: 50 }, (_, i) => `c.t${i}`), 'c.new').ok, false);
  assert.deepEqual(withoutTool(['a.b', 'c.d'], 'a.b'), ['c.d']);
  assert.equal(haltLine(null), NOT_RECORDED);
  assert.equal(haltLine({}), NOT_RECORDED, 'an unknown halt is not "agents may run"');
  assert.equal(haltLine({ halted: false }), 'Agents may run.');
  assert.equal(haltLine({ halted: true, reason: 'Provider incident', by: { name: 'Sue Super' }, at: '2026-11-07T10:00:00Z' }), 'Every agent is halted by Sue Super on 2026-11-07: Provider incident.');
  assert.equal(haltReasonFits('x'.repeat(65)), false);
  assert.equal(haltReasonFits('short'), false);
  assert.equal(haltReasonFits('Provider incident'), true);
});

// ─── SA3 · bulk actions ─────────────────────────────────────────────────────

const LIB = [
  { uid: 's1', name: 'Investor update', status: 'draft', version: null, agents: 0, golden: { pass: 9, total: 10 }, last_eval: null, tools: [], area: { slug: 'capital_network' }, level: 'Working' },
  { uid: 's2', name: 'Cap table brief', status: 'draft', version: null, agents: null, tools: [], area: { slug: 'capital_network' }, level: 'Working' },
  { uid: 's3', name: 'Founder intro', status: 'published', version: 2, agents: 4, tools: [], area: { slug: 'capital_network' }, level: 'Proficient' },
].map(skillRow);

test('SA3: Publish… sends the ticked skills with a reason, and each skill is done or refused on its own', async () => {
  const calls = [];
  const restore = stub(skillsApi, {
    bulk: async (action, uids, opts) => { calls.push([action, uids, opts]); return { action, results: [{ uid: 's1', ok: true, version: 1 }, { uid: 's2', ok: false, code: 'needs_approval', message: 'x' }] }; },
  });
  const done = [];
  const ui = await mountContracts(h(BulkBar, { rows: LIB, selected: new Set(['s1', 's2']), onDone: () => done.push(1) }));
  try {
    await press(ui, 'ai-agents-bulk-publish');
    await type(ui, 'skill-reason-bulk', 'short');
    await assert.rejects(press(ui, 'ai-agents-bulk-go'), /disabled/, 'a short reason does not arm it');
    await type(ui, 'skill-reason-bulk', REASON);
    await press(ui, 'ai-agents-bulk-go');
    assert.deepEqual(calls, [['publish', ['s1', 's2'], { reason: REASON, replacementUid: undefined }]]);
    assert.match(ui.text(), /Investor update: published as v1\./);
    assert.match(ui.text(), new RegExp(`Cap table brief: ${SKILL_REFUSALS.needs_approval.slice(0, 30)}`));
    assert.equal(done.length, 1, 'the library is read again');
  } finally { await ui.unmount(); restore(); }
});

test('SA3: Re-run evals sends the action; Retire… needs a replacement from the other published skills; a refused write shows its sentence', async () => {
  const calls = [];
  let refuse = true;
  const restore = stub(skillsApi, {
    bulk: async (action, uids, opts) => { calls.push([action, uids, opts]); if (refuse) throw refused(400, 'reason_required'); return { action, results: [{ uid: 's1', ok: true, pinned_agents: 3 }] }; },
  });
  const ui = await mountContracts(h(BulkBar, { rows: LIB, selected: new Set(['s1']) }));
  try {
    await press(ui, 'ai-agents-bulk-evals');
    await type(ui, 'skill-reason-bulk', REASON);
    await press(ui, 'ai-agents-bulk-go');
    assert.equal(calls[0][0], 'evals');
    assert.match(ui.text(), new RegExp(SKILL_REFUSALS.reason_required.slice(0, 25)));
    assert.doesNotMatch(ui.text(), /RAW/);
    await press(ui, 'ai-agents-bulk-retire');
    await type(ui, 'skill-reason-bulk', REASON);
    await assert.rejects(press(ui, 'ai-agents-bulk-go'), /disabled/, 'Retire needs a replacement');
    assert.match(txt(find(ui, 'skill-replacement')[0]), /Founder intro/, 'the other published skills are the choices');
    assert.doesNotMatch(txt(find(ui, 'skill-replacement')[0]), /Investor update/, 'a skill is not its own replacement');
    await type(ui, 'skill-replacement', 's3');
    refuse = false;
    await press(ui, 'ai-agents-bulk-go');
    assert.deepEqual(calls[1], ['retire', ['s1'], { reason: REASON, replacementUid: 's3' }]);
    assert.match(ui.text(), /Investor update: retired; 3 pinned agents moved\./);
  } finally { await ui.unmount(); restore(); }
});

test('SA3: nothing ticked, nothing to act on; the library no longer says the lifecycle "arrives with #4160"', async () => {
  const ui = await mountContracts(h(BulkBar, { rows: LIB, selected: new Set() }));
  try {
    for (const k of ['publish', 'evals', 'retire']) assert.equal(ui.props(find(ui, `ai-agents-bulk-${k}`)[0]).disabled, true, k);
    assert.match(ui.text(), /Tick skills to act on them\./);
  } finally { await ui.unmount(); }
  const page = read('frontend/src/pages/hq/aiAgents/HqAiAgentsPage.jsx');
  assert.doesNotMatch(page, /arrives with #4160|Not switched on yet|not connected on this page yet/);
});

// ─── SA4 · one skill ────────────────────────────────────────────────────────

const detail = ({ skill: skillOver, ...over } = {}) => ({
  skill: { uid: 'sk1', name: 'Investor update', purpose: 'Draft the update', steps: ['Read'], tools: [], output_kind: 'draft', status: 'draft', version: null, agents: 2, radar: { axes: [] }, area: null, level: null, ...skillOver },
  reviewers: [{ uid: 'u-rev', name: 'Rex Reviewer' }, { uid: 'u-third', name: 'Tia Third' }],
  review: { open: null, approved: false, history: [] },
  cases: [{ uid: 'c1', name: 'Seed round', input: { records: { 'stripe.read': { mrr: 12000 } } }, expect: { output: 'draft', must_include: ['MRR'], must_say_not_recorded: [], must_not_include: [] } }],
  evals: { cases: [], models: [], pass: 0, total: 0, meets_bar: false, last_run: null, pass_bar: { pass: 9, of: 10 } },
  versions: [{ version: 2, published_at: '2026-11-01', by: null }, { version: 1, published_at: '2026-10-01', by: null }],
  retired: null,
  ...over,
});
async function editor(data, fns, viewer = { uid: 'u-sue', name: 'Sue' }) {
  const restore = stub(skillsApi, { get: async () => data, list: async () => ({ skills: [{ uid: 'sk9', name: 'Founder intro', status: 'published' }, { uid: 'sk1', name: 'Investor update', status: 'draft' }] }), ...fns });
  const ui = await mountContracts(h(Editor, { view: { skill: 'sk1' }, viewerUid: viewer.uid }), '/hq/ai-agents/skills/sk1/edit');
  await settle(ui);
  return { ui, restore };
}

test('SA4: ask for a review names a reviewer from the list, never an email', async () => {
  const calls = [];
  const { ui, restore } = await editor(detail(), { requestReview: async (...a) => { calls.push(a); return {}; } });
  try {
    assert.match(ui.text(), /Rex Reviewer/);
    assert.doesNotMatch(ui.text(), /@/);
    await assert.rejects(press(ui, 'skill-ask-review'), /disabled/, 'nobody chosen');
    await type(ui, 'skill-reviewer', 'u-rev');
    await press(ui, 'skill-ask-review');
    assert.deepEqual(calls, [['sk1', 'u-rev']]);
  } finally { await ui.unmount(); restore(); }
  const down = await editor(detail({ reviewers: null }), {});
  try { assert.match(down.ui.text(), /could not be read/); } finally { await down.ui.unmount(); down.restore(); }
});

test('SA4: the asked reviewer approves, or asks for changes with a comment; others see who decides', async () => {
  const open = { status: 'requested', current: true, comment: null, reviewer: { uid: 'u-rev', name: 'Rex Reviewer' }, requested_by: { uid: 'u-sue', name: 'Sue' } };
  const calls = [];
  const data = detail({ skill: { status: 'in_review' }, review: { open, approved: false, history: [] } });
  const fns = { approve: async (...a) => { calls.push(['approve', ...a]); return {}; }, requestChanges: async (...a) => { calls.push(['changes', ...a]); return {}; } };
  const { ui, restore } = await editor(data, fns, { uid: 'u-rev', name: 'Rex' });
  try {
    await type(ui, 'skill-comment', 'Looks right.');
    await press(ui, 'skill-approve');
    await type(ui, 'skill-comment', 'Tighten the second step.');
    await press(ui, 'skill-request-changes');
    assert.deepEqual(calls, [['approve', 'sk1', 'Looks right.'], ['changes', 'sk1', 'Tighten the second step.']]);
  } finally { await ui.unmount(); restore(); }
  const other = await editor(data, fns, { uid: 'u-sue', name: 'Sue' });
  try {
    assert.equal(find(other.ui, 'skill-approve').length, 0);
    assert.match(other.ui.text(), /Only Rex Reviewer decides this review\./);
  } finally { await other.ui.unmount(); other.restore(); }
  const refusing = await editor(data, { approve: async () => { throw refused(403, 'self_approval'); } }, { uid: 'u-rev', name: 'Rex' });
  try {
    await press(refusing.ui, 'skill-approve');
    assert.match(refusing.ui.text(), /author cannot approve it/);
    assert.doesNotMatch(refusing.ui.text(), /RAW/);
  } finally { await refusing.ui.unmount(); refusing.restore(); }
});

test('SA4: golden cases save with a reason; a bad case is told before sending; a refusal shows its sentence', async () => {
  const calls = [];
  const { ui, restore } = await editor(detail(), { setCases: async (...a) => { calls.push(a); if (calls.length === 2) throw refused(400, 'case_has_email'); return {}; } });
  try {
    await type(ui, 'skill-reason-cases', REASON);
    await press(ui, 'skill-save-cases');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'sk1');
    assert.equal(calls[0][1][0].uid, 'c1', 'the unchanged case keeps its uid');
    assert.equal(calls[0][2], REASON);
    await press(ui, 'skill-add-case');
    await press(ui, 'skill-save-cases');
    assert.equal(calls.length, 1, 'an empty case is refused before it is sent');
    assert.ok(find(ui, 'skill-case-problem').length >= 1);
  } finally { await ui.unmount(); restore(); }
});

test('SA4: Re-run evals, the diff between versions, and Retire… with a replacement and a reason', async () => {
  const calls = [];
  const { ui, restore } = await editor(detail({ skill: { status: 'published', version: 2 } }), {
    runEvals: async (...a) => { calls.push(['evals', ...a]); return {}; },
    diff: async (uid, o) => { calls.push(['diff', uid, o]); return { from: 'v1', to: 'draft', frontmatter: [], steps: [{ op: 'keep', text: 'Read' }, { op: 'add', text: 'List the asks' }] }; },
    retire: async (...a) => { calls.push(['retire', ...a]); throw refused(422, 'replacement_invalid'); },
  });
  try {
    await press(ui, 'skill-run-evals');
    await type(ui, 'skill-diff-from', 'v1');
    await press(ui, 'skill-diff-go');
    assert.match(ui.text(), /List the asks/);
    await press(ui, 'skill-retire-open');
    await settle(ui);
    await type(ui, 'skill-replacement', 'sk9');
    await type(ui, 'skill-reason-retire', REASON);
    await press(ui, 'skill-retire-go');
    assert.deepEqual(calls, [['evals', 'sk1'], ['diff', 'sk1', { from: 'v1', to: 'draft' }], ['retire', 'sk1', 'sk9', REASON]]);
    assert.match(ui.text(), /replacement must be a different, published Axal skill/);
    assert.doesNotMatch(ui.text(), /RAW/);
  } finally { await ui.unmount(); restore(); }
});

test('SA4: a retired skill offers no action, and the page no longer says editing is not connected', async () => {
  const { ui, restore } = await editor(detail({ skill: { status: 'retired' }, retired: { reason: 'Superseded', pinned_agents: 0, replacement: { uid: 'sk9', name: 'Founder intro' } } }), {});
  try {
    for (const id of ['skill-ask-review', 'skill-run-evals', 'skill-retire-open']) assert.equal(find(ui, id).length, 0, id);
    assert.doesNotMatch(ui.text(), /not connected on this page yet/);
  } finally { await ui.unmount(); restore(); }
});

// ─── SA6 · Policies ─────────────────────────────────────────────────────────

const POLICY = {
  policy: {
    platform_budget_microusd: 500_000_000, default_team_cap_microusd: null, max_team_cap_microusd: 200_000_000, per_run_ceiling_microusd: null,
    area_models: { design: { suggested: ['m1', 'm2'], default: 'm1' } },
    read_tools: ['hubspot.read_contacts'],
    locks: [{ model: 'm3', reason: 'Provider incident', locked_at: '2026-11-01', locked_by: { id: 1, name: 'Sue' } }],
    paused: { on: false },
  },
  guardrails: [],
};
async function policies(fns = {}, engine = {}) {
  const restores = [
    stub(policyApi, { policy: async () => POLICY, ...fns }),
    stub(teamAgentsApi, { roles: async () => ({ models: [{ id: 'm1', label: 'Model one' }, { id: 'm2', label: 'Model two' }, { id: 'm3', label: 'Model three' }, { id: 'm4', label: 'Model four' }] }) }),
    stub(agentEngineApi, { haltState: async () => ({ halted: false, reason: null, by: null, at: null }), setHalt: async () => ({}), ...engine }),
  ];
  const ui = await mountContracts(h(Policies));
  await settle(ui);
  return { ui, restore: () => restores.forEach((r) => r()) };
}

test('SA6: models by area are saved with a reason, the other areas unchanged', async () => {
  const calls = [];
  const { ui, restore } = await policies({ setModels: async (...a) => { calls.push(a); return {}; } });
  try {
    await type(ui, 'policy-area', 'design');
    await type(ui, 'policy-suggested-2', 'm4');
    await type(ui, 'policy-models-reason', REASON);
    await press(ui, 'policy-models-save');
    assert.deepEqual(calls, [[{ design: { suggested: ['m1', 'm2', 'm4'], default: 'm1' } }, REASON]]);
  } finally { await ui.unmount(); restore(); }
});

test('SA6: a model is locked off, or unlocked, with a reason; a model already locked is not offered', async () => {
  const calls = [];
  const { ui, restore } = await policies({
    lockModel: async (...a) => { calls.push(['lock', ...a]); return {}; },
    unlockModel: async (...a) => { calls.push(['unlock', ...a]); throw refused(404, 'not_locked'); },
  });
  try {
    const offered = txt(find(ui, 'policy-lock-model')[0]);
    assert.doesNotMatch(offered, /Model three/);
    await type(ui, 'policy-lock-model', 'm4');
    await press(ui, 'policy-lock');
    assert.deepEqual(calls, [], 'no reason, nothing is sent');
    assert.match(ui.text(), /Say why, in 10 to 500 characters/);
    await type(ui, 'policy-locks-reason', REASON);
    await press(ui, 'policy-lock');
    await type(ui, 'policy-locks-reason', REASON);
    await press(ui, 'policy-unlock');
    assert.deepEqual(calls, [['lock', 'm4', REASON], ['unlock', 'm3', REASON]]);
    assert.match(ui.text(), /That model is not locked\./);
    assert.doesNotMatch(ui.text(), /RAW/);
  } finally { await ui.unmount(); restore(); }
});

test('SA6: caps are sent in micro-dollars with a reason, and each refusal code shows its own sentence', async () => {
  const calls = [];
  let next = null;
  const { ui, restore } = await policies({ setCaps: async (...a) => { calls.push(a); if (next) throw next; return {}; } });
  try {
    await type(ui, 'policy-cap-platform_budget', '750');
    await type(ui, 'policy-caps-reason', REASON);
    await press(ui, 'policy-caps-save');
    assert.deepEqual(calls[0], [{ platform_budget_microusd: 750_000_000, default_team_cap_microusd: null, max_team_cap_microusd: 200_000_000, per_run_ceiling_microusd: null }, REASON]);
    for (const [code, expected] of [['invalid_cap', POLICY_REFUSALS.invalid_cap], ['default_over_max', POLICY_REFUSALS.default_over_max], ['reason_required', POLICY_REFUSALS.reason_required]]) {
      next = refused(400, code);
      await type(ui, 'policy-caps-reason', REASON);
      await type(ui, 'policy-cap-platform_budget', '751');
      await press(ui, 'policy-caps-save');
      assert.equal(txt(find(ui, 'policy-caps-error')[0]), expected, code);
    }
    assert.doesNotMatch(ui.text(), /RAW/);
    await type(ui, 'policy-cap-platform_budget', 'ten');
    await type(ui, 'policy-caps-reason', REASON);
    const before = calls.length;
    await press(ui, 'policy-caps-save');
    assert.equal(calls.length, before, 'a cap that is not a dollar amount is told before sending');
    assert.match(ui.text(), /Platform monthly budget is a dollar amount/);
  } finally { await ui.unmount(); restore(); }
});

test('SA6: the read tools are a checklist with an add field; a write tool is refused in the Worker’s words', async () => {
  const calls = [];
  const { ui, restore } = await policies({ setReadTools: async (...a) => { calls.push(a); if (calls.length === 2) throw refused(422, 'write_tool', { message: 'Skills may only request read tools. stripe.refund is not a read.' }); return {}; } });
  try {
    await type(ui, 'policy-tool-new', 'Mercury.Read_Balances');
    await press(ui, 'policy-tool-add');
    await type(ui, 'policy-tools-reason', REASON);
    await press(ui, 'policy-tools-save');
    assert.deepEqual(calls[0], [['hubspot.read_contacts', 'mercury.read_balances'], REASON]);
    await type(ui, 'policy-tool-new', 'stripe.refund');
    await press(ui, 'policy-tool-add');
    await type(ui, 'policy-tools-reason', REASON);
    await press(ui, 'policy-tools-save');
    assert.match(ui.text(), /stripe\.refund is not a read/);
    assert.doesNotMatch(ui.text(), /RAW/);
  } finally { await ui.unmount(); restore(); }
});

test('SA6b: the pause’s refusal shows its sentence, not a fixed one', async () => {
  const { ui, restore } = await policies({ pauseAll: async () => { throw refused(409, 'already_paused'); } });
  try {
    await ui.fill('Reason to pause or resume', 'Scheduled maintenance');
    await ui.fill('Type PAUSE', 'PAUSE');
    await ui.click('Pause all AI agents');
    await settle(ui);
    assert.equal(txt(find(ui, 'policy-pause-error')[0]).startsWith(POLICY_REFUSALS.already_paused), true);
  } finally { await ui.unmount(); restore(); }
});

test('the engine halt is shown on Policies and set or cleared with a reason', async () => {
  const calls = [];
  let state = { halted: false, reason: null, by: null, at: null };
  const { ui, restore } = await policies({}, {
    haltState: async () => state,
    setHalt: async (a) => { calls.push(a); state = { halted: a.halted, reason: a.reason, by: { uid: 'u1', name: 'Sue Super' }, at: '2026-11-07T10:00:00Z' }; return state; },
  });
  try {
    assert.match(txt(find(ui, 'policy-halt-state')[0]), /Agents may run\./);
    await type(ui, 'policy-halt-reason', 'short');
    await assert.rejects(press(ui, 'policy-halt-go'), /disabled/);
    await type(ui, 'policy-halt-reason', 'Provider incident');
    await press(ui, 'policy-halt-go');
    assert.deepEqual(calls, [{ halted: true, reason: 'Provider incident' }]);
    assert.match(txt(find(ui, 'policy-halt-state')[0]), /Every agent is halted by Sue Super on 2026-11-07: Provider incident\./);
    await type(ui, 'policy-halt-reason', 'Incident is over');
    await press(ui, 'policy-halt-go');
    assert.deepEqual(calls[1], { halted: false, reason: 'Incident is over' });
  } finally { await ui.unmount(); restore(); }
});

test('an unread halt is not "agents may run", and a halt refusal shows its sentence', async () => {
  const down = await policies({}, { haltState: async () => { throw Object.assign(new Error('RAW'), {}); } });
  try {
    assert.match(txt(find(down.ui, 'policy-halt-unreadable')[0]), /not the same as agents being able to run/);
    assert.equal(find(down.ui, 'policy-halt-state').length, 0);
    assert.doesNotMatch(down.ui.text(), /RAW/);
  } finally { await down.ui.unmount(); down.restore(); }
  const bad = await policies({}, { setHalt: async () => { throw refused(400, 'invalid_halt'); } });
  try {
    await type(bad.ui, 'policy-halt-reason', 'Provider incident');
    await press(bad.ui, 'policy-halt-go');
    assert.match(txt(find(bad.ui, 'policy-halt-error')[0]), /Say halted or cleared/);
  } finally { await bad.ui.unmount(); bad.restore(); }
});

test('Policies draws no control without a client method that has a mounted Worker route', () => {
  const src = read('frontend/src/pages/hq/aiAgents/PolicyControls.jsx');
  const methods = [...src.matchAll(/\bapi\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(methods)].sort(), ['lockModel', 'setCaps', 'setModels', 'setReadTools', 'unlockModel']);
  const routes = read('cloudflare-worker/src/routes/admin_ai_agents_policy.ts');
  for (const r of [/r\.put\('\/models'/, /r\.post\('\/locks'/, /r\.delete\('\/locks\/:model'/, /r\.put\('\/caps'/, /r\.put\('\/tools'/]) assert.match(routes, r);
  assert.match(src, /agentEngineApi\.haltState\(\)/);
  assert.match(src, /agentEngineApi\.setHalt\(/);
  const lifecycle = read('frontend/src/pages/hq/aiAgents/SkillLifecycle.jsx');
  for (const m of ['requestReview', 'approve', 'requestChanges', 'setCases', 'runEvals', 'retire', 'bulk', 'diff']) assert.match(lifecycle, new RegExp(`adminHqSkillsApi\\.${m}\\(`), m);
});
