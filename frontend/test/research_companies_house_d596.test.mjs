/**
 * D596 (#1231) — a Companies House record names its own source on the
 * company pages, with the Open Government Licence line, and a Wikidata record
 * keeps CC0. Nothing on the page assumes every record is Wikidata's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CompanyPublisherProvider } from '../src/pages/research/CompanySource.jsx';
import { renderedText } from './_renderedText.mjs';
import { EMPTY_FILTERS } from '../src/lib/companyDirectoryView.js';
import { DirectoryResults } from '../src/pages/research/CompanyDirectoryZone.jsx';
import { CompanyHeader } from '../src/pages/research/CompanyProfile.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const render = (C, props) => renderedText(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CompanyPublisherProvider, { inventory: { label: 'company records from 2 publishers', publishers: [{ source_name: 'Companies House', licence_name: 'Open Government Licence v3.0', terms_reviewed_on: '2026-11-20', required_attribution: OGL }, { source_name: 'Wikidata', licence_name: 'CC0 1.0 Universal', terms_reviewed_on: '2026-11-20' }] } }, createElement(C, props)))));
const noop = () => {};
const OGL = 'Contains public sector information licensed under the Open Government Licence v3.0.';
const CH = {
  uid: 'ch-00445790', name: 'TESCO PLC', website: '', country: 'United Kingdom', founded_year: 1947, sector: 'retail',
  source_name: 'Companies House', source_license: OGL, as_of: '2026-10-06',
  source_url: 'https://find-and-update.company-information.service.gov.uk/company/00445790',
};
const WD = { uid: 'q1', name: 'Acme', website: 'https://acme.example', country: 'Germany', founded_year: 2015, sector: 'robotics',
  source_name: 'Wikidata', as_of: '2026-09-30', source_url: 'https://www.wikidata.org/wiki/Q1' };

test('D596: the record card cites Companies House with the OGL line, and Wikidata with CC0', () => {
  const ch = render(CompanyHeader, { item: CH, tracked: { status: 'not_recorded' } });
  assert.match(ch, /Companies House · Open Government Licence v3\.0/);
  assert.ok(ch.includes(OGL), 'the OGL attribution line is shown');
  assert.match(ch, /View the Companies House record/);
  assert.doesNotMatch(ch, /Wikidata/);
  const wd = render(CompanyHeader, { item: WD, tracked: { status: 'not_recorded' } });
  assert.match(wd, /Wikidata · CC0 1.0 Universal/);
  assert.match(wd, /View the Wikidata record/);
  assert.doesNotMatch(wd, /Companies House|Open Government/);
  assert.match(render(CompanyHeader, { item: {}, tracked: {} }), /Source not recorded/);
});

test('D596: the record card names the fields the row\'s own register holds', () => {
  // D7180 retired the sources table (its rows are the evidence collections and
  // the metric cards now); the record card carries what it said about the register.
  const t = render(CompanyHeader, { item: CH, tracked: { status: 'not_recorded' }, sources: { status: 'ok', rows: [{ source_name: CH.source_name, field_name: 'country' }] } });
  assert.match(t, /Fields from this source: country/);
  assert.match(t, /Official site: Not recorded/, 'a Companies House row with no website says so');
  assert.doesNotMatch(render(CompanyHeader, { item: WD, tracked: {} }), /Fields from this source/);
});

test('D596: a directory row from Companies House says so; the page names both sources and the OGL', () => {
  const data = {
    items: [CH, WD], total: 2, limit: 25, offset: 0,
    coverage: { of: 2, fields: { website: 1, country: 2, founded_year: 2, sector: 2, funding: 0, last_round: 0, revenue: 0, headcount: 0 } },
    facets: { sector_labels: [], sector_none: 0, countries: [], has: { funding: 0, revenue: 0, headcount: 0 } },
  };
  const t = render(DirectoryResults, { state: 'ready', data, filters: { ...EMPTY_FILTERS }, onChange: noop, onRetry: noop });
  assert.match(t, /TESCO PLC\s*Companies House/);
  assert.match(t, /Acme\s*https:\/\/acme\.example\s*Wikidata/, 'every row carries its stored publisher');
  const zone = read('frontend/src/pages/research/CompanyDirectoryZone.jsx');
  assert.ok(zone.includes('<PublisherBoundary attribution />'));
  assert.doesNotMatch(read('frontend/src/pages/research/CompanyProfile.jsx'), />Wikidata · CC0</, 'the card no longer assumes Wikidata');
});
