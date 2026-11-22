/**
 * D8259 (#8259, Build v2 BD28) — Company creation offers the filings Axal's
 * pack suggests for the company, each with "Add to my filings" (the existing
 * Add filing form, opened with the suggestion's values) and "Not now".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_suggested_filings_8259.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import CompanyCreationHome, { Suggested } from '../src/pages/cycles/CompanyCreationHome.jsx';
import { suggestionHref, suggestionsView } from '../src/pages/cycles/companyCreationModel.js';
import { addressFormFor, formsFor, suggestedFilingValues } from '../src/pages/cycles/forms.js';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/company-creation?project_id=7'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const ADD = { text: 'Add filing', href: '/build/company-creation/new?project_id=7', state: { under: '/build/company-creation?project_id=7' } };
const OK = {
  state: 'ok', pack: 'us_de_ccorp', pack_label: 'US Delaware C-Corp', source: 'the company record', already_added: 1, dismissed: 1,
  rows: [
    { key: 'us_de_ccorp:franchise_tax', title: 'Delaware franchise tax + annual report', kind: 'franchise_tax', jurisdiction: null, cadence: 'Yearly', due: '2027-03-01', due_reason: null, note: null },
    { key: 'us_de_ccorp:registered_agent', title: 'Registered agent renewal', kind: 'other', jurisdiction: null, cadence: 'Yearly', due: null, due_reason: 'Dated from the company’s formation date, which is not recorded.', note: null },
    { key: 'us_de_ccorp:annual_report', title: 'Federal corporate tax (Form 1120)', kind: 'annual_report', jurisdiction: 'Federal', cadence: 'Yearly', due: '2027-04-15', due_reason: null, note: null },
  ],
};

test('the view: each row says its date and days left, or why there is none, and how often; every state its own', () => {
  const v = suggestionsView({ suggestions: OK }, 'ready', '2026-11-22');
  assert.equal(v.state, 'ok');
  assert.equal(v.title, 'Suggested for your US Delaware C-Corp');
  assert.equal(v.line, '3 suggestions · from Axal’s US Delaware C-Corp pack');
  assert.equal(v.rows[0].line, 'Due 1 Mar 2027 · 99 days left · Yearly');
  assert.equal(v.rows[1].line, 'Dated from the company’s formation date, which is not recorded. · Yearly');
  assert.equal(v.rows[2].jurisdiction, 'Federal');
  assert.equal(suggestionsView({ suggestions: { ...OK, rows: [] } }).state, 'none', 'everything added or hidden: no block');
  assert.equal(suggestionsView({}).state, 'none', 'a read that carried no suggestions draws nothing');
  assert.equal(suggestionsView(null, 'loading').state, 'loading');
  const u = suggestionsView({ suggestions: { state: 'unreadable', rows: [], reason: 'Suggested filings could not be read. Your filings still read.' } });
  assert.deepEqual(u, { state: 'unreadable', reason: 'Suggested filings could not be read. Your filings still read.' });
  const none = suggestionsView({ suggestions: { state: 'no_pack', jurisdiction: 'GB', rows: [], reason: 'Axal has filing packs for US Delaware LLCs and C-Corps only.' } });
  assert.equal(none.title, 'Suggested for GB');
  assert.equal(none.heading, 'No suggested filings for GB yet');
  assert.equal(suggestionsView({ suggestions: { state: 'no_pack', jurisdiction: null, rows: [] } }).heading, 'No suggested filings yet');
});

test('Add to my filings opens the Add filing form at form=suggested with the suggestion’s values, the venture kept', () => {
  const [row] = suggestionsView({ suggestions: OK }, 'ready', '2026-11-22').rows;
  const href = suggestionHref(ADD.href, row);
  const url = new URL(href, 'https://x.invalid');
  assert.equal(url.pathname, '/build/company-creation/new');
  assert.equal(url.searchParams.get('project_id'), '7');
  assert.equal(url.searchParams.get('form'), 'suggested');
  assert.equal(url.searchParams.get('title'), 'Delaware franchise tax + annual report');
  assert.equal(url.searchParams.get('kind'), 'franchise_tax');
  assert.equal(url.searchParams.get('due_date'), '2027-03-01');
  assert.equal(url.searchParams.has('jurisdiction'), false);
  const fed = new URL(suggestionHref(ADD.href, suggestionsView({ suggestions: OK }).rows[2]), 'https://x.invalid');
  assert.equal(fed.searchParams.get('jurisdiction'), 'Federal');
  assert.equal(new URL(suggestionHref(ADD.href, suggestionsView({ suggestions: OK }).rows[1]), 'https://x.invalid').searchParams.has('due_date'), false, 'no date is invented');
  assert.equal(suggestionHref(null, row), null);
  assert.equal(suggestionHref('https://elsewhere.invalid/new', row), null, 'only this app’s own address');
});

test('the form: the existing filing form and write, with the suggestion’s name, and no Add button of its own', async () => {
  const [plain, ...others] = formsFor('build', 'company-creation');
  assert.equal(plain.key, 'filing');
  assert.deepEqual(others, [], 'the module still has one Add: Add filing');
  const form = addressFormFor('build', 'company-creation', 'suggested');
  assert.equal(form.key, 'suggested');
  assert.equal(addressFormFor('build', 'company-creation', 'filing'), null);
  assert.equal(addressFormFor('build', 'founding-team', 'suggested'), null);
  assert.equal(addressFormFor('build', '__proto__', 'suggested'), null);
  assert.deepEqual(form.fields.map((f) => f.name), ['title', ...plain.fields.map((f) => f.name)]);
  const q = new URLSearchParams('title=Registered%20agent%20renewal&kind=other&jurisdiction=Federal&due_date=2027-01-15&for_holder_id=h-9');
  assert.deepEqual(suggestedFilingValues(q), { title: 'Registered agent renewal', kind: 'other', jurisdiction: 'Federal', due_date: '2027-01-15' });
  assert.deepEqual(suggestedFilingValues(new URLSearchParams('kind=83b&jurisdiction=Mars&due_date=soon')), {}, 'only a suggestion’s own values');
  const body = form.toBody({ title: ' Registered agent renewal ', kind: 'other', jurisdiction: '', due_date: '2027-01-15', state: 'upcoming' });
  assert.deepEqual(body, { kind: 'other', jurisdiction: null, due_date: '2027-01-15', for_holder_id: null, state: 'upcoming', title: 'Registered agent renewal' });
  const sent = [];
  const uploads = [];
  const w = { build: { formationStep: async (...a) => { sent.push(a); return { id: 5 }; } }, recordAction: async (...a) => { uploads.push(a); return {}; } };
  const file = { name: 'receipt.pdf' };
  assert.deepEqual(await form.submit(w, 7, { title: 'Registered agent renewal', kind: 'other', state: 'upcoming', proof: file }, { idempotencyKey: 'key-8259-abcdef' }), { id: 5 });
  assert.equal(sent[0][0], 7);
  assert.equal(sent[0][1].title, 'Registered agent renewal');
  assert.equal(sent[0][1].kind, 'other');
  assert.equal(sent[0][2], 'key-8259-abcdef');
  assert.equal(uploads[0][3], 'step-5', 'the proof goes to the filing it made, as Add filing’s does');
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.equal(form.addressOnly, true);
  assert.match(route, /const extra = own\.length \? addressFormFor\(cycle, slug, formKey\) : null;\n    return extra \? \[\.\.\.own, extra\] : own;/, '?form=suggested opens it');
  assert.match(route, /\.filter\(\(_, i\) => !forms\[i\]\.addressOnly\)/, 'and it draws no Add button');
});

test('the block: rows with Add to my filings and Not now; read only without an Add; BD28 B; unreadable', () => {
  const view = suggestionsView({ suggestions: OK }, 'ready', '2026-11-22');
  const out = html(h(Suggested, { view, add: ADD, projectId: 7 }));
  assert.equal((out.match(/data-testid="company-suggestion"/g) || []).length, 3);
  assert.equal((out.match(/data-testid="company-suggestion-add"/g) || []).length, 3);
  assert.equal((out.match(/data-testid="company-suggestion-dismiss"/g) || []).length, 3);
  assert.match(out, /href="\/build\/company-creation\/new\?project_id=7&amp;form=suggested&amp;title=Delaware/);
  assert.match(out, /aria-label="Not now: Registered agent renewal"/);
  assert.match(text(out), /Nothing is filed\. “Not now” hides the suggestion for this venture\./);
  const ro = html(h(Suggested, { view, add: null, projectId: 7 }));
  assert.equal((ro.match(/data-testid="company-suggestion"/g) || []).length, 3, 'a read-only viewer still sees the list');
  assert.doesNotMatch(ro, /company-suggestion-add|company-suggestion-dismiss/);
  const none = html(h(Suggested, { view: suggestionsView({ suggestions: { state: 'no_pack', jurisdiction: 'GB', rows: [], reason: 'Axal has filing packs for US Delaware LLCs and C-Corps only. Add your own filings with Add another filing.' } }), add: ADD, projectId: 7 }));
  assert.match(none, /data-testid="company-suggested-none"/);
  assert.match(text(none), /No suggested filings for GB yet/);
  assert.doesNotMatch(none, /company-suggestion-add/);
  const bad = html(h(Suggested, { view: suggestionsView({ suggestions: { state: 'unreadable', rows: [], reason: 'Suggested filings could not be read.' } }), add: ADD, projectId: 7 }));
  assert.match(text(bad), /Suggested filings could not be read/);
  assert.equal(html(h(Suggested, { view: { state: 'none' }, add: ADD, projectId: 7 })), '');
});

test('the page draws the suggestions between the 83(b) tracker and the filings, and not before a company exists', () => {
  const cols = ['filing', 'jurisdiction', 'due', 'state', 'proof'].map((key) => ({ key, label: key }));
  const records = { cols, rows: [{ id: 'step-1', cells: { filing: 'EIN', jurisdiction: 'Federal', due: null, state: 'Upcoming', proof: null } }], total: 1, page: 1, page_size: 25, filters: [], sorts: [] };
  const facts = { entity: { state: 'ok', has_company: true, name: { value: 'Synthetic Co' }, jurisdiction: { value: 'DE' }, registered_agent: {}, formed_on: {}, order: null, ein: { state: 'not_recorded' } },
    elections: { state: 'ok', rows: [], done: 0, total: 0 }, papers: { state: 'not_linked', rows: [] }, suggestions: OK, next_filing: null };
  const page = html(h(CompanyCreationHome, { data: { facts, records }, projectId: 7, records, recordsStatus: 'ready', add: [ADD], query: {}, search: '?project_id=7', rowHref: () => null }));
  const at = (id) => page.indexOf(`data-testid="${id}"`);
  assert.ok(at('company-suggested') > at('company-83b'), 'after the 83(b) tracker');
  assert.ok(at('cycle-records') > 0 && at('company-suggested') < at('cycle-records'), 'before the filings table');
  const first = html(h(CompanyCreationHome, { data: { facts: { ...facts, entity: { state: 'ok', has_company: false } }, records: { ...records, rows: [], total: 0 } }, projectId: 7,
    records: { ...records, rows: [], total: 0 }, recordsStatus: 'ready', add: [ADD], query: {}, rowHref: () => null }));
  assert.match(first, /company-incorporate-first/);
  assert.doesNotMatch(first, /company-suggested/, 'Incorporate first is the one state with no company');
});
