/**
 * D6085 (#6085): "Paid for by" and Founders after the round on Use of funds
 * (RA-32, RA-33), the picker that links, changes and clears the scenario,
 * Scenarios' and Compare's cap-table cells, and the cap table's scenario page
 * naming the plans it pays for.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/use_of_funds_captable_link_6085.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { act } from 'react';
import { h, mountForm, propsOf } from './_form_d695.mjs';
import { CapTableLinkDialog, FoundersAfterCard, PaidForBy } from '../src/pages/raise/useoffunds/CapTableLink.jsx';
import {
  capTableLine, foundersCell, foundersView, linkBody, paidForBy, pickerRows, pointsText, raiseDiffers, suggestion,
} from '../src/pages/raise/useoffunds/capTableLinkModel.js';
import { compareTable, scenarioCard } from '../src/pages/raise/useoffunds/scenariosForecastModel.js';
import { usedByLine } from '../src/pages/raise/captable/scenariosModel.js';
import { useOfFundsApi } from '../src/lib/api/useOfFunds.js';

const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const LINKED = {
  state: 'linked', uid: 'sc-b', reason: null,
  scenario: { uid: 'sc-b', name: 'Seed · Scenario B', model: false, updated_at: '2026-11-12 10:00:00', source: 'Modelled' },
  round: { name: 'Seed', investment_cents: 150_000_000 },
  raise: { plan_cents: 150_000_000, scenario_cents: 150_000_000, differs: false },
  founders: { state: 'ok', source: 'Modelled', round: 'Seed', rows: [
    { founder: 'Founder A', before_pct: 40, after_pct: 34, change_pts: -6 },
    { founder: 'Founder B', before_pct: 32, after_pct: 27.2, change_pts: -4.8 },
  ], together: { before_pct: 72, after_pct: 61.2, change_pts: -10.8 } },
};
const DIFFERS = { ...LINKED, scenario: { ...LINKED.scenario, name: 'Seed · Scenario A' }, raise: { plan_cents: 150_000_000, scenario_cents: 200_000_000, differs: true } };
const LATEST = { state: 'ok', value: { uid: 'sc-model', name: 'Cap table model', link_state: 'not_recorded' } };

test('D6085: Paid for by names the linked scenario, Modelled, with Change; every other state says why and offers its one action', () => {
  const linked = paidForBy(LINKED, LATEST);
  assert.equal(linked.name, 'Seed · Scenario B'); assert.equal(linked.tag, 'Modelled'); assert.equal(linked.action, 'Change');
  assert.equal(linked.href, '/raise/cap-table/scenarios/sc-b'); assert.equal(linked.differs, null);
  assert.match(linked.sub, /^Seed · \$1,500,000 · updated 12 Nov 2026$/);
  const none = paidForBy({ state: 'not_linked' }, LATEST);
  assert.equal(none.label, 'Not linked'); assert.equal(none.action, 'Link a scenario'); assert.equal(none.sub, 'Latest: Cap table model · shown unlinked');
  assert.equal(paidForBy(undefined, null).label, 'Not linked', 'today’s default');
  const empty = paidForBy({ state: 'not_linked' }, { state: 'ok', value: null });
  assert.equal(empty.state, 'empty'); assert.match(empty.sub, /No cap-table scenarios yet/);
  const broken = paidForBy({ state: 'deleted', uid: 'gone', reason: 'The linked scenario no longer exists.' }, LATEST);
  assert.equal(broken.label, 'Link broken'); assert.equal(broken.action, 'Pick another'); assert.equal(broken.name, null);
  const down = paidForBy({ state: 'unreadable', uid: 'x' }, LATEST);
  assert.equal(down.label, 'Unavailable'); assert.equal(down.action, 'Try again');
});

test('D6085: a raise that differs names both amounts and is never fixed', () => {
  const d = paidForBy(DIFFERS, LATEST).differs;
  assert.match(d.text, /^Raise differs: Seed · Scenario A invests \$2,000,000; the plan raises \$1,500,000\.$/);
  assert.equal(raiseDiffers({ plan_cents: 1, scenario_cents: null, differs: false }), null);
  const html = ssr(h(PaidForBy, { link: DIFFERS, latest: LATEST, canWrite: true, onPick() {}, onRetry() {} }));
  assert.match(html, /uof-paid-for-by-differs/); assert.match(html, /Linking changes neither\./);
  assert.match(html, />Change</);
  assert.doesNotMatch(ssr(h(PaidForBy, { link: DIFFERS, latest: LATEST, canWrite: false, onPick() {} })), /uof-paid-for-by-act/, 'a reader cannot change the link');
});

test('D6085: Founders after the round is Modelled, hidden until linked, and never 0 when the scenario has no founders', () => {
  const v = foundersView(LINKED);
  assert.equal(v.tag, 'Modelled');
  assert.deepEqual(v.rows[0], { founder: 'Founder A', before: '40.0%', after: '34.0%', change: '−6.0 pts' });
  assert.deepEqual(v.together, { before: '72.0%', after: '61.2%', change: '−10.8 pts' });
  assert.match(v.note, /not recorded holders/);
  for (const link of [undefined, { state: 'not_linked' }, { state: 'deleted', uid: 'x' }]) assert.equal(foundersView(link).state, 'hidden');
  assert.equal(foundersView({ state: 'unreadable' }).state, 'unavailable');
  const nr = foundersView({ ...LINKED, founders: { state: 'not_recorded', reason: 'This scenario has no founders after a round, so there is nothing to compare. Not 0%.' } });
  assert.equal(nr.state, 'not_recorded'); assert.match(nr.reason, /Not 0%/);
  assert.equal(pointsText(0), '0.0 pts'); assert.equal(pointsText(1.25), '+1.3 pts'); assert.equal(pointsText(null), null);
  const html = ssr(h(FoundersAfterCard, { link: LINKED }));
  assert.match(html, /Founders after the round/); assert.match(html, /◇ Modelled/); assert.match(html, /After Seed/); assert.match(html, /Open in Cap table/);
  assert.match(html, /<caption class="sr-only">/);
  assert.match(ssr(h(FoundersAfterCard, { link: LINKED, phone: true })), /uof-founders-cards/, 'stacked cards on a phone');
  assert.equal(ssr(h(FoundersAfterCard, { link: { state: 'not_linked' } })), '');
});

test('D6085: Scenarios and Compare read each scenario’s own link', () => {
  const base = { id: 1, name: 'Base plan', is_base: 1, lines: [], amount_to_raise_cents: 150_000_000, currency: 'usd' };
  assert.equal(scenarioCard(base).capTable, 'No cap-table scenario linked');
  assert.equal(scenarioCard({ ...base, cap_table_link: LINKED }).capTable, 'Seed · Scenario B · Modelled');
  assert.equal(capTableLine(DIFFERS), 'Seed · Scenario A · Modelled · Raise differs');
  assert.match(capTableLine({ state: 'deleted' }), /^Link broken/);
  const t = compareTable({ scenarios: [{ ...base, cap_table_link: LINKED }, { ...base, id: 2, cap_table_link: { state: 'deleted', uid: 'x' } }] });
  const row = t.rows.find((r) => r.key === 'founders');
  assert.deepEqual(row.cells[0], { text: '61.2% · −10.8 pts', missing: false, reason: null, tag: 'Modelled' });
  assert.equal(row.cells[1].missing, true); assert.equal(row.cells[1].text, 'Not recorded');
  assert.equal(foundersCell(undefined).reason, 'No cap-table scenario linked');
});

const OPTIONS = {
  scenario_id: 5, linked_uid: null, plan_raise_cents: 150_000_000, matching_uid: 'sc-b', source: 'Modelled',
  items: [
    { uid: 'sc-a', name: 'Seed · Scenario A', model: false, updated_at: '2026-11-10', round: { name: 'Seed', investment_cents: 200_000_000 }, raise: { plan_cents: 150_000_000, scenario_cents: 200_000_000, differs: true } },
    { uid: 'sc-b', name: 'Seed · Scenario B', model: false, updated_at: '2026-11-12', round: { name: 'Seed', investment_cents: 150_000_000 }, raise: { plan_cents: 150_000_000, scenario_cents: 150_000_000, differs: false } },
  ],
};

test('D6085: the picker’s rows and the suggestion that matches the plan’s raise', () => {
  const rows = pickerRows(OPTIONS);
  assert.deepEqual(rows.map((r) => [r.uid, r.differs, r.suggested]), [['sc-a', true, false], ['sc-b', false, true]]);
  assert.equal(suggestion(OPTIONS).uid, 'sc-b');
  assert.match(suggestion(OPTIONS).why, /matches the plan’s raise/);
  assert.equal(suggestion({ ...OPTIONS, linked_uid: 'sc-b' }), null, 'no suggestion for the one already linked');
  assert.equal(suggestion({ ...OPTIONS, matching_uid: null }), null);
  assert.deepEqual(linkBody('sc-b', 3), { cap_table_scenario_uid: 'sc-b', expected_revision: 3 });
  assert.deepEqual(linkBody(null, 4), { cap_table_scenario_uid: null, expected_revision: 4 });
});

const SCENARIO = { id: 5, name: 'Base plan', revision: 3, cap_table_scenario_uid: null };
// The options are drawn in the read's order, so the nth radio is the nth scenario.
const radios = (ui) => ui.nodes().filter((n) => n.tagName === 'INPUT' && propsOf(n).name === 'captable');

test('D6085: Link scenario sends the pick and the revision it was read at; nothing else', async () => {
  const calls = []; let saved = null;
  const fake = { capTableScenarios: async (p, id) => { calls.push(['list', p, id]); return OPTIONS; }, linkCapTable: async (...a) => { calls.push(['link', ...a]); return {}; } };
  const ui = await mountForm(h(CapTableLinkDialog, { projectId: 7, scenario: SCENARIO, api: fake, onClose() {}, onSaved: (t) => { saved = t; } }), { modal: true });
  await ui.flush();
  assert.match(ui.text(), /Eadwyn suggests Seed · Scenario B\./);
  assert.match(ui.text(), /Raise differs/);
  await ui.click('Pick it');
  await ui.click('Link scenario');
  assert.deepEqual(calls, [['list', 7, 5], ['link', 7, 5, 'sc-b', 3]]);
  assert.match(saved, /paid for by Seed · Scenario B\. Neither figure changed\./);
  await ui.unmount();
});

test('D6085: choosing a scenario whose raise differs names both amounts before saving', async () => {
  const fake = { capTableScenarios: async () => OPTIONS, linkCapTable: async () => ({}) };
  const ui = await mountForm(h(CapTableLinkDialog, { projectId: 7, scenario: SCENARIO, api: fake, onClose() {}, onSaved() {} }), { modal: true });
  await ui.flush();
  const [first] = radios(ui);
  assert.ok(first, 'Scenario A has a radio');
  await act(async () => propsOf(first).onChange({ target: {} }));
  assert.ok(ui.by('uof-captable-differs'));
  assert.match(ui.text(), /Raise differs: Seed · Scenario A invests \$2,000,000; the plan raises \$1,500,000\. Linking changes neither scenario nor the plan\./);
  await ui.unmount();
});

test('D6085: Unlink clears with the revision; a stale read shows Review latest and saves nothing', async () => {
  const calls = []; let saved = null;
  const linked = { ...SCENARIO, cap_table_scenario_uid: 'sc-b' };
  const ok = { capTableScenarios: async () => ({ ...OPTIONS, linked_uid: 'sc-b' }), linkCapTable: async (...a) => { calls.push(a); return {}; } };
  let ui = await mountForm(h(CapTableLinkDialog, { projectId: 7, scenario: linked, api: ok, onClose() {}, onSaved: (t) => { saved = t; } }), { modal: true });
  await ui.flush();
  await ui.click('Unlink');
  assert.deepEqual(calls, [[7, 5, null, 3]]);
  assert.match(saved, /unlinked/);
  await ui.unmount();
  const stale = { capTableScenarios: async () => OPTIONS, linkCapTable: async () => { throw Object.assign(new Error('changed'), { status: 409, code: 'changed_since_open' }); } };
  saved = null;
  ui = await mountForm(h(CapTableLinkDialog, { projectId: 7, scenario: SCENARIO, api: stale, onClose() {}, onSaved: (t) => { saved = t; } }), { modal: true });
  await ui.flush();
  await ui.click('Pick it');
  await ui.click('Link scenario');
  assert.ok(ui.by('uof-review-latest'), 'Review latest is offered');
  assert.ok(ui.by('uof-captable-error'));
  assert.equal(saved, null);
  await ui.unmount();
});

test('D6085: a failed list read says so; an empty venture is told to model a round', async () => {
  let ui = await mountForm(h(CapTableLinkDialog, { projectId: 7, scenario: SCENARIO, api: { capTableScenarios: async () => { throw Object.assign(new Error('x'), { status: 503 }); } }, onClose() {}, onSaved() {} }), { modal: true });
  await ui.flush();
  assert.ok(ui.by('uof-captable-unreadable'));
  assert.doesNotMatch(ui.text(), /No cap-table scenarios yet/, 'a failed read is not an empty list');
  await ui.unmount();
  ui = await mountForm(h(CapTableLinkDialog, { projectId: 7, scenario: SCENARIO, api: { capTableScenarios: async () => ({ ...OPTIONS, items: [], matching_uid: null }) }, onClose() {}, onSaved() {} }), { modal: true });
  await ui.flush();
  assert.ok(ui.by('uof-captable-empty'));
  await ui.unmount();
});

test('D6085: the client methods name the mounted routes and send the revision', async () => {
  const s = src('lib/api/useOfFunds.js');
  assert.match(s, /capTableScenarios: \(project, scenarioId\) => request\(`\/cycles\/raise\/use-of-funds\/cap-table-scenarios\?/);
  assert.match(s, /linkCapTable: \(project, id, uid, revision\) => request\(`\/cycles\/raise\/use-of-funds\/scenarios\/\$\{seg\(id\)\}\/cap-table\?\$\{q\(project\)\}`, \{ method: 'PUT', body: JSON\.stringify\(\{ cap_table_scenario_uid: uid \?\? null, expected_revision: revision \}\) \}\)/);
  const route = readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_use_of_funds.ts', import.meta.url), 'utf8');
  assert.match(route, /r\.get\('\/cap-table-scenarios'/); assert.match(route, /r\.put\('\/scenarios\/:id\/cap-table'/);
  assert.equal(typeof useOfFundsApi.linkCapTable, 'function');
});

test('D6085: Home draws Paid for by and Founders after the round; the cap table’s scenario page names the plans it pays for', () => {
  const tool = src('pages/raise/useoffunds/UseOfFundsTool.jsx');
  assert.match(tool, /<PaidForBy link=\{base\?\.cap_table_link\} latest=\{plan\.ties\?\.cap_table\}/);
  assert.match(tool, /<FoundersAfterCard link=\{base\?\.cap_table_link\}/);
  assert.match(tool, /dialog === 'captable' \? <CapTableLinkDialog/);
  assert.match(src('pages/raise/useoffunds/ScenariosForecast.jsx'), /dialog\?\.kind === 'captable' \? <CapTableLinkDialog/);
  assert.equal(usedByLine([{ id: 5, name: 'Base plan', is_base: true }]), 'Use of funds: Base plan (base) is paid for by this scenario.');
  assert.equal(usedByLine([{ id: 5, name: 'Base plan', is_base: true }, { id: 6, name: 'Lean', is_base: false }]), 'Use of funds: Base plan (base) and Lean are paid for by this scenario.');
  for (const none of [null, undefined, []]) assert.equal(usedByLine(none), null);
  assert.match(src('pages/raise/captable/ScenariosPages.jsx'), /usedByLine\(scenario\.used_by_plans\)/);
});
