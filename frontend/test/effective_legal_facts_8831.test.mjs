/** D8831: approved factual disclosures, unchanged regulatory rows, and the existing date-version handoff. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import TermsPage, { TERMS_UPDATED } from '../src/pages/TermsPage.jsx';
import PrivacyPage, { PRIVACY_UPDATED } from '../src/pages/PrivacyPage.jsx';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const terms = TermsPage().props, privacy = PrivacyPage().props;
const render = body => renderToStaticMarkup(React.createElement(MemoryRouter, null, body));
const text = body => render(body).replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const section = (p, n) => text(p.sections.find(s => s.n === n).body);
// Exact pre-change rows from main d26a93a252: no counsel-pending row is rewritten by this factual release.
const PROTECTED = {
  "TermsPage:02": "b845404b0007b57c2c93700869942f39dfe49f0d9c58ab2060e7d933a25811c7",
  "TermsPage:03": "ebbf7c9716ba287534b4e3104ef66e1ad1625d269facfee6262ad033fe50d61f",
  "TermsPage:06": "30eaf2551245be1f28c46198cc692e24c6baa36bfb0583baa67f5f30efdc12fb",
  "TermsPage:12": "1183a09199b5965475d55b3b35ad2168912d46adf434ffb02ae0da48d1498497",
  "TermsPage:20": "7d2503295c6186121b3809961821f6d18c4fa0e99697342c63cc73819bb38074",
  "PrivacyPage:00": "d14d56cda068d1726bad6fa57f4a2f2bf4d5b0cba470bdf486fa11b73a773a10",
  "PrivacyPage:01": "2def28a73b7de14be479f941d3754e97c5e4b4cf666ad6b6812d531ab9b1ccee",
  "PrivacyPage:04": "3b46dceda28f5de28c840872e51dd04203d29ae3d8df6e9e90dd54a27a33cf23",
  "PrivacyPage:05": "be8ecb7327ef54eaa84fff89e4f2ca31e49abd4a72d26f018240220d5e052509"
};

test('Billing cancellation, refunds and tokens reflect the existing paid-period behaviour', () => {
  const body = section(terms, '11');
  assert.match(body, /cancel at any time from Billing.*end of the current paid period.*features remain available until then/);
  assert.match(body, /Cancelling does not by itself refund.*Refunds are given where the law requires.*price page or checkout/);
  assert.match(body, /Purchased AI tokens are a separate balance/);
  assert.doesNotMatch(body, /cancelled in writing/);
});

test('cookie controls explain optional measurement and first-touch 30\/90-day attribution', () => {
  const body = section(privacy, '07');
  assert.match(body, /Essential:.*always on/);
  assert.match(body, /Analytics \(Sign-up measurement\):.*If you enable Analytics.*life of that tab/);
  assert.match(body, /Marketing \(Referral cookie\):.*If you enable Marketing.*first referral link.*30 days for a referral code.*90 days for a referral handle.*first qualifying use/);
  assert.match(body, /Turning off Analytics.*clears the handle visit ID.*Turning off Marketing.*clears it/);
  assert.match(body, /Cookie preferences.*You can still sign up with either optional category turned off/);
  assert.doesNotMatch(body, /Functional:|Advertising:|four categories|does not currently load advertising/);
});

test('Google, recorded retention, conditional AI and named formation partners carry only approved facts', () => {
  const google = section(privacy, '09'), retention = section(privacy, '06');
  assert.match(google, /Search Console:.*search performance.*read-only access/);
  assert.match(google, /earlier connection.*read-only Gmail.*remove it in Connectors/);
  assert.match(google, /tokens.*encrypted.*Disconnecting Google.*deletes the stored tokens/i);
  assert.match(retention, /Call audio:.*30 days by default.*Transcripts stay with their interview/);
  assert.match(retention, /Signup measurement events:.*Analytics enabled.*180 days/);
  assert.match(retention, /Google access tokens:.*Kept encrypted until you disconnect/);
  assert.match(section(privacy, '08'), /happen only with notice and, where the law requires, consent.*30 days by default.*transcripts.*until it is deleted.*provider may keep its own copy/);
  assert.match(section(privacy, '02'), /personal data you submit or select.*external model provider.*only when that provider is enabled/);
  assert.match(section(terms, '21'), /named formation partner.*not by Axal VC Management LLC.*intermediary.*targets, not guarantees/);
  assert.match(section(privacy, '03'), /named formation partner.*arranges the service; it does not file/);
  const all = text(privacy.intro) + privacy.sections.map(s => text(s.body)).join(' ');
  assert.doesNotMatch(all, /Anthropic|OpenAI|agent run summaries|agent memory|verified.*consent screen|Lewes|Coastal Hwy|data processor for formation/i);
});

test('email notices have no postal term or unverified address and regulatory text is unchanged', () => {
  const body = section(terms, '19');
  assert.match(body, /by email to legal@axal.vc and take effect on delivery/);
  assert.doesNotMatch(body, /registered mail|fifteen|Lewes|Coastal Hwy/);
  for (const [key, expected] of Object.entries(PROTECTED)) {
    const [page, n] = key.split(':');
    const source = read(`../src/pages/${page}.jsx`);
    const block = source.match(new RegExp("    n: '" + n + "',[\\s\\S]*?(?=\\n  \\},)"))?.[0];
    assert.ok(block, key);
    assert.equal(createHash('sha256').update(block).digest('hex'), expected, key);
  }
  assert.match(section(privacy, '06'), /minimum period required by SEC and IRS regulations \(typically 7 years after the dissolution of a fund or termination of a relationship\)/);
});

test('published page dates match the existing receipt version map; counsel-gated reacceptance stays off', () => {
  const trust = read('../../cloudflare-worker/src/services/trust.ts');
  const iso = date => { const [month, day, year] = date.replace(',', '').split(' '); const months = ['January','February','March','April','May','June','July','August','September','October','November','December']; return `${year}-${String(months.indexOf(month)+1).padStart(2,'0')}-${day.padStart(2,'0')}`; };
  assert.match(trust, new RegExp(`tos_v1: '${iso(TERMS_UPDATED)}'`));
  assert.match(trust, new RegExp(`privacy_v1: '${iso(PRIVACY_UPDATED)}'`));
  assert.notEqual(TERMS_UPDATED, 'July 8, 2026');
  assert.notEqual(PRIVACY_UPDATED, 'October 29, 2026');
  assert.match(trust, /TERMS_REACCEPT_FROM: string \| null = null/);
});
