// #5964 (D5963, D4538 part 2) — Team › Skills › Compare with Axal, and Extend.
//
// The page is mounted on the Worker's own answers (`GET /api/teams/skills/:uid`, `GET /api/teams/skills/:uid/base`,
// `GET /api/teams/skills`, `POST /api/teams/skills/:uid/extend`), stubbed at fetch. Every company, skill, step, tool and
// tag below is an invented fixture.
//
// Mutations, each turning this file red (run 2026-11-15): conflicts not put first; a conflict marked "Changed by you";
// an unreadable base drawn as a comparison; Extend again enabled while suspended; the name always sent; the
// "New in Axal vN" tool note dropped; Extend again offered with no update; `base_update_available` ignored; a
// non-writer given the editor's actions; slug_taken put on the dialog; a null based_on_version read as 0; SK-10's
// Compare link dropped; the reason not checked before sending; the 404 state dropped; Extend hidden from editors on
// SK-10; the "Added:" words dropped from a + line.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skill_extension_compare_5964.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import SkillComparePage from '../src/pages/team/SkillComparePage.jsx';
import { History } from '../src/pages/team/SkillExtension.jsx';
import SkillsTab from '../src/pages/team/SkillsTab.jsx';
import {
  PART_ORDER, actionsFor, bannerWords, columnsOf, compareHref, compareView, extendBody, extendRefusal, lineDiff, markerOf, reasonProblem,
  toolsCell, versionChoices,
} from '../src/pages/team/extensionCompareModel.js';
import { fromWorkerSkill } from '../src/pages/team/skillsModel.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

// ---------------------------------------------------------------- fixtures (invented)

const uid = (n) => String(n).padStart(32, 'b');
const HQ = uid(1);
const EXT = uid(2);
const CO = 'cofix01';
const S3 = ['Define the market and the buyer.', 'Estimate buyers from public sources.', 'Estimate spend per buyer.', 'State every assumption.'];
const SM = [S3[0], 'List buyer teams by region from the CRM.', S3[2], S3[3], 'Flag any figure older than 24 months.'];
const S5 = [S3[0], 'Estimate buyers from public sources and filings.', S3[2], 'Cross-check with a bottom-up count.', S3[3]];
const tag = (label, level) => ({ slug: label.toLowerCase().replace(/\W+/g, '-'), label, category: 'gtm_sales', level });
const parts = (o) => ({
  name: '[Sizing fixture]', purpose: 'Sizes a market.', steps: S3, tools: ['crm.read', 'web.search', 'metrics.read'], output_kind: 'brief', output_label: 'A brief',
  tags: [tag('Market research', 'proficient')], roles: [{ key: 'analyst', label: 'Analyst' }], ...o,
});
const V3 = parts({});
const MINE = parts({ name: '[Sizing fixture · ours]', steps: SM, tools: ['crm.read', 'metrics.read'], tags: [tag('Market research', 'proficient'), tag('Procurement', 'working')] });
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
  reason: 'Our buyers are procurement teams, so we count them from our CRM.',
  versions: [{ version: 2, based_on_version: 3, published_at: '2026-11-12 09:30:00', by_name: 'Priya Shah' }, { version: 1, based_on_version: 3, published_at: '2026-11-03 16:05:00', by_name: null }],
  base: { uid: HQ, name: '[Sizing fixture]', status: 'published', current_version: 5, retired: false, suspended: false, version: { version: 3, ...V3 }, newest: { version: 5, ...V5 } },
  base_update_available: true,
  company: { side: 'version', version: 2 },
  fields: FIELDS,
  ...over,
});
const extCard = (over = {}) => ({
  uid: EXT, scope: 'company', slug: 'sizing-ours', status: 'published', version: 2, author: '[Fixture Co]', ...MINE,
  used_by: 1, updated_at: '2026-11-14T00:00:00Z', can_write: true, based_on: { skill_uid: HQ, version: 3 }, draft_hash: 'd'.repeat(64), ...over,
});
const card = (raw) => fromWorkerSkill(raw);

