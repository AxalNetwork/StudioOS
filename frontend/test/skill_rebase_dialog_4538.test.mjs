// #4538 (SK-20, D4538 part 5) — Compare with Axal › Rebase onto Axal vN: Keep mine / Take Axal vN / Edit by hand
// per conflicting part, the other parts' result lines, and Create draft through the mounted
// `POST /api/teams/skills/:uid/rebase` (`teamAgentsApi.rebaseSkill`). The page is mounted on the Worker's own answers,
// stubbed at fetch. Every company, skill, step, tool, tag and hash below is an invented fixture.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skill_rebase_dialog_4538.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import SkillComparePage from '../src/pages/team/SkillComparePage.jsx';
import {
  actionsFor, compareHref, compareView, handValue, newToolsOnly, rebaseBody, rebasePlan, rebaseRefusal, toolsOutsideNewest, unresolved,
} from '../src/pages/team/extensionCompareModel.js';
import { fromWorkerSkill } from '../src/pages/team/skillsModel.js';

const h = React.createElement;

// ---------------------------------------------------------------- fixtures (invented)

const uid = (n) => String(n).padStart(32, 'c');
const HQ = uid(1);
const EXT = uid(2);
const CO = 'cofix04';
const HASH = 'e'.repeat(64);
const S3 = ['Define the market and the buyer.', 'Estimate buyers from public sources.', 'Estimate spend per buyer.', 'State every assumption.'];
const SM = [S3[0], 'List buyer teams by region from the CRM.', S3[2], S3[3], 'Flag any figure older than 24 months.'];
const S5 = [S3[0], 'Estimate buyers from public sources and filings.', S3[2], 'Cross-check with a bottom-up count.', S3[3]];
const tag = (label, level) => ({ slug: label.toLowerCase().replace(/\W+/g, '-'), label, category: 'gtm_sales', level });
const parts = (o) => ({
  name: '[Rebase fixture]', purpose: 'Sizes a market.', steps: S3, tools: ['crm.read', 'web.search', 'metrics.read'], output_kind: 'brief', output_label: 'A brief',
  tags: [tag('Market research', 'proficient')], roles: [{ key: 'analyst', label: 'Analyst' }], ...o,
});
const V3 = parts({});
const MINE = parts({ name: '[Rebase fixture · ours]', steps: SM, tools: ['crm.read', 'metrics.read'], tags: [tag('Market research', 'proficient'), tag('Procurement', 'working')] });
const V5 = parts({ purpose: 'Sizes a market and names each source.', steps: S5, tools: ['crm.read', 'web.search', 'metrics.read', 'filings.read'] });
const FIELDS = [
  { field: 'name', company_changed: true, base_changed: false, conflict: false },
  { field: 'purpose', company_changed: false, base_changed: true, conflict: false },
  { field: 'steps', company_changed: true, base_changed: true, conflict: true },
  { field: 'tools', company_changed: true, base_changed: true, conflict: true },
  { field: 'output_kind', company_changed: false, base_changed: false, conflict: false },
  { field: 'tags', company_changed: true, base_changed: false, conflict: false },
  { field: 'roles', company_changed: false, base_changed: false, conflict: false },
];
const lineage = (over = {}) => ({
  based_on: { skill_uid: HQ, version: 3 },
  reason: 'Our buyers are procurement teams.',
  versions: [{ version: 2, based_on_version: 3 }],
  base: { uid: HQ, name: '[Rebase fixture]', status: 'published', current_version: 5, retired: false, suspended: false, version: { version: 3, ...V3 }, newest: { version: 5, ...V5 } },
  base_update_available: true,
  company: { side: 'version', version: 2 },
  fields: FIELDS,
  ...over,
});
const extCard = (over = {}) => ({
  uid: EXT, scope: 'company', slug: 'sizing-ours', status: 'published', version: 2, author: '[Fixture Co]', ...MINE,
  used_by: 1, updated_at: '2026-11-14T00:00:00Z', can_write: true, based_on: { skill_uid: HQ, version: 3 }, draft_hash: HASH, ...over,
});

// ---------------------------------------------------------------- the model

