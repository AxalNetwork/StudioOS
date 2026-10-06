/**
 * D597 (#1232) — every fund cites its list: the row, the drawer and the
 * profile name the list, its publisher and its terms verdict, linked to where
 * the list is published; a list taken down is named in the footer with why,
 * and a fund from it answers "removed" on its profile with none of its fields.
 * Rendered with react-dom/server (no DOM).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_fund_sources_d597.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { FundDirectoryView } from '../src/pages/research/FundDirectory.jsx';
import { FundCatalogView, failedRead } from '../src/pages/research/FundCatalogProfile.jsx';
import { EMPTY_QUERY, VERDICT_LABELS, citationOf } from '../src/pages/research/fundDirectoryRead.js';

const EUR = 'EuroTech VC Funds (public spreadsheet)';
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';
const SHAI = 'Shai Goldman — new VC funds at/below $200M';
const EUR_SHEET = 'https://docs.google.com/spreadsheets/d/1cRdFZhXLqat04xe7qO-p48wXQ00GWJyrzgHSb3YVIp0/edit';
const DEEP_SHEET = 'https://docs.google.com/spreadsheets/d/1BqNO7l4kXRhjG5jcB89FwRlhuRKBwBKtV7ZHwwLjPhk/edit';
const SHAI_SHEET = 'https://docs.google.com/spreadsheets/d/1ebGZ6-ivf_3woBGC4Kz_3217DhjGsefoRu_5iP3nuFQ/edit';
const CITE = 'Terms not found, so this list is cite only: every fund from it names the list and links to it.';
const NOT_REVIEWED = 'Not recorded: this list\'s terms have not been reviewed';

const cite = (name, title, publisher, url) => ({ name, title, publisher, url, verdict: 'cite only', terms_status: 'not found',
  terms_quote: null, evidence_url: url, reviewed_on: '2026-10-06', reason: CITE });
const row = (o) => ({
  website: null, linkedin: null, hq: null, fund_number: null, fund_size_cents: null, fund_date: null, quarter: null,
  fund_year: null, sector_focus: null, notable_lps: null, eif_flag: 0, eifo_flag: 0, eif: null, eifo: null,
  size_currency: null, size_reason: 'Not recorded', as_of: '2026-10-04', ...o,
});
const ALPHA = row({ uid: 'alpha', name: 'Alpha Ventures', source_name: EUR, source_url: 'https://github.com/x/eurotech.csv',
  source: cite(EUR, 'Euro Tech VC Funds (from 1/2016)', '@Euro_VC', EUR_SHEET) });
const GAMMA = row({ uid: 'gamma', name: 'Gamma Deep', source_name: DEEP, source_url: 'https://github.com/x/deep.csv',
  source: cite(DEEP, 'Deep Tech Investors Mapping - Public version', 'Hello Tomorrow', DEEP_SHEET) });
const OMEGA = row({ uid: 'omega', name: 'Omega Unreviewed', source_name: 'A list nobody reviewed', source_url: 'https://list.example/x',
  source: { name: 'A list nobody reviewed', title: null, publisher: null, url: 'https://list.example/x', verdict: null,
    terms_status: null, terms_quote: null, evidence_url: null, reviewed_on: null, reason: NOT_REVIEWED } });

const DATA = {
  items: [ALPHA, GAMMA, OMEGA], total: 3, limit: 25, offset: 0, sort: 'name',
  coverage: { total: 3, as_of: '2026-10-04', fields: { size_eur: 0, size_unknown_currency: 0, hq: 0, website: 0,
    linkedin: 0, sector_focus: 0, fund_year: 0, notable_lps: 0, fund_number: 0 } },
  sources: [
    { name: EUR, url: 'https://github.com/x/eurotech.csv', rows: 1, as_of: '2026-10-04', size_currency: 'EUR',
      title: 'Euro Tech VC Funds (from 1/2016)', publisher: '@Euro_VC', published_url: EUR_SHEET, verdict: 'cite only', reason: CITE },
    { name: DEEP, url: 'https://github.com/x/deep.csv', rows: 1, as_of: '2026-09-01', size_currency: null,
      title: 'Deep Tech Investors Mapping - Public version', publisher: 'Hello Tomorrow', published_url: DEEP_SHEET, verdict: 'cite only', reason: CITE },
  ],
  removed_sources: [
    { name: SHAI, title: 'new VC funds at / below $200M in size by Shai Goldman @shaig', publisher: 'Shai Goldman (@shaig)',
      published_url: SHAI_SHEET, verdict: 'not allowed', reason: 'Its terms forbid republishing.', funds_withheld: 987 },
  ],
  facets: null,
};

function directory(props = {}) {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundDirectoryView, {
    query: EMPTY_QUERY, onQuery() {}, search: '', onSearch() {}, facets: null, selected: null, onSelect() {}, onClose() {},
    result: { loading: false, error: null, data: DATA }, ...props,
  })));
  return { html, text: renderedText(html) };
}
// A link is matched as plain text, never by building a pattern from a URL.
const linksTo = (html, href) => html.includes(`<a href="${href}"`);

test('citationOf: the list, its publisher, the published link and the verdict; "Not recorded" where the API has none', () => {
  assert.deepEqual(citationOf(GAMMA), { name: 'Deep Tech Investors Mapping - Public version', publisher: 'Hello Tomorrow',
    href: DEEP_SHEET, verdict: 'cite only', terms: 'Cite only', reason: CITE });
  assert.deepEqual(citationOf(OMEGA), { name: 'A list nobody reviewed', publisher: null, href: 'https://list.example/x',
    verdict: null, terms: 'Not recorded', reason: NOT_REVIEWED });
  // A row from before D597 (no `source`) still names its list and links where it was read.
  assert.deepEqual(citationOf({ source_name: EUR, source_url: 'https://github.com/x/eurotech.csv' }),
    { name: EUR, publisher: null, href: 'https://github.com/x/eurotech.csv', verdict: null, terms: 'Not recorded', reason: null });
  assert.equal(citationOf({ ...ALPHA, source: { ...ALPHA.source, verdict: 'allowed' } }).terms, 'Not recorded', 'only the three verdicts print');
  assert.equal(citationOf({ ...ALPHA, source: { ...ALPHA.source, url: 'javascript:alert(1)' } }).href, 'https://github.com/x/eurotech.csv');
  assert.deepEqual(Object.keys(VERDICT_LABELS), ['republish allowed', 'cite only', 'not allowed']);
});

test('every row cites its list by name and link, with its publisher and terms', () => {
  const { html } = directory();
  const rows = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
  const lines = [...rows.matchAll(/<div data-testid="fund-source-line"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  assert.equal(lines.length, 3, 'one source line per row');
  assert.ok(linksTo(lines[0], EUR_SHEET), 'the EuroTech row links the published sheet, not the repo copy');
  assert.match(renderedText(lines[0]), /^Source: Euro Tech VC Funds \(from 1\/2016\) · @Euro_VC · cite only$/);
  assert.ok(linksTo(lines[1], DEEP_SHEET));
  assert.ok(linksTo(lines[2], 'https://list.example/x'), 'an unreviewed list links where the row was read');
  assert.match(renderedText(lines[1]), /^Source: Deep Tech Investors Mapping - Public version · Hello Tomorrow · cite only$/);
  assert.match(renderedText(lines[2]), /^Source: A list nobody reviewed · publisher not recorded · terms not recorded$/);
});

test('the drawer and the profile show the list, its publisher, the terms with the reason, and link the list', () => {
  const { html } = directory({ selected: GAMMA, drawer: { loading: false, error: null, data: { item: GAMMA, reports: [], reports_status: 'ok' } } });
  const drawer = html.slice(html.indexOf('<aside id="fd-drawer"'), html.indexOf('</aside>'));
  const card = drawer.slice(drawer.indexOf('data-testid="fund-source-card"'));
  const text = renderedText(card);
  assert.match(text, /Deep Tech Investors Mapping - Public version/);
  assert.match(text, /Published by Hello Tomorrow/);
  assert.match(text, /Terms: Cite only/);
  assert.ok(text.includes(CITE), 'the reason for the verdict');
  assert.ok(linksTo(card, DEEP_SHEET), 'the card links the published list');
  assert.match(text, /View the list/);

  const profile = renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundCatalogView, {
    fund: { loading: false, error: null, status: 200, data: { item: OMEGA, reports: [], reports_status: 'ok', source_boundary: 'b' } },
  }))));
  assert.match(profile, /Published by Not recorded/);
  assert.match(profile, /Terms: Not recorded/);
  assert.ok(profile.includes(NOT_REVIEWED));
});

test('a list taken down is named in the footer with why and how many funds it withholds', () => {
  const { html, text } = directory();
  assert.match(html, /data-testid="fund-directory-removed"/);
  assert.match(text, /Removed \(1\)/);
  assert.ok(text.includes('new VC funds at / below $200M in size by Shai Goldman @shaig was removed, with its 987 funds: Its terms forbid republishing.'));
  assert.match(text, /Euro Tech VC Funds \(from 1\/2016\) · 1 funds · as of 2026-10-04 · sizes in EUR · published by @Euro_VC · terms: Cite only/);
  const none = directory({ result: { loading: false, error: null, data: { ...DATA, removed_sources: [] } } });
  assert.doesNotMatch(none.html, /fund-directory-removed/);
  assert.doesNotMatch(none.text, /was removed/);
});

test('the profile of a fund from a removed list says so, links the list, and shows none of the fund', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundCatalogView, {
    fund: { loading: false, error: 'Removed', status: 410, data: null,
      reason: 'This fund\'s list was taken down. Its terms forbid republishing.',
      removed: { name: SHAI, title: 'new VC funds at / below $200M in size by Shai Goldman @shaig', publisher: 'Shai Goldman (@shaig)',
        url: SHAI_SHEET, verdict: 'not allowed', reason: 'Its terms forbid republishing.' } },
  })));
  const text = renderedText(html);
  assert.match(html, /data-testid="fund-catalog-removed"/);
  assert.match(text, /This fund’s list was removed/);
  assert.match(text, /taken down\. Its terms forbid republishing\./);
  assert.match(text, /published by Shai Goldman \(@shaig\)/);
  assert.ok(linksTo(html, SHAI_SHEET), 'the removed list is linked');
  assert.doesNotMatch(text, /Fund not found|Unreadable|Add to my funds/);
});

test('a 410 read keeps the removed list and why; any other failure keeps neither', () => {
  const removed = { name: SHAI, url: SHAI_SHEET, verdict: 'not allowed', reason: 'Its terms forbid republishing.' };
  const gone = Object.assign(new Error('Removed'), { status: 410, data: { detail: 'Removed', reason: 'This fund\'s list was taken down.', removed } });
  assert.deepEqual(failedRead(gone), { loading: false, error: 'Removed', status: 410, data: null,
    removed, reason: 'This fund\'s list was taken down.' });
  const down = Object.assign(new Error('Unreadable'), { status: 503, data: { detail: 'Unreadable', removed } });
  assert.deepEqual(failedRead(down), { loading: false, error: 'Unreadable', status: 503, data: null });
  assert.deepEqual(failedRead(null), { loading: false, error: 'Unreadable.', status: null, data: null });
});