// ---------------------------------------------------------------- the model

test('markers come from the Worker\'s flags; conflicts first, then the fixed part order', () => {
  assert.equal(markerOf({ conflict: true, company_changed: true, base_changed: true }), 'c');
  assert.equal(markerOf({ company_changed: true }), 'y');
  assert.equal(markerOf({ base_changed: true }), 'a');
  assert.equal(markerOf({}), 's');
  const v = compareView(card(extCard()), lineage());
  assert.equal(v.kind, 'compare');
  assert.deepEqual(v.rows.map((r) => r.field), ['steps', 'tools', 'name', 'purpose', 'output_kind', 'tags', 'roles']);
  assert.deepEqual(v.rows.map((r) => r.marker), ['c', 'c', 'y', 'a', 's', 'y', 's']);
  assert.equal(v.conflicts, 2);
  assert.equal(PART_ORDER.length, 7);
});

test('three columns only while Axal has a newer version; the banner counts conflicts', () => {
  const v = compareView(card(extCard()), lineage());
  assert.deepEqual(columnsOf(v, card(extCard())).map((c) => c.title), ['Axal v3', 'Your version v2', 'Axal v5']);
  assert.equal(bannerWords(v).head, 'Axal published v5. Your extension is based on v3. 2 parts conflict.');
  assert.match(bannerWords(v).sub, /pinned version/);
  const upToDate = compareView(card(extCard()), lineage({ base_update_available: false, base: { ...lineage().base, current_version: 3, newest: null }, fields: FIELDS.map((f) => ({ ...f, base_changed: false, conflict: false })) }));
  assert.deepEqual(columnsOf(upToDate, card(extCard())).map((c) => c.side), ['base', 'mine']);
  assert.equal(bannerWords(upToDate).head, 'Up to date with Axal v3');
  assert.equal(actionsFor(upToDate, card(extCard())).extendAgain, null, 'no newer Axal version, no Extend again');
  // The Worker's flag decides: a stray `newest` without `base_update_available` is no update.
  const noFlag = compareView(card(extCard()), lineage({ base_update_available: false }));
  assert.equal(noFlag.update, false);
  assert.equal(columnsOf(noFlag, card(extCard())).length, 2);
  const retired = compareView(card(extCard()), lineage({ base_update_available: false, base: { ...lineage().base, retired: true, newest: null } }));
  assert.equal(bannerWords(retired).head, 'No further Axal versions. Your extension keeps working.');
});

test('a base that cannot be read is never "up to date" and draws no comparison', () => {
  const v = compareView(card(extCard()), lineage({ base: null, base_update_available: null, fields: null }));
  assert.equal(v.kind, 'unreadable_base');
  assert.equal(v.basedOn, 3);
  assert.equal(v.rows, undefined);
  assert.equal(compareView(card(extCard()), null).kind, 'standalone');
});

test('line diff: + added, − removed, kept runs folded; full shows every line', () => {
  const d = lineDiff(S3, SM);
  assert.deepEqual(d, [
    { op: 'eq', count: 1 },
    { op: '-', text: S3[1] }, { op: '+', text: SM[1] },
    { op: 'eq', count: 2 },
    { op: '+', text: SM[4] },
  ]);
  assert.equal(lineDiff(S3, SM, { full: true }).filter((l) => l.op === '=').length, 3);
  assert.deepEqual(lineDiff([], ['a']), [{ op: '+', text: 'a' }]);
});

test('tools narrow, never widen: a tool new in Axal\'s newest says it is not available to this extension', () => {
  const t = toolsCell(V3.tools, V5.tools, 'newest', 5);
  assert.deepEqual(t.find((x) => x.tool === 'filings.read'), { tool: 'filings.read', op: '+', note: 'New in Axal v5 — not available to this extension' });
  assert.deepEqual(toolsCell(V3.tools, MINE.tools, 'mine', 5).find((x) => x.tool === 'web.search'), { tool: 'web.search', op: '-', note: 'Removed by you' });
});

