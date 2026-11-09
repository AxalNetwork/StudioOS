/**
 * D228 — the promo-ceiling editor on HQ · Revenue.
 *
 * `api.promoCeilingSet` and its route (PUT /api/admin/promo-ceilings/:uid,
 * D111) existed with no caller. The editor is that caller. What is held here:
 * the payload it sends (integer minor units, never a blank sent as 0), the
 * sentence that says checkout does not enforce a ceiling, the editor's
 * licence-list states, its wiring on the page, and the Platform sentence that
 * stopped being true. D5039 part 2: the licence list is the scoped picker
 * (`LicencePicker`, `GET /api/admin/licence-picker`), read when the editor
 * opens, instead of the whole ledger read with the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  CeilingEditor, ceilingPayload, CEILING_ENFORCEMENT,
} from '../src/pages/hq/RevenuePage.jsx';
import { LicencePickerView } from '../src/pages/hq/revenue/Promotions.jsx';
import { revenuePageSource } from './_revenuePage.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(revenuePageSource());
const PLATFORM = raw('frontend/src/pages/hq/PlatformPage.jsx');
const API = raw('frontend/src/lib/api.js');
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const render = (props) => renderToStaticMarkup(
  React.createElement(CeilingEditor, { currentPeriod: '2026-Q3', onSave: async () => ({}), ...props }),
);

const LICENCES = [
  { uid: 'lic_fr', name: 'Axal VC France', territory: ['BE', 'FR'] },
  { uid: 'lic_no', name: 'AXL-NO', territory: [] },
];
const picker = (read, q = '') => renderToStaticMarkup(React.createElement(LicencePickerView, {
  q, onQ: () => {}, read, value: '', onChange: () => {}, onMore: () => {}, onRetry: () => {},
}));

test('the payload is integer minor units, and zero is a ceiling', () => {
  assert.deepEqual(
    ceilingPayload({ licenceUid: 'lic_fr', period: '2026-Q3', amount: '1234.56', currency: 'eur' }),
    { licenceUid: 'lic_fr', body: { period: '2026-Q3', ceiling_cents: 123456, currency: 'EUR' } },
  );
  const zero = ceilingPayload({ licenceUid: 'lic_fr', period: '2026-Q3', amount: '0', currency: 'EUR' });
  assert.equal(zero.body.ceiling_cents, 0);
  // Amounts whose float product is not an integer (0.29 * 100 is 28.999…).
  for (const [amount, cents] of [['0.29', 29], ['19.99', 1999], ['0.1', 10]]) {
    const got = ceilingPayload({ licenceUid: 'x', period: '2026-Q1', amount, currency: 'EUR' }).body.ceiling_cents;
    assert.equal(got, cents, `${amount} became ${got}`);
    assert.ok(Number.isInteger(got));
  }
});

test('a blank, negative or unreadable amount is refused, never sent as 0', () => {
  for (const amount of ['', '   ', undefined, null, '-5', 'lots']) {
    const r = ceilingPayload({ licenceUid: 'lic_fr', period: '2026-Q3', amount, currency: 'EUR' });
    assert.ok(r.error, `amount ${JSON.stringify(amount)} produced a payload`);
    assert.equal(r.body, undefined);
  }
});

test('no licence, a bad period or a bad currency is refused before any call', () => {
  assert.ok(ceilingPayload({ licenceUid: '', period: '2026-Q3', amount: '1', currency: 'EUR' }).error);
  assert.ok(ceilingPayload({ licenceUid: 'lic_fr', period: '2026-Q5', amount: '1', currency: 'EUR' }).error);
  assert.ok(ceilingPayload({ licenceUid: 'lic_fr', period: 'whenever', amount: '1', currency: 'EUR' }).error);
  assert.ok(ceilingPayload({ licenceUid: 'lic_fr', period: '2026-Q3', amount: '1', currency: 'EU' }).error);
});

test('the editor states, in every state, the enforcement D4855 built (see revenue_ceiling_enforcement_5028)', () => {
  for (const searchLicences of [async () => ({ items: LICENCES }), undefined]) {
    const t = text(render({ searchLicences }));
    for (const line of CEILING_ENFORCEMENT) assert.ok(t.includes(text(line).trim()), `missing: ${line.slice(0, 50)}`);
    assert.doesNotMatch(t, /Nothing at checkout checks a code against it/);
  }
});

test('the picker offers each licence with its territory; loading, unreadable, no match and none say so', () => {
  const h = picker({ status: 'ready', items: LICENCES, next: 'c1' });
  assert.match(text(h), /Axal VC France/);
  assert.match(text(h), /BE · FR/);
  assert.match(text(h), /AXL-NO No territory recorded/);
  assert.match(h, /type="radio"/);
  assert.match(text(h), /Show more/, 'a next page is offered while the Worker has one');
  assert.doesNotMatch(text(picker({ status: 'ready', items: LICENCES, next: null })), /Show more/);

  assert.match(text(picker({ status: 'ready', items: [], next: null })), /No territory licence exists yet/);
  assert.match(text(picker({ status: 'ready', items: [], next: null }, 'zz')), /No licence matches “zz”/);
  const bad = picker({ status: 'unavailable', items: [], next: null });
  assert.match(text(bad), /The licence list could not be read\./);
  assert.doesNotMatch(bad, /type="radio"/);
  assert.match(text(picker({ status: 'loading', items: [], next: null })), /Loading the licences/);

  const form = render({ searchLicences: async () => ({ items: LICENCES }) });
  assert.match(form, /value="2026-Q3"/, 'the current period is not the default');
  assert.match(text(form), /Loading the licences/, 'the picker reads when the editor mounts, not with the page');
});

test('the page mounts the editor, saves through promoCeilingSet, and re-reads the ceilings', () => {
  assert.match(PAGE, /<CeilingEditor\b/);
  assert.match(PAGE, /api\.promoCeilingSet\(uid, body\)/);
  assert.match(PAGE, /const r = await api\.promoCeilingSet\(uid, body\);\s*loadCeilings\(\);/);
  // D5039: the whole ledger is no longer read for the picker; the scoped picker is read when the editor opens.
  assert.doesNotMatch(PAGE, /licenceLedgerApi/);
  assert.match(PAGE, /searchLicences=\{adminStatementActionsApi\.licencePicker\}/);
  assert.match(PAGE, /\{editing && <CeilingEditor searchLicences=\{searchLicences\}/);
  assert.match(API, /promoCeilingSet: \(licenceUid, data\) =>\s*request\(`\/admin\/promo-ceilings\/\$\{encodeURIComponent\(licenceUid\)\}`/);
});

test('saved and pushed are reported as two facts', () => {
  assert.match(PAGE, /r\?\.pushed\?\.ok/);
  assert.match(PAGE, /Not pushed: /);
});

test('Platform no longer says no screen sets a ceiling', () => {
  assert.doesNotMatch(PLATFORM, /no screen sets one/);
  assert.match(PLATFORM, /Ceilings are set and listed on Revenue; checkout does not check codes against them yet\./);
});