test('the plan: conflicts need a choice; the other parts are taken, kept or unchanged, as the Worker merges them', () => {
  const view = compareView(fromWorkerSkill(extCard()), lineage());
  const plan = rebasePlan(view);
  assert.equal(plan.version, 5);
  assert.deepEqual(plan.conflicts, [{ field: 'steps', label: 'Steps', editable: true }, { field: 'tools', label: 'Tools', editable: true }]);
  assert.deepEqual(plan.taken, ['Purpose'], 'changed only by Axal: taken from Axal v5');
  assert.deepEqual(plan.kept, ['Name', 'Skill tags'], 'changed by the company: kept');
  assert.deepEqual(plan.unchanged, ['Output', 'Roles']);
  // The same change on both sides is no conflict and stays (the Worker keeps it).
  const same = rebasePlan(compareView(fromWorkerSkill(extCard()), lineage({ fields: FIELDS.map((f) => (f.field === 'roles' ? { ...f, company_changed: true, base_changed: true } : f)) })));
  assert.ok(same.kept.includes('Roles'));
  assert.ok(!same.taken.includes('Roles'), 'a part both sides changed the same way is yours, not "Taken from Axal"');
  // No update, or an unreadable base: nothing to rebase onto.
  assert.equal(rebasePlan(compareView(fromWorkerSkill(extCard()), lineage({ base_update_available: false }))), null);
  assert.equal(rebasePlan(compareView(fromWorkerSkill(extCard()), lineage({ base: null, fields: null }))), null);
  // Output, Skill tags and Roles are kept or taken here, never written by hand.
  const tagsConflict = rebasePlan(compareView(fromWorkerSkill(extCard()), lineage({ fields: FIELDS.map((f) => (f.field === 'tags' ? { ...f, base_changed: true, conflict: true } : f)) })));
  assert.deepEqual(tagsConflict.conflicts.find((c) => c.field === 'tags'), { field: 'tags', label: 'Skill tags', editable: false });
});

test('the body: the exact version shown, the draft hash read, one choice per conflict; edit sends the part\'s draft value', () => {
  const plan = rebasePlan(compareView(fromWorkerSkill(extCard()), lineage()));
  assert.deepEqual(unresolved(plan, {}), ['steps', 'tools']);
  assert.deepEqual(unresolved(plan, { steps: { choice: 'mine' } }), ['tools']);
  const body = rebaseBody({
    version: 5, draftHash: HASH, plan,
    choices: { steps: { choice: 'edit', value: '  One.\n\nTwo.\r\n' }, tools: { choice: 'axal', value: ['ignored'] } },
  });
  assert.deepEqual(body, { version: 5, expected_draft_hash: HASH, resolutions: { steps: { choice: 'edit', value: ['One.', 'Two.'] }, tools: { choice: 'axal' } } });
  assert.deepEqual(rebaseBody({ version: 5, draftHash: HASH, plan, choices: { steps: { choice: 'mine', value: 'x' } } }).resolutions, { steps: { choice: 'mine' } });
  assert.equal(handValue('name', '  Ours \r\n'), 'Ours');
  assert.deepEqual(handValue('tools', ['crm.read']), ['crm.read']);
});

test('tools: what only Axal\'s side carries, and what the draft could not keep', () => {
  const view = compareView(fromWorkerSkill(extCard()), lineage());
  assert.deepEqual(newToolsOnly(view), ['web.search', 'filings.read']);
  assert.deepEqual(toolsOutsideNewest(view, ['crm.read', 'slack.post']), ['slack.post']);
  assert.deepEqual(toolsOutsideNewest(view, ['crm.read']), []);
});

test('refusals: tied to their part, or the dialog with Reload when the page must be read again', () => {
  assert.deepEqual(rebaseRefusal('tool_not_in_base', 'Slack is not a tool of the newer Axal base.', 'tools'), { part: 'tools', text: 'Slack is not a tool of the newer Axal base.', reload: false });
  assert.equal(rebaseRefusal('draft_conflict', 'x').reload, true);
  assert.equal(rebaseRefusal('rebase_conflict', 'x').reload, true);
  assert.equal(rebaseRefusal('base_suspended', 'x').reload, false);
  assert.match(rebaseRefusal('company_archived', 'x').text, /archived/);
  assert.equal(rebaseRefusal('name_missing', 'Give the skill a name.', 'name').part, 'name');
  assert.equal(rebaseRefusal('weird', null, 'nonsense').part, null, 'an unknown part is the dialog\'s');
  assert.match(rebaseRefusal('weird', null).text, /Nothing was saved/);
});