test('who acts: editors extend again (disabled with its reason while suspended); members and HQ read only', () => {
  const v = compareView(card(extCard()), lineage());
  assert.deepEqual(actionsFor(v, card(extCard())).extendAgain, { version: 5, disabled: false, why: null });
  // #4538: a reader also gets no rebase.
  assert.deepEqual(actionsFor(v, card(extCard({ can_write: false }))), { editor: false, readOnly: 'member', extendAgain: null, rebase: null });
  assert.equal(actionsFor(v, card(extCard({ can_write: false })), { hqAdmin: true }).readOnly, 'hq');
  const susp = compareView(card(extCard()), lineage({ base: { ...lineage().base, suspended: true } }));
  const a = actionsFor(susp, card(extCard()));
  assert.equal(a.extendAgain.disabled, true);
  assert.equal(a.extendAgain.why, 'Axal has paused v5, so it cannot be extended right now.');
  const retired = compareView(card(extCard()), lineage({ base_update_available: false, base: { ...lineage().base, retired: true, newest: null } }));
  assert.equal(actionsFor(retired, card(extCard())).extendAgain, null, 'a retired base offers no Extend again');
});

test('Extend: each refusal is tied to its field; the body sends a name only when it differs from Axal\'s', () => {
  assert.deepEqual(extendRefusal('fork_reason_invalid'), { field: 'reason', text: 'Say why your company is extending this skill, in up to 300 characters.' });
  assert.equal(extendRefusal('slug_taken').field, 'name');
  assert.equal(extendRefusal('version_not_published').field, 'version');
  assert.equal(extendRefusal('base_suspended').field, 'dialog');
  assert.deepEqual(extendRefusal('checkdraft_code', 'The Worker says why.'), { field: 'dialog', text: 'The Worker says why.' });
  assert.deepEqual(extendBody({ company: CO, reason: '  Why.\r\n', name: '[Sizing fixture]', baseName: '[Sizing fixture]', version: 5 }), { company: CO, reason: 'Why.', version: 5 });
  assert.deepEqual(extendBody({ company: CO, reason: 'Why.', name: ' Ours ', baseName: '[Sizing fixture]', version: null }), { company: CO, reason: 'Why.', name: 'Ours' });
  assert.ok(reasonProblem('   '));
  assert.ok(reasonProblem('x'.repeat(301)));
  assert.equal(reasonProblem('x'.repeat(300)), null);
  assert.deepEqual(versionChoices(3), [3, 2, 1]);
  assert.deepEqual(versionChoices(null), []);
});

test('history: a null based_on_version, publisher or day reads Not recorded, never "v0" or a guessed name', () => {
  const v = compareView(card(extCard()), lineage({ versions: [{ version: 1, based_on_version: null }] }));
  assert.deepEqual(v.history, [{ version: 1, builtOn: null, by: null, on: null }]);
  const out = renderedText(html(h(History, { rows: v.history })));
  assert.match(out, /Your v1/);
  assert.match(out, /Axal: Not recorded/);
  assert.match(out, /Published by Not recorded, Not recorded/);
  assert.doesNotMatch(out, /Not built yet/);
  assert.doesNotMatch(out, /v0\b/);
  // D8826: the base read's publisher name and day; a blank or address-shaped name is not shown.
  const rows = compareView(card(extCard()), lineage({ versions: [
    { version: 3, based_on_version: 3, published_at: '2026-11-12 09:30:00', by_name: ' Priya Shah ' },
    { version: 2, based_on_version: 3, published_at: '2026-11-03T16:05:00Z', by_name: 'priya@example.test' },
    { version: 1, based_on_version: 3, published_at: null, by_name: '  ' },
  ] })).history;
  assert.deepEqual(rows.map((r) => [r.version, r.by, r.on]), [[3, 'Priya Shah', '12 Nov 2026'], [2, null, '3 Nov 2026'], [1, null, null]]);
  const drawn = renderedText(html(h(History, { rows })));
  assert.match(drawn, /Your v3 ?built on Axal v3 ?Published by Priya Shah, 12 Nov 2026/);
  assert.match(drawn, /Published by Not recorded, 3 Nov 2026/);
  assert.doesNotMatch(drawn, /@/);
  assert.match(renderedText(html(h(History, { rows: [] }))), /No published versions yet/);
});

