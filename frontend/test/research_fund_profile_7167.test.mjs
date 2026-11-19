/**
 * D7167 (#7167) — Research › Funds profile, rendered with react-dom/server:
 * one provenance object makes the same chip in the Sheet, the profile and the
 * comparison; three dates kept apart; amounts in the currency the list
 * reported; the proposed fields with their reasons; the manager's vehicles by
 * label and the size of this vehicle alone; the shortlist matched on
 * catalogue_uid; the 410 re-read clearing the facts; "Unavailable" on screen.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_fund_profile_7167.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import FundCatalogProfile from '../src/pages/research/FundCatalogProfile.jsx';
import { api } from '../src/lib/api.js';
import { researchFundsApi } from '../src/lib/api/researchFunds.js';
import { researchMyFundsApi } from '../src/lib/api/researchMyFunds.js';
import { mountContracts } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { FundDirectoryView } from '../src/pages/research/FundDirectory.jsx';
import { FundCatalogView } from '../src/pages/research/FundCatalogProfile.jsx';
import { EMPTY_QUERY } from '../src/pages/research/fundDirectoryRead.js';
import {
  ACTIONS, amount, backTo, datesOf, day, historyView, proposedRows, rereadBeforeAction, shortlistMatch, sourceChip,
} from '../src/pages/research/fundProfileRead.js';
import { COMPARISON_ERRORS, cellView } from '../src/pages/research/researchComparisons.js';

const EUR = 'EuroTech VC Funds (public spreadsheet)';
const PROV = {
  list_name: EUR, list_title: 'Euro Tech VC Funds (from 1/2016)', publisher: '@Euro_VC', published_url: 'https://list.example/eu',
  reported_on: '2023-09-25', imported_on: '2026-10-04', reviewed_on: '2026-10-07', verdict: 'cite only',
};
const NR = (reason) => ({ status: 'not_recorded', reason });
const PROPOSED = {
  manager_name: { status: 'recorded', value: 'Dawn Capital', provenance: PROV },
  investment_stage: NR('The directory records no investment stage for this vehicle.'),
  investment_geography: NR('No source states where this vehicle invests. Headquarters is where the manager is based.'),
  initial_cheque: NR('No source states an initial cheque for this vehicle.'),
};
const OPP = {
  uid: 'dawncapital-opp', name: 'Dawn Capital Opp', website: 'https://dawncapital.com', linkedin: null, hq: 'UK', fund_number: 'Opp',
  fund_size_cents: 7_500_000_000, size_currency: 'EUR', fund_date: '2023-09-25', quarter: '2023-Q3', fund_year: 2023,
  sector_focus: 'B2B-Software', notable_lps: null, eif: null, eifo: null, source_name: EUR, source_url: 'https://repo.example/eu.csv',
  as_of: '2026-10-04', source: { name: EUR, reason: 'Cited with a link.' }, provenance: PROV, proposed: PROPOSED,
};
const HISTORY = {
  manager: 'Dawn Capital', vehicles_status: 'ok', observations_status: 'ok', unlabelled_reports: 4,
  vehicles: [
    { uid: 'dawncapital-v', label: 'V', fund_size_cents: 58_200_000_000, size_currency: 'EUR', current: false, provenance: PROV },
    { uid: 'dawncapital-opp', label: 'Opp', fund_size_cents: 7_500_000_000, size_currency: 'EUR', current: true, provenance: PROV },
  ],
  observations: [{ period: '2023-Q3', reported_on: '2023-09-25', fund_size_cents: 7_500_000_000, size_currency: 'EUR', provenance: PROV }],
};
const page = (props) => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundCatalogView, props)));
  return { html, text: renderedText(html) };
};
const ready = { loading: false, error: null, status: 200, data: { item: OPP, history: HISTORY, reports: [], reports_status: 'ok', source_boundary: 'Reported snapshots only.' } };

test('one chip, three dates: publisher and reported date; Reported, Imported on and Source use reviewed never merged', () => {
  assert.equal(day('2023-09-25'), '25 Sep 2023');
  assert.equal(day(''), null);
  assert.equal(sourceChip(PROV), '@Euro_VC · reported 25 Sep 2023');
  assert.equal(sourceChip({ ...PROV, publisher: null, reported_on: null }), 'Euro Tech VC Funds (from 1/2016) · reported date not recorded');
  // Mutation checked: read every date from imported_on → the three texts are equal.
  assert.deepEqual(datesOf(PROV).map((d) => [d.label, d.text]),
    [['Reported', '25 Sep 2023'], ['Imported on', '4 Oct 2026'], ['Source use reviewed', '7 Oct 2026']]);
  assert.deepEqual(datesOf({ ...PROV, reviewed_on: null, verdict: null }).map((d) => d.text)[2], 'Not recorded');
});

test('amounts stay in the currency the list reported: EUR and USD, never converted; an unknown currency is no figure', () => {
  assert.equal(amount(7_500_000_000, 'EUR'), '€75m');
  assert.equal(amount(18_500_000_000, 'USD'), 'US$185m');
  assert.equal(amount(50_000_000, 'EUR'), '€500k');
  // Mutation checked: default an unknown currency to EUR → '€75m'.
  assert.equal(amount(7_500_000_000, null), null);
  assert.equal(amount(null, 'EUR'), null);
});

test('the proposed fields: recorded with a chip, Not recorded with its reason, a failed read Unavailable', () => {
  const rows = proposedRows({ ...PROPOSED, initial_cheque: { status: 'recorded', value: { min_cents: 50_000_000, max_cents: 300_000_000, currency: 'EUR' }, provenance: PROV } },
    ['manager_name', 'investment_geography', 'initial_cheque']);
  assert.deepEqual(rows.map((r) => [r.label, r.state, r.text]), [
    ['Manager', 'recorded', 'Dawn Capital'], ['Investment geography', 'not_recorded', 'Not recorded'], ['Initial cheque range', 'recorded', '€500k–€3m'],
  ]);
  assert.equal(rows[0].chip, '@Euro_VC · reported 25 Sep 2023');
  // Mutation checked: treat an unavailable field as not recorded → 'not_recorded'.
  assert.deepEqual(proposedRows({ investment_stage: { status: 'unavailable', reason: 'Unavailable' } }, ['investment_stage'])[0].state, 'unavailable');
});

test('the history: vehicles by label, this vehicle marked; its own observations only, unlabelled ones counted', () => {
  const v = historyView(HISTORY, OPP);
  assert.deepEqual(v.vehicles.rows.map((r) => [r.label, r.size, r.current]), [['V', '€582m', false], ['Opp', '€75m', true]]);
  assert.deepEqual(v.observations.rows.map((o) => [o.when, o.text]), [['25 Sep 2023', '€75m']]);
  assert.equal(v.observations.unlabelled, 4);
  assert.equal(historyView({ vehicles_status: 'not_recorded', vehicles_reason: 'r' }).vehicles.state, 'not_recorded');
  // Two vehicles the list labels alike are told apart by vintage; a unique label is left as written.
  // Mutation checked: drop the vintage suffix → both read 'Opp'.
  const alike = historyView({ vehicles: [{ uid: 'a', label: 'Opp', fund_year: 2023 }, { uid: 'b', label: 'Opp', fund_year: 2021 }, { uid: 'c', label: 'V', fund_year: 2023 }] });
  assert.deepEqual(alike.vehicles.rows.map((r) => r.label), ['Opp (2023)', 'Opp (2021)', 'V']);
});

test('the shortlist is matched on catalogue_uid, so one manager\'s other vehicle never reads as saved', () => {
  const items = [{ uid: 'rf_1', name: 'Dawn Capital', catalogue_uid: 'dawncapital-v' }];
  // Mutation checked: match on the normalised name → Opp reads as saved.
  assert.equal(shortlistMatch(items, 'dawncapital-opp'), null);
  assert.equal(shortlistMatch(items, 'dawncapital-v').uid, 'rf_1');
  assert.equal(shortlistMatch(undefined, 'x'), null);
});

test('Save, Add and Compare re-read the fund: a 410 is a withdrawal, any other failure is not', async () => {
  const removed = { name: 'Taken down', reason: 'Its terms forbid republishing.' };
  const gone = await rereadBeforeAction(async () => { throw Object.assign(new Error('Removed'), { status: 410, data: { removed, reason: 'Taken down.' } }); }, 'x');
  assert.deepEqual(gone, { ok: false, withdrawn: true, removed, reason: 'Taken down.' });
  const down = await rereadBeforeAction(async () => { throw Object.assign(new Error('x'), { status: 503 }); }, 'x');
  assert.deepEqual([down.ok, down.withdrawn], [false, false]);
  assert.deepEqual(await rereadBeforeAction(async (uid) => ({ uid }), 'y'), { ok: true, data: { uid: 'y' } });
});

test('Back to results returns to the directory address the Sheet was opened from, and nowhere else', () => {
  assert.equal(backTo({ back: '/research/funds?view=directory&focus=fintech&offset=25' }), '/research/funds?view=directory&focus=fintech&offset=25');
  assert.equal(backTo({ back: 'https://elsewhere.example/' }), '/research/funds?view=directory');
  assert.equal(backTo(null), '/research/funds?view=directory');
});

test('the profile: vehicle first, dated native size with its chip, the three dates, vehicles by label, this vehicle alone', () => {
  const { html, text } = page({ fund: ready, list: { loading: false, error: null, existing: null }, onAdd() {}, back: '/research/funds?view=directory&q=dawn' });
  assert.match(text, /Fund vehicle · public directoryDawn Capital OppManaged by Dawn Capital · vintage 2023/);
  assert.match(text, /Reported size€75m EUR@Euro_VC · reported 25 Sep 2023/);
  assert.match(text, /Manager HQUKWhere the manager is based/);
  assert.match(text, /Reported25 Sep 2023When @Euro_VC recorded this figure/);
  assert.match(text, /Imported on4 Oct 2026When Axal VC copied the list row/);
  assert.match(text, /Source use reviewed7 Oct 2026Cite only: named and linked on every fact/);
  assert.match(text, /Investment geographyNot recordedNo source states where this vehicle invests\. Headquarters is where the manager is based\./);
  assert.match(text, /Vehicles by Dawn CapitalV€582m EUR/);
  assert.match(text, /Opp€75m EURreported 25 Sep 2023This vehicle/);
  assert.match(text, /4 older reports name no vehicle, so they are not shown here\./);
  assert.match(html, /<a[^>]*href="\/research\/funds\?view=directory&amp;q=dawn"[^>]*>[\s\S]*?Back to results<\/a>/);
  assert.match(html, /<button[^>]*>(<svg[\s\S]*?<\/svg>)? Save to shortlist<\/button>/);
  assert.doesNotMatch(text, /Unreadable|Add to my funds/);
  // Saved: Open dossier → in the button's place.
  const saved = page({ fund: ready, list: { loading: false, error: null, existing: { uid: 'rf_1' } } });
  assert.match(saved.html, /<a[^>]*href="\/research\/funds\/rf_1"[^>]*>Open dossier →<\/a>/);
});

test('withdrawn while reading: the profile and the Sheet clear the facts and offer no action', () => {
  const removed = { name: 'Taken down', title: 'Deep Tech Investors Mapping', publisher: 'Hello Tomorrow', url: 'https://list.example/down', reason: 'Its terms forbid republishing.', reviewed_on: '2026-10-07' };
  const { text } = page({ fund: { loading: false, error: 'Withdrawn', status: 410, data: null, removed, reason: 'Taken down.', during: true } });
  assert.match(text, /WithdrawnThis fund’s source list was withdrawn while you were reading/);
  assert.match(text, /Nothing was saved\./);
  assert.doesNotMatch(text, /Reported size|Save to shortlist|Dawn Capital/);
  const sheet = renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundDirectoryView, {
    query: EMPTY_QUERY, onQuery() {}, search: '', onSearch() {}, facets: null, onSelect() {}, onClose() {},
    result: { loading: false, error: null, data: { items: [OPP], total: 1, limit: 25, offset: 0, sources: [], removed_sources: [] } },
    selected: OPP, onAdd() {},
    drawer: { loading: false, error: 'Withdrawn', status: 410, data: null, removed, reason: 'Taken down.', during: true },
  }))));
  const panel = sheet.slice(sheet.lastIndexOf('Fund vehicle'));
  // Mutation checked: keep the facts on a 410 → "Reported size" and the save are in the panel.
  assert.match(panel, /This fund’s source list was withdrawn while you were reading/);
  assert.match(panel, /Save, Add and Compare are no longer offered\. Nothing was saved\./);
  assert.doesNotMatch(panel, /Reported size|Save to shortlist|Open full profile/);
});

test('the Sheet offers the three action names and carries the list context to the profile', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundDirectoryView, {
    query: EMPTY_QUERY, onQuery() {}, search: '', onSearch() {}, facets: null, onSelect() {}, onClose() {},
    result: { loading: false, error: null, data: { items: [OPP], total: 1, limit: 25, offset: 0, sources: [], removed_sources: [] } },
    selected: OPP, onAdd() {}, drawer: { loading: false, error: null, data: { item: OPP, history: HISTORY } },
    sheetResearch: () => React.createElement('span', null, `${ACTIONS.add}|${ACTIONS.compare}`), backHref: '/research/funds?view=directory&q=dawn',
  })));
  const text = renderedText(html);
  assert.match(text, /Save to shortlist/);
  assert.match(text, /Add to research project\|Compare in project/);
  assert.match(text, /Reported size€75m EUR/);
  assert.match(text, /@Euro_VC · reported 25 Sep 2023/);
  assert.match(html, /href="\/research\/funds\/catalog\/dawncapital-opp"[^>]*>Open full profile →<\/a>/);
});

test('a comparison cell cites the same chip; USD stays USD; source use and the withdrawn refusal have words', () => {
  const listed = { state: 'listed', values: {} };
  const size = cellView('size', { status: 'recorded', value: 7_500_000_000, currency: 'EUR', source: { name: EUR, url: 'https://repo.example' }, as_of: '2026-10-04', provenance: PROV }, listed);
  // Mutation checked: ignore the provenance → 'EuroTech VC Funds (public spreadsheet) · as of 2026-10-04'.
  assert.equal(size.source, '@Euro_VC · reported 25 Sep 2023');
  assert.equal(size.sourceUrl, 'https://list.example/eu');
  const usd = cellView('size', { status: 'recorded', value: 18_500_000_000, currency: 'USD', source: { name: 'S', url: null }, as_of: null, provenance: { ...PROV, publisher: 'Shai Goldman', reported_on: '2025-02-21' } }, listed);
  assert.deepEqual([usd.text, usd.detail, usd.source], ['US$185m', 'USD', 'Shai Goldman · reported 21 Feb 2025']);
  const use = cellView('source_use', { status: 'recorded', value: 'cite only', reviewed_on: '2026-10-07', imported_on: '2026-10-04', source: {}, as_of: '2026-10-07', provenance: PROV }, listed);
  assert.deepEqual([use.text, use.detail], ['Cite only', 'reviewed 7 Oct 2026 · imported 4 Oct 2026']);
  assert.equal(cellView('manager', null, listed).reason, 'Unavailable');
  assert.match(COMPARISON_ERRORS.source_withdrawn, /source list was withdrawn, so nothing was added/);
});

test('Save to shortlist re-reads the fund: a 410 then clears the page and nothing is saved', async () => {
  const original = { research: api.research, get: researchFundsApi.get, list: researchMyFundsApi.list };
  const sent = [];
  let reads = 0;
  const removed = { name: 'Taken down', reason: 'Its terms forbid republishing.' };
  researchFundsApi.get = async () => {
    reads += 1;
    if (reads === 1) return ready.data;
    throw Object.assign(new Error('Removed'), { status: 410, data: { removed, reason: 'Taken down.' } });
  };
  // The shortlist holds the manager's OTHER vehicle: matched on catalogue_uid, Opp is not saved.
  researchMyFundsApi.list = async () => ({ items: [{ uid: 'rf_1', name: 'Dawn Capital Opp', catalogue_uid: 'dawncapital-v' }] });
  api.research = { ...original.research, fundCreate: async (b) => { sent.push(b); return { uid: 'rf_2' }; } };
  const m = await mountContracts(React.createElement(Routes, null, React.createElement(Route, { path: '/research/funds/catalog/:id', element: React.createElement(FundCatalogProfile, { role: 'founder' }) })), '/research/funds/catalog/dawncapital-opp');
  try {
    for (let i = 0; i < 6; i += 1) await m.flush();
    const byTid = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id) || null;
    // Mutation checked: match the shortlist by name → "Open dossier →" replaces the button.
    const button = byTid('fund-catalog-add');
    assert.ok(button, 'Save to shortlist is offered for Opp');
    await act(async () => { await m.props(button).onClick(); });
    for (let i = 0; i < 4; i += 1) await m.flush();
    // Mutation checked: drop the re-read → fundCreate is called.
    assert.equal(sent.length, 0, 'nothing was saved');
    assert.ok(byTid('fund-catalog-removed'), 'the page now says the source was withdrawn');
    assert.equal(byTid('fund-catalog-profile'), null, 'the facts are cleared');
  } finally {
    await m.unmount();
    api.research = original.research;
    researchFundsApi.get = original.get;
    researchMyFundsApi.list = original.list;
  }
});