test('who may rebase: editors with an update and the draft hash; never members, HQ, a retired or suspended base', () => {
  const v = (lin) => compareView(fromWorkerSkill(extCard()), lin);
  assert.deepEqual(actionsFor(v(lineage()), fromWorkerSkill(extCard())).rebase, { disabled: false, why: null });
  assert.equal(actionsFor(v(lineage()), fromWorkerSkill(extCard({ can_write: false }))).rebase, null);
  assert.equal(actionsFor(v(lineage()), fromWorkerSkill(extCard({ can_write: false })), { hqAdmin: true }).rebase, null);
  assert.equal(actionsFor(v(lineage({ base_update_available: false })), fromWorkerSkill(extCard())).rebase, null);
  assert.equal(actionsFor(v(lineage({ base: { ...lineage().base, retired: true } })), fromWorkerSkill(extCard())).rebase, null);
  const sus = actionsFor(v(lineage({ base: { ...lineage().base, suspended: true } })), fromWorkerSkill(extCard())).rebase;
  assert.equal(sus.disabled, true);
  assert.match(sus.why, /paused v5/);
  const noHash = actionsFor(v(lineage()), fromWorkerSkill(extCard({ draft_hash: null }))).rebase;
  assert.equal(noHash.disabled, true);
  assert.match(noHash.why, /Reload/);
  assert.equal(fromWorkerSkill(extCard({ draft_hash: 'not-a-hash' })).draft_hash, null, 'a malformed hash is not sent');
});

// ---------------------------------------------------------------- the page

function stubFetch(routes) {
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const key = `${(init.method || 'GET').toUpperCase()} ${url.pathname}`;
    seen.push({ key, body: init.body ? JSON.parse(init.body) : null });
    const hit = routes[key];
    const [status, body] = typeof hit === 'function' ? hit() : hit || [500, { error: 'boom' }];
    return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { seen, restore: () => { globalThis.fetch = previous; } };
}
const settle = async (m) => { for (let i = 0; i < 6; i += 1) await m.flush(); };
const LIB = { hq: [], company: { uid: CO, name: '[Fixture Co]', skills: [], can_write: true }, can_write_hq: false };
const ROUTES = ({ ext = extCard(), lin = lineage() } = {}) => ({
  [`GET /api/teams/skills/${EXT}`]: [200, { skill: ext, versions: [], agents: [] }],
  [`GET /api/teams/skills/${EXT}/base`]: [200, { lineage: lin }],
  'GET /api/teams/skills': [200, LIB],
});
async function mountPage(routes) {
  const net = stubFetch(routes);
  const el = h(Routes, null,
    h(Route, { path: '/account/companies/:uid/settings/team/skills/:skillUid/base', element: h(SkillComparePage) }),
    h(Route, { path: '/account/companies/:uid/settings/team', element: h('p', { 'data-testid': 'team-page' }, 'Team page') }));
  const m = await mountContracts(el, compareHref(CO, EXT));
  await settle(m);
  const byTestId = (id) => m.nodes().filter((n) => m.props(n)?.['data-testid'] === id);
  const fire = async (id, prop = 'onClick', arg = { stopPropagation() {} }) => {
    const [node] = byTestId(id);
    assert.ok(node, `missing ${id}`);
    await act(async () => { m.props(node)[prop](arg); });
    await settle(m);
  };
  return { ...m, net, byTestId, fire, async done() { await m.unmount(); net.restore(); } };
}
const posts = (m) => m.net.seen.filter((s) => s.key.startsWith('POST') || s.key.startsWith('PUT') || s.key.startsWith('PATCH'));

