/**
 * D7180 (#7180, D7046) — the Research › Companies profile, built to boards
 * RS-18 A to RS-18 F: sourced metric cards whose unknown observation date
 * reads Not recorded and never the update date, the record drawer, evidence
 * collections with their own state and Retry, Sector peers by the Worker's
 * printed rule, the CTA that opens setup with the company as its subject,
 * and the candidate's Signals on every width, company apart from context.
 *
 * The Worker half is cloudflare-worker/test/research_company_profile_7180.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { analysisHref } from '../src/lib/companyDirectoryView.js';
import {
  EVIDENCE_COLLECTIONS, METRICS, cellText, metricEvidence, notRecordedFields, observedText, peerRuleText,
  recordFields, replaceCollection, signalDate,
} from '../src/pages/research/companyProfileRead.js';
import {
  EvidenceCollection, KeyMetrics, KindBadge, MetricEvidenceBody, NotRecordedGroup, SectorPeers,
} from '../src/pages/research/CompanyEvidence.jsx';
import CandidateSignals from '../src/pages/research/CandidateSignals.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const render = (C, props) => renderedText(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props))));
const noop = () => {};

const FUNDING = {
  status: 'recorded', value: 24_000_000, currency: 'USD', publisher: 'Funding register', url: 'https://register.example/h',
  provenance: 'field_citation', confidence: 'medium', confidence_basis: 'directory_record',
  observed_on: null, observed_basis: null, updated_on: '2026-11-02',
};

test('the CTA opens setup with the company as its subject (D7175 carries the subject)', () => {
  const href = analysisHref({ uid: 'q42', name: 'Halden Grid', website: 'https://haldengrid.example', sector: 'energy storage', country: 'Norway' });
  const q = new URL(href, 'https://x.example').searchParams;
  assert.equal(new URL(href, 'https://x.example').pathname, '/research/companies');
  assert.deepEqual([q.get('tab'), q.get('company'), q.get('name'), q.has('website')], ['analyses', 'q42', 'Halden Grid', false]);
  const profile = read('frontend/src/pages/research/CompanyProfile.jsx');
  assert.match(profile, /Set up competitor analysis →/);
  assert.doesNotMatch(profile, /Run competitor analysis/);
});

test('an unknown observation date reads Not recorded and never borrows the update date', () => {
  assert.equal(observedText(FUNDING), null);
  assert.equal(observedText({ observed_on: '2025-03-14', observed_basis: 'announced' }), '2025-03-14 · announced');
  const t = render(KeyMetrics, { d: { metrics: { funding_total: FUNDING } }, onInspect: noop });
  assert.match(t, /Funding total\s*Date partial\s*USD 24M/);
  assert.match(t, /Publisher\s*Funding register/);
  assert.match(t, /Observed\s*Not recorded\s*Updated\s*2026-11-02/);
  assert.doesNotMatch(t, /Observed\s*2026-11-02/);
  const dated = render(KeyMetrics, { d: { metrics: { funding_total: { ...FUNDING, observed_on: '2026-10-01' } } }, onInspect: noop });
  assert.match(dated, /Observed\s*2026-10-01\s*Updated\s*2026-11-02/);
  assert.doesNotMatch(dated, /Date partial/);
});

test('the record drawer separates Observed from Updated, and names a shared rating as shared', () => {
  const spec = METRICS.find((m) => m.key === 'funding_total');
  const d = { funding_rounds: { status: 'ok', rows: [{ round_type: 'Series A', amount: 18e6, currency: 'USD' }] },
    sources: { status: 'ok', rows: [{ field_name: 'funding_total', source_name: 'Funding register', publication_date: '2026-10-28' }, { field_name: 'revenue', source_name: 'X' }] } };
  const ev = metricEvidence(spec, d);
  assert.deepEqual([ev.rows.length, ev.citations.length], [1, 1], 'only the citation that names this field');
  const t = render(MetricEvidenceBody, { spec, m: FUNDING, ev });
  assert.match(t, /Observed\s*Not recorded\s*The publisher gives no observation date for this figure\./);
  assert.match(t, /Updated\s*2026-11-02\s*When the directory record was last updated\. Not the date the figure was true\./);
  assert.match(t, /Confidence\s*medium · one rating for every metric on this record/);
  assert.match(t, /cited for this figure/);
  assert.match(t, /Round: Series A · Announced: Not recorded/);
  assert.match(t, /funding_total · Funding register · published 2026-10-28/);
});

test('records: a blank field is Not recorded and a recorded zero is 0', () => {
  const fin = EVIDENCE_COLLECTIONS.find((c) => c.key === 'financials');
  const row = { period: 'FY2025', revenue: 38_400_000, revenue_currency: 'NOK', revenue_growth: null, ebitda: null, cash: 52e6, debt: 0, source_name: 'Accounts', source_url: null };
  const debt = fin.columns.find((c) => c[0] === 'debt');
  const growth = fin.columns.find((c) => c[0] === 'revenue_growth');
  assert.equal(cellText(row, debt), 'NOK 0');
  assert.equal(cellText(row, growth), 'Not recorded');
  const fields = recordFields(row);
  assert.deepEqual(fields.find((f) => f.key === 'debt'), { key: 'debt', label: 'Debt', value: '0', recorded: true, url: null });
  assert.deepEqual(fields.find((f) => f.key === 'ebitda').value, 'Not recorded');
  assert.equal(fields.length, Object.keys(row).length, 'the drawer lists every column of the row');
  const t = render(EvidenceCollection, { collection: fin, data: { status: 'ok', rows: [row] }, name: 'Halden Grid', open: true, onToggle: noop, onInspect: noop, onRetry: noop });
  assert.match(t, /Financial statements for Halden Grid/, 'the table has a caption');
  assert.match(t, /NOK 0/);
  assert.match(t, /Inspect/);
});

test('a collection has its own state: Unavailable with its own Retry, None apart from it', () => {
  const emp = EVIDENCE_COLLECTIONS.find((c) => c.key === 'employment');
  const failed = render(EvidenceCollection, { collection: emp, data: { status: 'unreadable', rows: [] }, name: 'X', open: true, onToggle: noop, onInspect: noop, onRetry: noop });
  assert.match(failed, /Unavailable · read failed/);
  assert.match(failed, /This is not zero\./);
  assert.match(failed, /Retry employment observations/);
  const none = render(EvidenceCollection, { collection: emp, data: { status: 'ok', rows: [] }, name: 'X', open: true, onToggle: noop, onInspect: noop, onRetry: noop });
  assert.match(none, /None\s*0 records/);
  assert.match(none, /the read succeeded and holds no observation/);
  assert.doesNotMatch(none, /Unavailable/);
  const data = { item: {}, employment: { status: 'unreadable', rows: [] }, sources: { status: 'ok', rows: [{ a: 1 }] } };
  const next = replaceCollection(data, 'employment', { status: 'ok', rows: [{ b: 2 }] });
  assert.deepEqual([next.employment.rows, next.sources, next.item], [[{ b: 2 }], data.sources, data.item], 'only that collection is replaced');
  const profile = read('frontend/src/pages/research/CompanyProfile.jsx');
  assert.match(profile, /researchCompaniesApi\.part\(uid, key\)/);
  assert.match(read('frontend/src/lib/api/researchCompanies.js'), /part: \(uid, part\) => request\(`\/research\/company-directory\/\$\{encodeURIComponent\(uid\)\}\$\{qs\(\{ part \}\)\}`\)/);
});

test('sector peers: renamed, the Worker\'s rule printed, cards with no minimum width', () => {
  const rule = { sector_label: 'energy storage', country: 'Norway', match: 'same_sector_label', order: ['same_country', 'name'], limit: 8 };
  assert.equal(peerRuleText(rule, {}, 8, 11), 'Same sector label “energy storage” (case and spaces ignored) · same country (Norway) first, then by name · 8 of 11 shown');
  assert.match(peerRuleText({ ...rule, country: null }, {}, 3, 3), /by name; this company’s country is not recorded/);
  const peers = { status: 'ok', total: 2, rule, rows: [{ uid: 'b', name: 'Brightwell', country: 'Norway', same_country: 1 }, { uid: 't', name: 'Tidewater', country: null }] };
  const t = render(SectorPeers, { item: { sector: 'energy storage', country: 'Norway' }, peers });
  assert.match(t, /Sector peers\s*2/);
  assert.match(t, /Matching rule\s*Same sector label “energy storage”/);
  assert.match(t, /Sector peers are not competitors\./);
  assert.match(t, /Country not recorded/);
  assert.match(t, /Website: not recorded/);
  assert.doesNotMatch(t, /Competitors/);
  const src = read('frontend/src/pages/research/CompanyEvidence.jsx');
  assert.doesNotMatch(src, /min-w-\[\d+px\]/, 'no minimum width on peer cards or record tables');
  assert.doesNotMatch(read('frontend/src/pages/research/CompanyProfile.jsx'), /min-w-\[\d+px\]|>Competitors</);
});

test('unknown optional fields are one Not recorded line; a missing website joins it', () => {
  assert.deepEqual(notRecordedFields({ website: 'https://x.example' }).map((f) => f[0]), ['Description', 'Logo', 'Investors']);
  assert.deepEqual(notRecordedFields({ website: '' }).map((f) => f[0]), ['Website', 'Description', 'Logo', 'Investors']);
  const open = render(NotRecordedGroup, { fields: notRecordedFields({}), defaultOpen: true });
  assert.match(open, /Not recorded · 4 fields\s*Website · Description · Logo · Investors/);
  assert.match(open, /Website\s*Not recorded · no source lists one/);
  assert.match(render(KindBadge, { kind: 'directory' }), /▣Directory company/);
  assert.match(render(KindBadge, { kind: 'candidate' }), /◎Analysis candidate/);
});

test('a signal shows when it was observed, or when it was recorded and says so', () => {
  assert.deepEqual(signalDate({ observed_on: '2026-11-01', created_at: '2026-11-09 14:20:00' }), { label: 'Observed', date: '2026-11-01', note: null });
  assert.deepEqual(signalDate({ observed_on: '', created_at: '2026-11-09 14:20:00' }), { label: 'Recorded', date: '2026-11-09', note: 'observed date: not recorded' });
  assert.deepEqual(signalDate({}), { label: 'Date', date: 'Not recorded', note: null });
});

test('the candidate shows Signals on every width, company signals apart from context', () => {
  const t = render(CandidateSignals, { name: 'Brightwell', directoryUid: null,
    signals: [{ id: 's1', signal_type: 'pricing', label: 'Public pricing', detail: 'utility systems', created_at: '2026-11-09 14:20:00' }] });
  assert.match(t, /About Brightwell\s*· from this analysis’s crawl/);
  assert.match(t, /Public pricing — utility systems\s*Recorded 2026-11-09 · observed date: not recorded/);
  assert.match(t, /Context · not about this company/);
  assert.match(t, /Context · Not applicable\s*Not linked to a directory company/);
  const empty = render(CandidateSignals, { name: 'X', directoryUid: null, signals: [] });
  assert.match(empty, /None\s*The crawl recorded no signal for this company\./);
  const page = read('frontend/src/pages/research/CompanyCandidate.jsx');
  assert.match(page, /<CandidateSignals name=\{candidate\.name\} signals=\{signals\} directoryUid=\{candidate\.directory_uid \|\| null\} \/>/);
  assert.doesNotMatch(page, /signals\.length > 0 && \(\s*<Card className="hidden md:block">/, 'Signals are no longer hidden below md');
  const sig = read('frontend/src/pages/research/CandidateSignals.jsx');
  assert.match(sig, /researchCompaniesApi\.get\(directoryUid\)/, 'context is read through the directory profile');
});
