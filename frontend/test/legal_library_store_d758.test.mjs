// D758 (#1862) — the /legal page reads its library from the store and
// generates nothing; a refused profiling send is drawn, not swallowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { TemplatePreviewBody, TemplatePreviewModal } from '../src/pages/LegalPage.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('api.js has no generate method or path; the two library reads stay', () => {
  const api = codeOnly(read('frontend/src/lib/api.js'));
  assert.doesNotMatch(api, /generateDocument/);
  assert.doesNotMatch(api, /\/legal\/templates\/\$\{[^}]*\}\/generate/);
  assert.match(api, /listTemplates: \(\) => request\('\/legal\/templates'\)/);
  assert.match(api, /getTemplateContent: \(key\) => request\(`\/legal\/templates\/\$\{key\}`\)/);
});

test('LegalPage generates nothing and links Send for signature to /legal/send', () => {
  const page = codeOnly(read('frontend/src/pages/LegalPage.jsx'));
  assert.doesNotMatch(page, /Generate Document/);
  assert.doesNotMatch(page, /Generate Document from Template/);
  assert.doesNotMatch(page, />\s*Generate\s*</);
  assert.doesNotMatch(page, /onGenerate|generateDocument/);
  assert.match(page, /<Link to="\/legal\/send"[^>]*>[\s\S]*?Send for signature\s*<\/Link>/);
  assert.match(page, /The text this document carries in the library\. Fields in double braces are filled when it is sent\./);
});

test('D1317: the template preview and the document viewer open as the shared right-side Sheet at 640px', () => {
  const out = renderToStaticMarkup(React.createElement(TemplatePreviewModal, { template: { key: 'nda', title: 'Mutual NDA', layer: 'x', layer_label: 'Contracts' }, onClose() {} }));
  const id = out.match(/<h2 id="([^"]+)"[^>]*>Mutual NDA<\/h2>/)?.[1];
  assert.ok(id, 'named by the template');
  assert.match(out, new RegExp(`role="dialog" aria-modal="true" aria-labelledby="${id}"[^>]*data-testid="legal-template-preview" data-width="640"`));
  assert.match(out, /data-testid="legal-template-preview-footer"[\s\S]*Close/);
  const page = read('frontend/src/pages/LegalPage.jsx');
  assert.match(page, /<Sheet\s+label=\{viewDoc\.title \|\| 'Document'\}\s+title=\{viewDoc\.title\}[\s\S]*?width=\{640\}\s+testId="legal-document-viewer"/);
  assert.doesNotMatch(page, /fixed inset-0 bg-black\/60/, 'no own overlay left');
});

test('TemplatePreviewBody draws the stub line for a document with no body, and the body as text otherwise', () => {
  const empty = renderedText(renderToStaticMarkup(React.createElement(TemplatePreviewBody, { body: null, hasBody: false })));
  assert.equal(empty, 'No body in the store yet');
  const body = 'SECTION 1. <b>Parties</b> {{company_name}}';
  const html = renderToStaticMarkup(React.createElement(TemplatePreviewBody, { body, hasBody: true }));
  assert.match(renderedText(html), /SECTION 1\. .*Parties.* \{\{company_name\}\}/);
  assert.match(html, /&lt;b&gt;Parties&lt;\/b&gt;/, 'the markup in a body is escaped as text');
  assert.doesNotMatch(html, /<b>Parties<\/b>/, 'the body is text, never markup');
});

test('a partner profile\'s record draws a refused send from esign_refusal (D995)', () => {
  const m = codeOnly(read('frontend/src/pages/admin/profiles/profileModel.js'));
  assert.match(m, /if \(res\?\.esign_refusal\)/);
  assert.match(m, /res\.esign_refusal\.message/);
  const r = codeOnly(read('frontend/src/pages/admin/profiles/ProfileRecord.jsx'));
  assert.match(r, /sendResult\(res, \{ status, email: p\?\.email \}\)/);
  assert.match(r, /\{result\.text\}/);
});

test('the explainer and the how-to describe the library, not a generator', () => {
  const ex = read('frontend/src/lib/explainers.js');
  assert.match(ex, /The legal documents Axal VC uses, with the text each one carries in the library\. Send one for signature from Send for signature\./);
  assert.doesNotMatch(ex, /auto-filled from your profile and entity/);
  const docs = read('frontend/src/pages/docs/sections/legal.js');
  for (const line of ['Open Legal.', 'Preview the text of the document you need.', 'Send it for signature from Send for signature, after attorney review.']) {
    assert.ok(docs.includes(`'${line}'`), line);
  }
});
