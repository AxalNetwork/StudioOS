/**
 * D801 (#2234) — HQ's licence console: the terms schedule editor (canvas L9),
 * "Requests from the Administrator", and the escalation kinds on Support.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_licence_terms_d801.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import { LICENCE_TERM_FIELDS as WORKER_FIELDS } from '../../cloudflare-worker/src/services/licenceTerms.ts';
import {
  LICENCE_TERM_FIELDS, NOT_RECORDED, buildSave, displayValue, fromInput, initialForm, termSections, toInput,
} from '../src/lib/licenceTermsForm.js';
import {
  ESCALATION_KIND_LABELS, LICENCE_REQUEST_KINDS, LICENCE_PANEL_KINDS, escalationKindLabel, filterByKind, kindFilters,
  licenceRequests, nonRenewalCheck, requestSummary, termAsItStands, termTarget,
} from '../src/lib/escalationKinds.js';
import { api } from '../src/lib/api.js';
import { TermsScheduleForm, saveError } from '../src/pages/admin/LicenceTermsSchedule.jsx';
import { RequestsPanelView, loadOpenRequests } from '../src/pages/admin/LicenceRequestsPanel.jsx';
import { EscalationKindFilter, escalationCardProps } from '../src/pages/hq/HqSupportPage.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const field = (key) => LICENCE_TERM_FIELDS.find((f) => f.key === key);
const firstOf = (type) => LICENCE_TERM_FIELDS.find((f) => f.type === type);
const LICENCE = {
  uid: 'lic_1', licence_ref: 'LIC-1', currency: 'EUR', annual_fee_cents: 9000000, term_years: 3,
  renews_on: '2028-03-01', seats: { founder: 60, investor: 0 }, territories: ['PT', 'ES'],
};

// ───────────────────────────────────────────────────────────── the field list

test('the editor\'s fields are D797\'s own list, every key once, under the canvas\'s section titles', () => {
  assert.equal(LICENCE_TERM_FIELDS, WORKER_FIELDS, 'the list is the Worker module\'s object, not a copy');
  const keys = termSections().flatMap((s) => s.fields.map((f) => f.key));
  assert.deepEqual(keys.slice().sort(), WORKER_FIELDS.map((f) => f.key).sort());
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(termSections().map((s) => s.title),
    ['Parties', 'Territory and exclusivity', 'Term and renewal', 'Fees and money', 'Deal terms', 'Seats', 'Brand and platform', 'Compliance and reporting']);
  // A group D797 adds later still renders, under its own key.
  const later = termSections([...WORKER_FIELDS, { key: 'brand_x', group: 'brand_platform', label: 'X', type: 'bool' }]);
  assert.equal(later.at(-1).title, 'Brand platform');
  const SRC = codeOnly(read('frontend/src/lib/licenceTermsForm.js'));
  assert.match(SRC, /from '\.\.\/\.\.\/\.\.\/cloudflare-worker\/src\/services\/licenceTerms\.ts'/);
  assert.ok(!SRC.includes("'late_interest_bps'"), 'a term key is hard-coded in the editor');
});

// ───────────────────────────────────────────────────────────── units, both ways

test('cents are money and bps a percentage, converted exactly both ways, and a cleared field is null', () => {
  const cents = firstOf('cents');
  const bps = firstOf('bps');
  for (const v of [0, 5, 100, 123450, 9000000, 123456789]) {
    const back = fromInput(cents, toInput(cents, v));
    assert.deepEqual(back, { ok: true, value: v }, `cents ${v}`);
  }
  assert.equal(toInput(cents, 123450), '1234.50');
  assert.equal(toInput(cents, 5), '0.05');
  assert.deepEqual(fromInput(cents, '1,234.5'), { ok: true, value: 123450 });
  for (const v of [0, 1, 50, 1205, 1250, 2000, 10000]) {
    assert.deepEqual(fromInput(bps, toInput(bps, v)), { ok: true, value: v }, `bps ${v}`);
  }
  assert.equal(toInput(bps, 1250), '12.5');
  assert.equal(toInput(bps, 1205), '12.05');
  assert.equal(toInput(bps, 1), '0.01');
  for (const f of LICENCE_TERM_FIELDS) assert.deepEqual(fromInput(f, '  '), { ok: true, value: null }, f.key);
  assert.equal(fromInput(cents, '1.234').ok, false, 'three decimals are refused, never rounded');
  assert.equal(fromInput(cents, '-5').ok, false);
  assert.equal(fromInput(bps, '100.01').ok, false);
  assert.equal(fromInput(bps, '12.345').ok, false);
  const day = field('usage_report_day');
  assert.equal(fromInput(day, '29').ok, false);
  assert.equal(fromInput(day, '0').ok, false, 'below the report day\'s minimum of 1');
  assert.equal(fromInput(day, '2.5').ok, false);
  assert.deepEqual(fromInput(day, '28'), { ok: true, value: 28 });
  assert.deepEqual(fromInput(firstOf('bool'), 'no'), { ok: true, value: 0 });
  assert.deepEqual(fromInput(firstOf('bool'), 'yes'), { ok: true, value: 1 });
  assert.equal(fromInput(firstOf('enum'), 'nonsense').ok, false);
  assert.equal(displayValue(cents, 123450, 'EUR'), 'EUR 1,234.50');
  assert.equal(displayValue(bps, 1250, 'EUR'), '12.5%');
  assert.equal(displayValue(bps, null, 'EUR'), NOT_RECORDED);
});

// ───────────────────────────────────────────────────────────── the save

const STORED = {
  terms: { late_interest_bps: 100, minimum_guarantee_cents: 500000, renewal_mode: 'auto', exclusive: 1, governing_law: 'Portugal' },
  sections: { late_interest_bps: '§4.6', exclusive: '§2.1' },
};
const formWith = (values = {}, sections = {}) => {
  const f = initialForm(STORED);
  return { values: { ...f.values, ...values }, sections: { ...f.sections, ...sections } };
};

test('the save sends exactly what was typed and changed: cents and bps converted, a cleared field null', () => {
  const r = buildSave(STORED, formWith(
    { late_interest_bps: '1.5', minimum_guarantee_cents: '', payment_terms_days: '30', exclusive: 'yes' },
    { late_interest_bps: '§4.7', exclusive: '', payment_terms_days: '§4.6' },
  ), '  Renegotiated at renewal  ');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.body, {
    terms: { late_interest_bps: 150, minimum_guarantee_cents: null, payment_terms_days: 30 },
    sections: { late_interest_bps: '§4.7', exclusive: null, payment_terms_days: '§4.6' },
    reason: 'Renegotiated at renewal',
  });
  // An untouched form sends nothing.
  assert.deepEqual(buildSave(STORED, formWith(), 'A reason'), { ok: false, errors: { form: 'Nothing has changed.' } });
});

test('a save without a reason is refused, and so is a bad value, naming its field', () => {
  const none = buildSave(STORED, formWith({ late_interest_bps: '2' }), '   ');
  assert.equal(none.ok, false);
  assert.match(none.errors.reason, /Say why/);
  const bad = buildSave(STORED, formWith({ late_interest_bps: '150' }), 'A reason');
  assert.equal(bad.ok, false);
  assert.match(bad.errors.late_interest_bps, /at most 100/);
  assert.equal(bad.body, undefined);
});

test('the form draws every section with its value, its unit and a Contract § beside it', () => {
  const html = render(TermsScheduleForm, { licence: LICENCE, stored: STORED, onSave: async () => {} });
  const text = renderedText(html);
  for (const s of termSections()) assert.ok(text.includes(s.title), s.title);
  for (const f of LICENCE_TERM_FIELDS) assert.ok(html.includes(`data-testid="term-row-${f.key}"`), f.key);
  assert.ok(text.includes('Now: EUR 5,000'), 'the minimum guarantee as money');
  assert.ok(text.includes('Now: 1%'), 'late interest as a percentage');
  assert.ok(text.includes(`Now: ${NOT_RECORDED}`), 'an unrecorded term reads Not recorded');
  assert.equal((html.match(/: contract section"/g) || []).length, LICENCE_TERM_FIELDS.length);
  assert.ok(html.includes('value="§4.6"'));
  assert.ok(text.includes('Reason for this change · kept in the licence\'s history'));
  assert.ok(text.includes('Save terms'));
  assert.ok(html.includes('value="1"'), 'late interest 100 bps reads 1 in its input');
});

test('a refused save says why, and a lapsed step-up says nothing was saved', () => {
  assert.match(saveError({ code: 'step_up_required', message: 'x' }), /Nothing was saved/);
  assert.equal(saveError({ code: 'invalid_terms', message: 'late_interest_bps must be whole basis points.' }), 'late_interest_bps must be whole basis points.');
  const SRC = codeOnly(read('frontend/src/pages/admin/LicenceTermsSchedule.jsx'));
  assert.ok(SRC.includes('licenceTermsApi.save(licence.uid, body)'), 'the save is D797\'s PUT');
  assert.ok(SRC.includes('onSaved?.()'), 'the page is told, so its history reloads');
});

// ───────────────────────────────────────────────────────────── the requests panel

const ROW = (o) => ({ status: 'open', subject_ref: 'lic_1', branch_code: 'hq', sla: 'ok', created_at: '2026-10-12 09:00:00', ...o });
const ROWS = [
  ROW({ uid: 'r_seat', kind: 'seat_increase', request: { seat_type: 'founder', seats: 20 } }),
  ROW({ uid: 'r_terms', kind: 'terms_change', request: { term: 'fee', current: 'EUR 90,000', asked: 'EUR 80,000' }, sla: 'due_soon' }),
  ROW({ uid: 'r_del', kind: 'delegate', request: { email: 'delegate@example.test', name: 'Delegate A' }, sla: 'past' }),
  ROW({ uid: 'r_nr', kind: 'non_renewal', request: {}, created_at: '2027-11-01 10:00:00' }),
  ROW({ uid: 'r_other_licence', kind: 'renewal', subject_ref: 'lic_2' }),
  ROW({ uid: 'r_answered', kind: 'renewal', status: 'answered' }),
  ROW({ uid: 'r_content', kind: 'content' }),
  ROW({ uid: 'r_branch', kind: 'renewal', subject_ref: null, branch_code: 'pt' }),
];

test('the panel lists only this licence\'s open requests of the new kinds', () => {
  assert.deepEqual(licenceRequests(ROWS, 'lic_1').map((r) => r.uid), ['r_seat', 'r_terms', 'r_del', 'r_nr']);
  assert.deepEqual(licenceRequests(ROWS, 'lic_1', 'pt').map((r) => r.uid), ['r_seat', 'r_terms', 'r_del', 'r_nr', 'r_branch']);
  assert.deepEqual(licenceRequests(ROWS, 'lic_2').map((r) => r.uid), ['r_other_licence']);
  assert.deepEqual(LICENCE_PANEL_KINDS, ['renewal', 'terms_change', 'seat_increase', 'delegate', 'non_renewal']);
});

test('the panel reads HQ\'s board through the existing route, open rows of each kind; an unreadable board is unknown', async () => {
  const saved = api.escalations;
  const calls = [];
  try {
    api.escalations = async (filter) => { calls.push(filter); return { available: true, items: ROWS.filter((r) => r.kind === filter.kind) }; };
    const all = await loadOpenRequests();
    assert.deepEqual(calls, LICENCE_PANEL_KINDS.map((kind) => ({ status: 'open', kind })));
    assert.equal(all.length, ROWS.filter((r) => LICENCE_PANEL_KINDS.includes(r.kind)).length);
    api.escalations = async () => ({ available: false, items: [] });
    assert.equal(await loadOpenRequests(), null);
  } finally { api.escalations = saved; }
});

test('each request shows its kind, date, band and what it asks; Answer opens the Support queue\'s own panel', () => {
  const items = licenceRequests(ROWS, 'lic_1');
  const base = { items, licence: LICENCE, noticeDays: 90, openUid: null, onToggle() {}, onRecorded() {}, onReload() {}, onOpenTerm() {}, onGrantAdmin() {} };
  const text = renderedText(render(RequestsPanelView, base));
  assert.ok(text.includes('Seats · Founder +20'));
  assert.ok(text.includes('Change · Fee'));
  assert.ok(text.includes('Delegate · Delegate A'));
  assert.ok(text.includes('2026-10-12'));
  assert.ok(text.includes('Within response time') && text.includes('Response due soon') && text.includes('Past response time'));
  assert.ok(text.includes('As it stands: Annual fee EUR 90,000'), 'the term as HQ\'s ledger holds it');
  assert.ok(text.includes('Asks for: EUR 80,000'));
  assert.ok(text.includes('Open terms') && text.includes('Grant admin'));
  assert.ok(text.includes('Licensed now: 60. Asks for 20 more.'));
  assert.ok(text.includes('Notice given 2027-11-01. Due by 2027-12-02 (90 days before 2028-03-01): in time.'));
  assert.ok(!text.includes('Record as answered'), 'no answer form until Answer is pressed');
  const open = renderedText(render(RequestsPanelView, { ...base, openUid: 'r_del' }));
  assert.ok(open.includes('Record as answered') && open.includes('Record as declined'));
  const SRC = codeOnly(read('frontend/src/pages/admin/LicenceRequestsPanel.jsx'));
  assert.ok(SRC.includes("import { EscalationDecision } from '../hq/HqSupportPage'"), 'Answer is the existing panel and route');
  assert.ok(codeOnly(read('frontend/src/pages/hq/HqSupportPage.jsx')).includes('api.escalationAnswer(item.uid,'));
  assert.equal(renderedText(render(RequestsPanelView, { ...base, items: null })).includes('unknown'), true);
  assert.equal(renderedText(render(RequestsPanelView, { ...base, items: [] })), 'No open requests from this licence\'s Administrator.');
});

test('Open terms goes to the term\'s row or its step; a notice of non-renewal is checked against the terms', () => {
  const keys = LICENCE_TERM_FIELDS.map((f) => f.key);
  assert.deepEqual(termTarget('late_interest_bps', keys), { tab: 'schedule', key: 'late_interest_bps' });
  assert.deepEqual(termTarget('fee', keys), { tab: 'terms', key: null });
  assert.deepEqual(termTarget('seats', keys), { tab: 'seats', key: null });
  assert.deepEqual(termTarget('territory', keys), { tab: 'territory', key: null });
  assert.equal(termAsItStands('seats', LICENCE), 'Founder 60');
  assert.equal(termAsItStands('territory', LICENCE), 'PT, ES');
  assert.equal(termAsItStands('term', LICENCE), '3 years, renews 2028-03-01');
  assert.deepEqual(nonRenewalCheck('2027-12-02T08:00:00Z', '2028-03-01', 90), { given_on: '2027-12-02', due_by: '2027-12-02', in_time: true, days_late: 0 });
  assert.deepEqual(nonRenewalCheck('2027-12-05', '2028-03-01', 90), { given_on: '2027-12-05', due_by: '2027-12-02', in_time: false, days_late: 3 });
  assert.deepEqual(nonRenewalCheck('2027-12-05', '2028-03-01', null), { given_on: '2027-12-05', due_by: null, in_time: null, days_late: null });
  assert.deepEqual(nonRenewalCheck('2027-12-05', null, 90).in_time, null);
});

test('the licence page mounts the schedule, the panel, and Grant admin prefills the existing appointment', () => {
  const SRC = codeOnly(read('frontend/src/pages/admin/AdminLicences.jsx'));
  assert.ok(SRC.includes('data-testid="licence-schedule-tab"'));
  assert.ok(SRC.includes('{step === SCHEDULE_STEP && <LicenceTermsSchedule licence={d} highlight={highlight} onSaved={refresh} />}'));
  assert.ok(SRC.includes('<LicenceRequestsPanel'));
  assert.ok(SRC.includes("onGrantAdmin={(g) => { setGrant(g); setStep(ADMINS_STEP); }}"));
  assert.ok(SRC.includes("{ email: prefill.email, admin_role: 'delegate',"), 'a delegate request prefills a delegate');
  assert.ok(SRC.includes('api.licenceAdminAdd('), 'the appointment is the existing POST');
});

// ───────────────────────────────────────────────────────────── the escalations console

test('the escalations console names the four new kinds and filters by them', () => {
  assert.deepEqual(LICENCE_REQUEST_KINDS, ['renewal', 'terms_change', 'delegate', 'non_renewal']);
  for (const k of LICENCE_REQUEST_KINDS) assert.ok(ESCALATION_KIND_LABELS[k], k);
  assert.equal(escalationKindLabel('terms_change'), 'change of terms');
  assert.equal(escalationKindLabel('non_renewal'), 'notice of non-renewal');
  assert.equal(escalationKindLabel('seat_increase'), 'seat increase', 'an older kind keeps its words');
  const items = [{ uid: 'a', kind: 'renewal' }, { uid: 'b', kind: 'moderation' }, { uid: 'c', kind: 'renewal' }];
  assert.deepEqual(kindFilters(items).map((f) => [f.kind, f.label, f.count]), [
    ['', 'All', 3], ['renewal', 'Renewal', 2], ['moderation', 'Moderation', 1],
    ['terms_change', 'Change of terms', 0], ['delegate', 'Delegate', 0], ['non_renewal', 'Notice of non-renewal', 0],
  ]);
  assert.deepEqual(filterByKind(items, 'renewal').map((i) => i.uid), ['a', 'c']);
  assert.equal(filterByKind(items, '').length, 3);

  const payload = { escalations: { available: true, count: 3, items: items.map((i) => ({ ...i, branch_code: 'hq', subject: '' })) } };
  const all = escalationCardProps(payload, false, { openUid: null, onToggle() {}, panelFor: () => null, kind: '' });
  assert.equal(all.count, 3);
  const one = escalationCardProps(payload, false, { openUid: null, onToggle() {}, panelFor: () => null, kind: 'renewal' });
  assert.deepEqual(one.items.map((i) => i.key), ['a', 'c']);
  assert.equal(one.count, 2);
  assert.equal(one.items[0].title, 'hq · renewal');
  assert.equal(one.items[0].meta, 'renewal');
  const chips = renderedText(render(EscalationKindFilter, { escalations: payload.escalations, value: 'renewal', onChange() {} }));
  assert.ok(chips.includes('Notice of non-renewal 0'));
  assert.equal(render(EscalationKindFilter, { escalations: { available: false }, value: '', onChange() {} }), '');
  assert.equal(requestSummary({ kind: 'renewal', request: { term_years: 3 } }), 'Renewal · 3 years');
});