test('an editor opens the rebase sheet: each conflict offers Keep mine, Take Axal v5 and Edit by hand; the rest reads its result', async () => {
  const m = await mountPage(ROUTES({ ext: extCard({ draft: { ...MINE, purpose: 'An unpublished edit.' } }) }));
  try {
    const [btn] = m.byTestId('compare-rebase');
    assert.equal(m.props(btn)['aria-disabled'], undefined);
    assert.match(m.text(), /Rebase onto v5…/);
    await m.fire('compare-rebase');
    const t = m.text();
    assert.match(t, /Rebase onto Axal v5/);
    assert.match(t, /Makes a new draft from your published v2 and Axal v5/);
    for (const f of ['steps', 'tools']) {
      for (const c of ['mine', 'axal', 'edit']) {
        const [radio] = m.byTestId(`rebase-${f}-${c}`);
        assert.equal(m.props(radio).type, 'radio', 'native radios: arrow keys move within a part, Tab between parts');
        assert.equal(m.props(radio).name, `rebase-${f}`);
        assert.equal(m.props(radio).checked, false, 'nothing is chosen for the person');
      }
    }
    assert.match(t, /Keep mine/);
    assert.match(t, /Take Axal v5/);
    assert.match(t, /Edit by hand/);
    assert.match(t, /Purpose.*Taken from Axal v5/s);
    assert.match(t, /Name, Skill tags.*Kept from yours/s);
    assert.match(t, /Output, Roles.*Unchanged/s);
    assert.match(t, /Only Take Axal v5 or Edit by hand can carry web\.search, filings\.read, new in v5\./);
    assert.match(t, /Creates a new draft on Axal v5\. Your published version and pinned agents stay as they are; nothing is published\./);
    assert.match(t, /It replaces your unpublished draft edits\./);
    assert.match(m.props(m.byTestId('rebase-create')[0]).className, /min-h-\[44px\]/, 'a 44px target on a phone');
    assert.equal(posts(m).length, 0, 'opening the sheet writes nothing');
  } finally { await m.done(); }
});

test('Create draft with a conflict unchosen is refused on that part, and nothing is sent', async () => {
  const m = await mountPage(ROUTES());
  try {
    await m.fire('compare-rebase');
    await m.fire('rebase-steps-mine', 'onChange', { target: { checked: true } });
    await m.fire('rebase-create');
    assert.equal(posts(m).length, 0);
    assert.match(m.text(), /Choose what the new draft keeps for this part\./);
    assert.equal(m.byTestId('rebase-error-tools-text').length, 1, 'the error is on Tools');
    assert.equal(m.byTestId('rebase-error-steps-text').length, 0);
    assert.match(m.props(m.byTestId('rebase-part-tools')[0])['aria-describedby'], /rebase-error-tools/);
  } finally { await m.done(); }
});

test('Edit by hand and Take Axal: the exact body is sent; on success the new draft opens and no agent is touched', async () => {
  const routes = {
    ...ROUTES(),
    [`POST /api/teams/skills/${EXT}/rebase`]: [200, { skill: extCard({ status: 'draft' }), base: { uid: HQ, version: 5 } }],
  };
  const m = await mountPage(routes);
  try {
    await m.fire('compare-rebase');
    await m.fire('rebase-steps-edit', 'onChange', { target: { checked: true } });
    const [box] = m.byTestId('rebase-hand-steps');
    assert.equal(m.props(box).value, SM.join('\n'), 'the hand editor starts from yours');
    await m.fire('rebase-hand-steps', 'onChange', { target: { value: `${SM[0]}\nEstimate buyers from the CRM and filings.\n\n${S5[3]}` } });
    await m.fire('rebase-tools-axal', 'onChange', { target: { checked: true } });
    await m.fire('rebase-create');
    const sent = posts(m);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].key, `POST /api/teams/skills/${EXT}/rebase`);
    assert.deepEqual(sent[0].body, {
      version: 5,
      expected_draft_hash: HASH,
      resolutions: { steps: { choice: 'edit', value: [SM[0], 'Estimate buyers from the CRM and filings.', S5[3]] }, tools: { choice: 'axal' } },
    });
    assert.equal(m.byTestId('rebase-sheet').length, 0, 'the sheet closes');
    assert.equal(m.byTestId('team-page').length, 1, 'the new draft opens on Team › Skills');
  } finally { await m.done(); }
});

