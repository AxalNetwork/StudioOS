/**
 * D228 — the promo-ceiling editor on HQ · Revenue.
 *
 * `api.promoCeilingSet` and its route (PUT /api/admin/promo-ceilings/:uid,
 * D111) existed with no caller. The editor is that caller. What is held here:
 * the payload it sends (integer minor units, never a blank sent as 0), the
 * sentence that says checkout does not enforce a ceiling, the editor's
 * licence-list states, its wiring on the page, and the Platform sentence that
 * stopped being true.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  CeilingEditor, ceilingPayload, CEILING_NOT_ENFORCED, UNAVAILABLE,
} from '../src/pages/hq/RevenuePage.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(raw('frontend/src/pages/hq/RevenuePage.jsx'));
const PLATFORM = raw('frontend/src/pages/hq/PlatformPage.jsx');
const API = raw('frontend/src/lib/api.js');
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const render = (props) => renderToStaticMarkup(
  React.createElement(CeilingEditor, { currentPeriod: '2026-Q3', onSave: async () => ({}), ...props }),
);

const LICENCES = [
  { uid: 'lic_fr', licence_ref: 'AXL-FR', brand_name: 'Axal VC France', currency: 'EUR', status: 'active' },
  { uid: 'lic_no', licence_ref: 'AXL-NO', brand_name: null, currency: 'NOK', status: 'suspended' },
];

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

test('the editor says, in every state, that checkout does not enforce a ceiling', () => {
  for (const licences of [LICENCES, [], null, UNAVAILABLE]) {
    const t = text(render({ licences }));
    assert.ok(t.includes(CEILING_NOT_ENFORCED), 'the enforcement sentence is missing');
  }
  assert.match(CEILING_NOT_ENFORCED, /Nothing at checkout checks a code against it/);
});

test('with licences, the form offers each one; empty and unreadable say so instead', () => {
  const h = render({ licences: LICENCES });
  assert.match(h, /<form/);
  assert.match(text(h), /Axal VC France/);
  assert.match(text(h), /AXL-NO · suspended/);
  assert.match(h, /value="2026-Q3"/, 'the current period is not the default');

  const empty = render({ licences: [] });
  assert.doesNotMatch(empty, /<form/);
  assert.match(text(empty), /No territory licence exists yet/);

  const bad = render({ licences: UNAVAILABLE });
  assert.doesNotMatch(bad, /<form/);
  assert.match(text(bad), /The licence list could not be read\./);

  const loading = render({ licences: null });
  assert.doesNotMatch(loading, /<form/);
  assert.match(text(loading), /Loading the licences/);
});

test('the page mounts the editor, saves through promoCeilingSet, and re-reads the ceilings', () => {
  assert.match(PAGE, /<CeilingEditor\b/);
  assert.match(PAGE, /api\.promoCeilingSet\(uid, body\)/);
  assert.match(PAGE, /const r = await api\.promoCeilingSet\(uid, body\);\s*loadCeilings\(\);/);
  assert.match(PAGE, /api\.licences\(\)/);
  assert.match(PAGE, /setLicences\(UNAVAILABLE\)/);
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
