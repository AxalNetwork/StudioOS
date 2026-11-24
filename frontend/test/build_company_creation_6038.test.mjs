/**
 * D6038 (#6038; Build v2 BD11, BD25, BD26, BD29, BD30) — Company creation
 * starts from the company: Incorporate first with no company, else the entity
 * summary, one nearest-deadline filing, the 83(b) tracker, the filings with
 * where each is changed, documents with Stored or Missing, on desktop and phone.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_company_creation_6038.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import CompanyCreationHome from '../src/pages/cycles/CompanyCreationHome.jsx';
import build from '../src/pages/cycles/defs/build.jsx';
import { fnOf } from '../src/pages/cycles/adapters/index.js';
import { incorporateFirst, PROGRESSIVE } from '../src/pages/cycles/progressiveList.js';
import { moduleToolLinks } from '../src/pages/cycles/founderToolNavigation.js';
import {
  dateWords, documentsView, dominantView, electionView, filingRows, filingSource, summaryView,
} from '../src/pages/cycles/companyCreationModel.js';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/company-creation?project_id=7'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const founder = { role: 'founder', subscription_tier: 'growth' };

const cols = ['filing', 'jurisdiction', 'due', 'state', 'proof'].map((key) => ({ key, label: key }));
const row = (id, filing, state = 'Filed', proof = null) => ({ id, cells: { filing, jurisdiction: 'DE', due: '2026-10-09', state, proof } });
const RECORDS = {
  cols, total: 4, page: 1, page_size: 25, filters: [], sorts: [],
  rows: [row('lab-9-0', 'Order paid'), row('lab-9-2', 'Filed with state'), row('step-4', '83(b) election', 'Due in 8 days', 'Missing'), row('obligation-2', 'Synthetic annual report', 'Upcoming', 'Not expected yet')],
};
const ZERO = { cols, rows: [], total: 0, page: 1, page_size: 25, filters: [], sorts: [] };
const ADD = [{ text: 'Add filing', href: '/build/company-creation/new' }];
const ENTITY = {
  state: 'ok', has_company: true,
  name: { value: 'Synthetic Northline Inc', source: 'The incorporation order', reason: null },
  jurisdiction: { value: 'DE', source: 'The incorporation order', reason: null },
  registered_agent: { value: null, source: null, reason: 'No registered agent is recorded.' },
  formed_on: { value: '2026-10-09', source: 'The registry’s registration date, from the incorporation order', reason: null },
  order: { status: 'filed', status_label: 'Filed with state', track: 'v2', steps: [
    { key: 'paid', label: 'Order paid', date: '2026-10-01' }, { key: 'packet_ready', label: 'Packet ready', date: '2026-10-06' }, { key: 'filed', label: 'Filed with state', date: '2026-10-09' }] },
  ein: { state: 'issued', label: 'Issued', filing_id: 'step-3', number: null, number_reason: 'The EIN number is not stored; the letter can be.' },
};
const ELECTIONS = { state: 'ok', done: 1, total: 2, rows: [
  { holder_id: 1, name: 'Synthetic Founder A', you: true, grant_date: '2026-10-23', deadline: '2026-11-22', days_left: 8, mailed_on: null, status: 'pending', status_label: 'Pending', proof: 'Missing', filing_id: 'step-4', tracker: true, reason: null },
  { holder_id: 2, name: 'Synthetic Founder B', you: false, grant_date: '2026-10-01', deadline: '2026-10-31', days_left: -22, mailed_on: '2026-10-20', status: 'mailed', status_label: 'Mailed', proof: 'Stored', filing_id: null, tracker: true, reason: null },
] };
const PAPERS = { state: 'ok', company_uid: 'co-synthetic', stored: 1, total: 4, rows: [
  { kind: 'certificate_of_incorporation', label: 'Certificate of incorporation', state: 'Stored', at: '2026-10-12', by: 'Synthetic Founder A' },
  { kind: 'bylaws', label: 'Bylaws', state: 'Missing', at: null, by: null },
  { kind: 'tax_id_letter', label: 'Tax ID letter', state: 'Missing', at: null, by: null },
  { kind: 'registered_agent_agreement', label: 'Registered agent agreement', state: 'Missing', at: null, by: null },
] };
const NEXT = { id: 'step-4', title: '83(b) election', due: '2026-11-22', state: 'due_soon', text: 'Due in 8 days' };
const formed = (over = {}) => ({ module: { name: 'Company creation' }, card: { slug: 'company-creation', name: 'Company creation', state: 'ok', series: [] },
  records: RECORDS, facts: { entity: ENTITY, elections: ELECTIONS, papers: PAPERS, next_filing: NEXT, ip: null, incorporation: { entity: 'ccorp' }, ...over } });
const rowHref = (r) => `/build/company-creation/${r.id}?project_id=7`;
const props = (data, extra = {}) => ({ data, projectId: 7, records: data.records, recordsStatus: 'ready', add: ADD, rowHref, query: {}, search: '?project_id=7',
  tools: moduleToolLinks('build', 'company-creation', founder, '?project_id=7'), ...extra });

test('incorporateFirst: only a measured "no company" and a measured zero list, never an unread one', () => {
  const none = { entity: { state: 'ok', has_company: false } };
  assert.equal(incorporateFirst(none, ZERO), true);
  assert.equal(incorporateFirst({ entity: { state: 'ok', has_company: true } }, ZERO), false, 'an entity with no filings is a measured zero, not incorporate first');
  assert.equal(incorporateFirst({ entity: { state: 'unreadable' } }, ZERO), false, 'an unread summary is never "no company"');
  assert.equal(incorporateFirst(none, RECORDS), false, 'a filing on record means there is something');
  assert.equal(incorporateFirst(none, { cols, rows: [] }), false, 'no total is not a measured zero');
  assert.equal(incorporateFirst(none, ZERO, { q: 'x' }), false, 'a search keeps the table so it can be cleared');
  assert.equal(incorporateFirst(undefined, ZERO), false);
  assert.equal(PROGRESSIVE.build['company-creation'].incorporate.action, 'Start guided incorporation');
});

test('BD26: with no company, one state, Incorporate first, with the filing link second and a preview with no figures', () => {
  const data = { ...formed({ entity: { state: 'ok', has_company: false } }), records: ZERO };
  const out = html(h(CompanyCreationHome, props(data)));
  const t = text(out);
  assert.match(out, /data-testid="company-incorporate-first"/);
  assert.match(out, /data-testid="company-incorporate-action" href="\/incorporate"[^>]*>Start guided incorporation</);
  assert.match(out, /href="\/build\/company-creation\/new"[^>]*>Already incorporated elsewhere\? Add a filing</);
  assert.match(t, /What follows · preview/);
  assert.doesNotMatch(out, /company-summary|company-83b|cycle-records|company-next"/, 'nothing else competes with the first action');
  assert.doesNotMatch(t, /\d{4}|\d+ of \d+/, 'the preview carries no dates or counts');
});

test('BD25: summary, one nearest-deadline action, 83(b) tracker, filings, documents, steps and hand-off, in that order', () => {
  const out = html(h(CompanyCreationHome, props(formed())));
  const order = ['company-summary', 'company-next"', 'company-83b"', 'cycle-records', 'company-documents"', 'company-after', 'company-handoff'].map((k) => out.indexOf(k));
  assert.ok(order.every((n) => n > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const t = text(out);
  assert.match(t, /Synthetic Northline Inc/);
  assert.match(t, /9 Oct 2026 The registry’s registration date/);
  assert.match(t, /Registered agent ○ Not recorded No registered agent is recorded\./);
  assert.match(t, /EIN ✓ Issued The EIN number is not stored/);
  assert.match(t, /Order paid · 1 Oct 2026 .*Packet ready · 6 Oct 2026 .*Filed with state · 9 Oct 2026/);
  assert.equal((out.match(/data-testid="company-next-action"/g) || []).length, 1, 'one dominant action');
  assert.match(out, /data-testid="company-next-action" href="\/build\/company-creation\/step-4\?project_id=7"[^>]*>Open 83\(b\) election →</);
  assert.match(t, /Complete 83\(b\) election, due in 8 days/);
  assert.match(t, /Incorporation workspace: Delaware C-Corp/, 'facts.incorporation is still drawn');
  assert.match(t, /IP assignment .*No Lab IP record/, 'facts.ip is drawn, as Not recorded when absent');
});

test('BD25: the 83(b) tracker draws every founder\'s row, and the proof states reach the document list', () => {
  const out = html(h(CompanyCreationHome, props(formed())));
  assert.equal((out.match(/data-testid="company-83b-row"/g) || []).length, 2);
  const t = text(out);
  assert.match(t, /Synthetic Founder A You 23 Oct 2026 22 Nov 2026 8 days left Not mailed yet ◷ Pending ▲ Missing Open filing/);
  assert.match(t, /Synthetic Founder B Co-founder 1 Oct 2026 31 Oct 2026 .*Mailed 20 Oct 2026 ↗ Mailed ✓ Stored/);
  assert.match(t, /1 of 4 company papers stored · 1 of 2 83\(b\) proofs stored/);
  assert.match(out, /data-testid="company-doc" data-state="Stored"/);
  assert.match(out, /href="\/account\/portfolio\/co-synthetic"[^>]*>Upload</);
  assert.match(out, /href="\/build\/company-creation\/step-4\?project_id=7"[^>]*>Upload</, 'a missing 83(b) proof uploads on its filing');
  assert.match(t, /record, not tax advice/);
});

test('BD11 and BD27 B/C: each filing says who changes it, and Lab steps and Axal filings link where they are changed', () => {
  const rows = filingRows(RECORDS).rows;
  assert.deepEqual(rows.map((r) => r.cells.filing.note), ['Lab step · changed from your incorporation order', 'Lab step · changed from your incorporation order', 'Build filing · yours to edit', 'Set by Axal · only Axal changes it']);
  assert.equal(filingSource('x-1'), null);
  const out = html(h(CompanyCreationHome, props(formed())));
  assert.match(out, /href="\/raise\/legal-engine\/incorporation\?project_id=7"[^>]*>Open in the Legal engine →</);
  assert.match(out, /href="\/help\/tickets"[^>]*>Ask Axal to change one →</);
  const noAxal = html(h(CompanyCreationHome, props({ ...formed(), records: { ...RECORDS, rows: RECORDS.rows.slice(0, 3) } })));
  assert.doesNotMatch(noAxal, /Ask Axal to change one/, 'only the sources the list holds');
});

test('BD11: Add another filing, Legal documents and E-signature are supporting tools under the filings, drawn once', () => {
  const out = html(h(CompanyCreationHome, props(formed())));
  const t = text(out);
  assert.match(out, /data-testid="company-supporting"/);
  assert.match(t, /Supporting tools Add another filing Legal documents E-signature/);
  assert.doesNotMatch(out, /data-testid="records-add"/, 'the table\'s own Add gives way to the supporting tool');
  assert.ok(out.indexOf('cycle-records') < out.indexOf('company-supporting'));
  const body = fnOf(build.homes, 'company-creation')(formed(), { projectId: 7 });
  assert.equal(body.action, null, 'the header carries no action');
  assert.equal(body.body.drawsTools, true);
  const page = html(h(CycleModulePage, { cycle: 'build', slug: 'company-creation', data: formed(), status: 'ready', records: RECORDS, recordsStatus: 'ready', add: ADD,
    tools: moduleToolLinks('build', 'company-creation', founder, '?project_id=7'), home: body.body, query: {} }));
  assert.equal((page.match(/>Legal documents</g) || []).length, 1, 'the doors are not drawn again under the page');
  assert.doesNotMatch(page, /Open legal documents|Open e-signature/);
  assert.doesNotMatch(page, /data-testid="cycle-action"/);
});

test('BD29: each block fails on its own; Not recorded and Refused are words, never zeros', () => {
  const out = html(h(CompanyCreationHome, props(formed({ elections: { state: 'unreadable', rows: [], reason: '83(b) trackers could not be read. Filings still read.' },
    papers: { state: 'refused', rows: [], company_uid: null, reason: 'Only the company’s members can see its papers.' } }))));
  const t = text(out);
  assert.match(t, /83\(b\) trackers could not be read/);
  assert.match(out, /data-testid="company-summary" data-state="ok"/, 'the summary still draws');
  assert.match(out, /data-testid="cycle-records"/, 'the filings still draw');
  assert.match(out, /company-documents-refused/);
  assert.doesNotMatch(t, /0 of 0|company papers stored/);
  const unlinked = html(h(CompanyCreationHome, props(formed({ papers: { state: 'not_linked', rows: [], reason: 'Link this venture to its company to keep its papers here.' } }))));
  assert.match(text(unlinked), /Link this venture to its company to keep its papers here\. .*Link company/);
  const unread = html(h(CompanyCreationHome, props(formed({ entity: { state: 'unreadable', reason: 'The company summary could not be read. That is not the same as no company.' } }))));
  assert.match(unread, /data-testid="company-summary" data-state="unreadable"/);
  assert.doesNotMatch(unread, /company-incorporate-first/, 'an unread summary is never "no company"');
  const loading = html(h(CompanyCreationHome, { ...props(formed()), data: undefined, records: undefined, recordsStatus: undefined }));
  assert.match(loading, /data-testid="company-summary" data-state="loading"/);
  assert.doesNotMatch(loading, /company-incorporate-first/);
});

test('BD30: on phone the dominant action comes first, rows stack, and the page goes through PhoneModulePage', () => {
  const body = fnOf(build.homes, 'company-creation')(formed(), { projectId: 7 }).body;
  const out = html(h(PhoneModulePage, { cycle: 'build', slug: 'company-creation', data: formed(), status: 'ready', records: RECORDS, recordsStatus: 'ready', add: ADD,
    tools: moduleToolLinks('build', 'company-creation', founder, '?project_id=7'), home: body, query: {} }));
  assert.match(out, /data-phone="true"/);
  assert.ok(out.indexOf('company-next"') >= 0 && out.indexOf('company-next"') < out.indexOf('company-summary'), 'BD30 A: action, then summary');
  assert.doesNotMatch(out, /lg:grid-cols-\[1\.4fr/, 'the 83(b) rows are cards, not a table wider than the screen');
  assert.doesNotMatch(out, /phone-module-tool/, 'the doors are the supporting tools, not repeated');
  assert.match(text(out), /Proof missing/);
});

test('the model: dates, the dominant view, and proofs read from the 83(b) rows only', () => {
  assert.equal(dateWords('2026-10-09'), '9 Oct 2026');
  assert.equal(dateWords('2026-13-01'), null);
  assert.equal(dateWords(null), null);
  assert.equal(dominantView({ next_filing: null }), null);
  assert.equal(dominantView({ next_filing: { ...NEXT, state: 'overdue', text: 'Overdue' } }, rowHref).tone, 'bad');
  assert.equal(summaryView({ entity: ENTITY }).cells[2].value, '9 Oct 2026');
  assert.equal(electionView({ elections: { state: 'ok', rows: [], done: 0, total: 0 } }).state, 'empty');
  const docs = documentsView({ papers: PAPERS, elections: ELECTIONS }, 'ready', 7);
  assert.deepEqual(docs.proofs.map((p) => p.state), ['Missing', 'Stored']);
  assert.equal(documentsView({ papers: { state: 'unreadable' } }).state, 'unreadable');
});

test('BD29: a company with no filings yet is a measured zero: one first Add, no second "nearest deadline" action', () => {
  const out = html(h(CompanyCreationHome, props({ ...formed({ next_filing: null }), records: ZERO })));
  assert.match(out, /data-testid="company-summary" data-state="ok"/, 'not incorporate first: the company exists');
  assert.doesNotMatch(out, /company-incorporate-first/);
  assert.equal((out.match(/data-testid="records-zero-action"/g) || []).length, 1);
  assert.doesNotMatch(out, /data-testid="company-next"/);
  assert.doesNotMatch(out, /company-add-filing/);
});