test('Keep mine on Tools with a tool Axal v5 lacks: warned before sending, and the Worker\'s refusal sits on Tools with choices kept', async () => {
  const mine = { ...MINE, tools: ['crm.read', 'slack.post'] };
  const routes = {
    ...ROUTES({ ext: extCard(mine) }),
    [`POST /api/teams/skills/${EXT}/rebase`]: [422, { error: 'tool_not_in_base', message: 'Slack is not a tool of the newer Axal base.', part: 'tools', tool: { key: 'slack.post', label: 'Slack' } }],
  };
  const m = await mountPage(routes);
  try {
    await m.fire('compare-rebase');
    await m.fire('rebase-steps-axal', 'onChange', { target: { checked: true } });
    await m.fire('rebase-tools-mine', 'onChange', { target: { checked: true } });
    assert.match(m.text(), /slack\.post is not a tool of Axal v5, so the draft can’t keep it\./);
    await m.fire('rebase-create');
    assert.equal(posts(m).length, 1, 'the Worker decides; the warning does not block');
    assert.match(m.props(m.byTestId('rebase-error-tools-text')[0]).children.join(''), /Slack is not a tool of the newer Axal base\./);
    assert.equal(m.byTestId('rebase-sheet').length, 1, 'the sheet stays open');
    assert.equal(m.props(m.byTestId('rebase-steps-axal')[0]).checked, true, 'choices are kept');
    assert.equal(m.props(m.byTestId('rebase-tools-mine')[0]).checked, true);
  } finally { await m.done(); }
});

test('a stale draft: the dialog says nothing was saved and offers Reload, which reads the page again', async () => {
  const routes = {
    ...ROUTES(),
    [`POST /api/teams/skills/${EXT}/rebase`]: [409, { error: 'draft_conflict', message: 'This draft changed while you were editing.', draft_hash: 'f'.repeat(64) }],
  };
  const m = await mountPage(routes);
  try {
    await m.fire('compare-rebase');
    await m.fire('rebase-steps-mine', 'onChange', { target: { checked: true } });
    await m.fire('rebase-tools-axal', 'onChange', { target: { checked: true } });
    await m.fire('rebase-create');
    assert.match(m.text(), /Your draft changed since this page was read\. Nothing was saved\. Reload, then choose again\./);
    const before = m.net.seen.filter((s) => s.key === `GET /api/teams/skills/${EXT}/base`).length;
    await m.fire('rebase-reload');
    assert.equal(m.net.seen.filter((s) => s.key === `GET /api/teams/skills/${EXT}/base`).length, before + 1, 'the comparison is read again');
    assert.equal(m.byTestId('rebase-sheet').length, 0, 'the sheet closes so the person chooses on the new comparison');
    assert.equal(posts(m).length, 1, 'nothing is retried on the person\'s behalf');
  } finally { await m.done(); }
});

test('suspended, retired, read-only and hash-less: no working Rebase', async () => {
  const sus = await mountPage(ROUTES({ lin: lineage({ base: { ...lineage().base, suspended: true } }) }));
  try {
    const [btn] = sus.byTestId('compare-rebase');
    assert.equal(sus.props(btn)['aria-disabled'], true);
    assert.equal(sus.props(btn).onClick, undefined);
    assert.match(sus.text(), /Axal has paused v5, so it cannot be rebased onto right now\./);
  } finally { await sus.done(); }
  const noHash = await mountPage(ROUTES({ ext: extCard({ draft_hash: null }) }));
  try {
    assert.equal(noHash.props(noHash.byTestId('compare-rebase')[0])['aria-disabled'], true);
    assert.match(noHash.text(), /Your draft’s version could not be read\. Reload the page to rebase\./);
  } finally { await noHash.done(); }
  const ret = await mountPage(ROUTES({ lin: lineage({ base: { ...lineage().base, retired: true } }) }));
  try { assert.equal(ret.byTestId('compare-rebase').length, 0); } finally { await ret.done(); }
  const mem = await mountPage(ROUTES({ ext: extCard({ can_write: false, draft_hash: null }) }));
  try {
    assert.equal(mem.byTestId('compare-rebase').length, 0);
    assert.match(mem.text(), /Only your company’s editors can change this skill\./);
  } finally { await mem.done(); }
});

test('Output, Skill tags and Roles in conflict: Edit by hand is not offered there, with the reason', async () => {
  const fields = FIELDS.map((f) => (f.field === 'tags' ? { ...f, base_changed: true, conflict: true } : f));
  const m = await mountPage(ROUTES({ lin: lineage({ fields }) }));
  try {
    await m.fire('compare-rebase');
    assert.equal(m.props(m.byTestId('rebase-tags-edit')[0]).disabled, true);
    assert.equal(m.props(m.byTestId('rebase-tags-mine')[0]).disabled, false);
    assert.match(m.text(), /Keep yours or take Axal’s here; then change skill tags in the new draft\./);
  } finally { await m.done(); }
});
