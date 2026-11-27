/**
 * #4565 — the proposed v2 Terms and Privacy Policy are shown for counsel's review at their own
 * paths, and do not replace the published pages until counsel approves them.
 *
 *   · `/terms/v2-draft` and `/privacy/v2-draft` render the drafts, marked as not yet effective;
 *   · both paths are public and `noindex, nofollow`;
 *   · `/terms` and `/privacy` keep the published text and its dated "Last updated" (D1074 reads it).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/legal_v2_drafts_4565.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import TermsV2DraftPage from '../src/pages/TermsV2DraftPage.jsx';
import PrivacyV2DraftPage from '../src/pages/PrivacyV2DraftPage.jsx';
import { isPublicPath } from '../src/lib/api.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const render = (C, path) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(C)));

test('each draft renders at its own path, marked as a proposed revision that is not yet effective', () => {
  for (const [C, path, title] of [[TermsV2DraftPage, '/terms/v2-draft', 'Terms of Service'], [PrivacyV2DraftPage, '/privacy/v2-draft', 'Privacy Policy']]) {
    const html = render(C, path);
    assert.match(html, new RegExp(`<h1 id="ax-legal-h" class="ax-legal-h1">${title}</h1>`));
    assert.match(html, /Proposed revision — pending legal review\. Not yet effective\./, `${path}: marked as a draft`);
    assert.match(html, /Last updated Pending legal approval/, `${path}: no effective date is invented`);
  }
  const routes = read('src/routes/legalDrafts.jsx');
  assert.match(routes, /<Route path="\/terms\/v2-draft" element={<TermsV2DraftPage \/>} \/>/);
  assert.match(routes, /<Route path="\/privacy\/v2-draft" element={<PrivacyV2DraftPage \/>} \/>/);
});

test('the drafts are public but not for search', () => {
  assert.equal(isPublicPath('/terms/v2-draft'), true);
  assert.equal(isPublicPath('/privacy/v2-draft'), true);
  const headers = read('public/_headers');
  assert.match(headers, /^\/terms\/v2-draft\n  X-Robots-Tag: noindex, nofollow$/m, '/terms/v2-draft is noindex');
  assert.match(headers, /^\/privacy\/v2-draft\n  X-Robots-Tag: noindex, nofollow$/m, '/privacy/v2-draft is noindex');
});

test('the published pages are untouched: their own text and a dated "Last updated"', () => {
  for (const [file, name] of [['TermsPage.jsx', 'TERMS_UPDATED'], ['PrivacyPage.jsx', 'PRIVACY_UPDATED']]) {
    const src = read(`src/pages/${file}`);
    assert.match(src, new RegExp(`export const ${name} = '[A-Z][a-z]+ \\d{1,2}, \\d{4}';`), `${file} keeps a real date`);
    assert.doesNotMatch(src, /DRAFT FOR COUNSEL REVIEW|Pending legal approval|react-markdown/, `${file} is not the draft`);
  }
});