// ---------------------------------------------------------------- the page, on the Worker's answers

function stubFetch(routes) {
  const seen = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const key = `${(init.method || 'GET').toUpperCase()} ${url.pathname}`;
    seen.push({ key, search: url.search, body: init.body ? JSON.parse(init.body) : null });
    const hit = routes[key];
    const [status, body] = typeof hit === 'function' ? hit() : hit || [500, { error: 'boom' }];
    return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { seen, restore: () => { globalThis.fetch = previous; } };
}
const settle = async (m) => { for (let i = 0; i < 5; i += 1) await m.flush(); };
const LIB = { hq: [], company: { uid: CO, name: '[Fixture Co]', skills: [], can_write: true }, can_write_hq: false };
const ROUTES = ({ ext = extCard(), lin = lineage(), base = [200, { lineage: lin }] } = {}) => ({
  [`GET /api/teams/skills/${EXT}`]: [200, { skill: ext, versions: [], agents: [] }],
  [`GET /api/teams/skills/${EXT}/base`]: base,
  'GET /api/teams/skills': [200, LIB],
});
async function mountPage(routes) {
  const net = stubFetch(routes);
  const el = h(Routes, null, h(Route, { path: '/account/companies/:uid/settings/team/skills/:skillUid/base', element: h(SkillComparePage) }));
  const m = await mountContracts(el, compareHref(CO, EXT));
  await settle(m);
  const byTestId = (id) => m.nodes().filter((n) => m.props(n)?.['data-testid'] === id);
  return { ...m, net, byTestId, async done() { await m.unmount(); net.restore(); } };
}

test('the page: conflicts first in a real table, markers in words, + / − lines, the reason, history, editor actions', async () => {
  const m = await mountPage(ROUTES());
  try {
    const t = m.text();
    assert.match(t, /Compare with Axal/);
    assert.match(t, /Based on Axal \[Sizing fixture\] v3/);
    assert.match(t, /Axal published v5\. Your extension is based on v3\. 2 parts conflict\./);
    assert.match(t, /Why \[Fixture Co\] extended it/);
    assert.match(t, /procurement teams/);
    assert.match(t, /Comparison · 7 parts, conflicts first/);
    for (const w of ['Conflict', 'Changed by you', 'Changed by Axal', 'Same as Axal v3']) assert.ok(t.includes(w), w);
    assert.match(t, /Added: List buyer teams by region/);
    assert.match(t, /Removed: Estimate buyers from public sources\./);
    assert.match(t, /New in Axal v5 — not available to this extension/);
    const rows = m.nodes().filter((n) => /^compare-row-/.test(m.props(n)?.['data-testid'] || '')).map((n) => m.props(n)['data-testid']);
    assert.deepEqual(rows, ['compare-row-steps', 'compare-row-tools', 'compare-row-name', 'compare-row-purpose', 'compare-row-output_kind', 'compare-row-tags', 'compare-row-roles']);
    assert.equal(m.byTestId('compare-extend-again').length, 1);
    assert.match(m.text(), /Extend Axal v5 again…/);
    // #4538 (SK-20): Rebase is built; it opens the rebase sheet (skill_rebase_dialog_4538.test.mjs covers it).
    assert.equal(m.props(m.byTestId('compare-rebase')[0])['aria-disabled'], undefined, 'rebase is offered to an editor');
    assert.doesNotMatch(t, /Not built yet · #5965/);
    assert.match(t, /built on Axal v3/);
    assert.ok(m.net.seen.every((s) => s.key.startsWith('GET ')), 'reading the page writes nothing');
  } finally { await m.done(); }
});

test('a member reads it with no actions; a suspended newest disables Extend again with its reason', async () => {
  const mem = await mountPage(ROUTES({ ext: extCard({ can_write: false }) }));
  try {
    assert.equal(mem.byTestId('compare-actions').length, 0);
    assert.match(mem.text(), /Only your company’s editors can change this skill\./);
  } finally { await mem.done(); }
  const sus = await mountPage(ROUTES({ lin: lineage({ base: { ...lineage().base, suspended: true } }) }));
  try {
    const [btn] = sus.byTestId('compare-extend-again');
    assert.equal(sus.props(btn)['aria-disabled'], true);
    assert.equal(sus.props(btn)['aria-describedby'], 'extend-why');
    assert.match(sus.text(), /Axal has paused v5, so it cannot be extended right now\./);
  } finally { await sus.done(); }
});

test('states: a standalone skill, an unreadable base, a failed read and the Worker\'s 404', async () => {
  const solo = await mountPage(ROUTES({ ext: extCard({ based_on: null }), base: [200, { lineage: null }] }));
  try { assert.match(solo.text(), /This skill is not based on an Axal skill\. There is nothing to compare it with\./); } finally { await solo.done(); }

  const nob = await mountPage(ROUTES({ lin: lineage({ base: null, base_update_available: null, fields: null }) }));
  try {
    const t = nob.text();
    assert.match(t, /Axal’s version could not be read\./);
    assert.match(t, /This is not “up to date”/);
    assert.match(t, /Axal’s name could not be read/);
    assert.doesNotMatch(t, /Up to date with/);
    assert.equal(nob.byTestId('compare-table').length, 0, 'no comparison while Axal\'s side is unreadable');
    assert.match(t, /built on Axal v3/, 'history still reads');
    assert.match(t, /Published by Priya Shah, 12 Nov 2026/, 'with who published each version, and when');
    assert.match(t, /Published by Not recorded, 3 Nov 2026/);
  } finally { await nob.done(); }

  const bad = await mountPage(ROUTES({ base: [500, { error: 'boom' }] }));
  try {
    assert.match(bad.text(), /The comparison could not be read\. Nothing below is a guess\./);
    assert.equal(bad.byTestId('compare-retry').length, 1);
  } finally { await bad.done(); }

  const gone = await mountPage(ROUTES({ base: [404, { code: 'not_found', error: 'There is no such skill.' }] }));
  try { assert.match(gone.text(), /There is no such skill\./); } finally { await gone.done(); }
});

test('Extend again: the Worker\'s refusal shows on its field; a 201 opens the new draft and attaches it to no agent', async () => {
  let reply = [409, { code: 'slug_taken', error: 'Your company already has a skill with this short name. Give the extension another name.' }];
  const routes = { ...ROUTES(), [`POST /api/teams/skills/${HQ}/extend`]: () => reply };
  const m = await mountPage(routes);
  try {
    await act(async () => { m.props(m.byTestId('compare-extend-again')[0]).onClick(); });
    await settle(m);
    assert.match(m.text(), /This is a new extension\./);
    // Refused before sending: no reason.
    await act(async () => { m.props(m.byTestId('extend-create')[0]).onClick(); });
    await settle(m);
    assert.match(m.props(m.byTestId('extend-error-reason')[0]).children.join(''), /Say why your company is extending this skill/);
    assert.equal(m.net.seen.filter((s) => s.key.startsWith('POST')).length, 0);
    await act(async () => { m.props(m.byTestId('extend-reason')[0]).onChange({ target: { value: 'Our buyers differ.' } }); });
    await act(async () => { m.props(m.byTestId('extend-create')[0]).onClick(); });
    await settle(m);
    const post = m.net.seen.find((s) => s.key === `POST /api/teams/skills/${HQ}/extend`);
    assert.deepEqual(post.body, { company: CO, reason: 'Our buyers differ.', version: 5 });
    assert.equal(m.byTestId('extend-error-name').length, 1, 'slug_taken is drawn on the Name field');
    assert.equal(m.props(m.byTestId('extend-name')[0])['aria-invalid'], true);
    reply = [201, { skill: extCard({ uid: uid(9), status: 'draft', version: null }), base: { uid: HQ, name: '[Sizing fixture]', version: 5, current_version: 5 } }];
    await act(async () => { m.props(m.byTestId('extend-name')[0]).onChange({ target: { value: '[Sizing fixture · hospitals]' } }); });
    await act(async () => { m.props(m.byTestId('extend-create')[0]).onClick(); });
    await settle(m);
    assert.equal(m.byTestId('extend-skill-sheet').length, 0, 'the dialog closes on 201');
    assert.ok(!m.net.seen.some((s) => /\/assign|\/agents\/.*\/skills/.test(s.key) && s.key.startsWith('P')), 'nothing is attached to an agent');
  } finally { await m.done(); }
});

test('SK-10: an extension links to Compare with Axal; an editor can Extend a published Axal skill for the company', async () => {
  const hqCard = { uid: HQ, scope: 'hq', slug: 'sizing', status: 'published', version: 5, author: 'Axal', ...V5, used_by: 3, can_write: false, based_on: null };
  const routes = {
    'GET /api/teams/skills': [200, { ...LIB, hq: [hqCard], company: { ...LIB.company, skills: [extCard()] } }],
    [`GET /api/teams/skills/${EXT}`]: [200, { skill: extCard(), versions: [], agents: [] }],
    [`GET /api/teams/skills/${EXT}/agents`]: [200, { agents: [] }],
    [`GET /api/teams/skills/${HQ}`]: [200, { skill: hqCard, versions: [], agents: [] }],
    [`GET /api/teams/skills/${HQ}/agents`]: [200, { agents: [] }],
  };
  const scope = { kind: 'company', company: { uid: CO, name: '[Fixture Co]' } };
  const agentsBlock = { available: true, value: { can_manage: true, plan_ok: true, agents: [] } };
  let net = stubFetch(routes);
  let m = await mountContracts(h(SkillsTab, { scope, agentsBlock }), `/account/companies/${CO}/settings/team?tab=skills&skill=${EXT}`);
  try {
    await settle(m);
    assert.match(m.text(), /Based on Axal v3 · Compare with Axal/);
    const [link] = m.nodes().filter((n) => m.props(n)?.['data-testid'] === 'skill-compare-link');
    assert.equal(m.props(link).href, compareHref(CO, EXT));
  } finally { await m.unmount(); net.restore(); }
  net = stubFetch(routes);
  m = await mountContracts(h(SkillsTab, { scope, agentsBlock }), `/account/companies/${CO}/settings/team?tab=skills&skill=${HQ}`);
  try {
    await settle(m);
    assert.match(m.text(), /Extend for \[Fixture Co\]…/);
    assert.doesNotMatch(m.text(), /Compare with Axal/, 'an Axal skill has no base');
  } finally { await m.unmount(); net.restore(); }
});

test('dark mode: every colour on the new screens has its dark: pair', () => {
  for (const f of ['../src/pages/team/SkillExtension.jsx', '../src/pages/team/SkillComparePage.jsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const cls of src.match(/className=\{?[`"][^`"]*[`"]/g) || []) {
      const light = cls.match(/(?<![:\w-])(bg|text|border)-(red|emerald|amber|axal-lavender|axal-ground|white)[\w/-]*/g) || [];
      if (light.length) assert.match(cls, /dark:/, `${f}: ${cls}`);
    }
  }
});
