// D758 (#1862) — the /legal page reads its library from the store and
// generates nothing; a refused profiling send is drawn, not swallowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { TemplatePreviewBody } from '../src/pages/LegalPage.jsx';

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

test('TemplatePreviewBody draws the stub line for a document with no body, and the body as text otherwise', () => {
  const empty = renderedText(renderToStaticMarkup(React.createElement(TemplatePreviewBody, { body: null, hasBody: false })));
  assert.equal(empty, 'No body in the store yet');
  const body = 'SECTION 1. <b>Parties</b> {{company_name}}';
  const html = renderToStaticMarkup(React.createElement(TemplatePreviewBody, { body, hasBody: true }));
  assert.match(renderedText(html), /SECTION 1\. .*Parties.* \{\{company_name\}\}/);
  assert.match(html, /&lt;b&gt;Parties&lt;\/b&gt;/, 'the markup in a body is escaped as text');
  assert.doesNotMatch(html, /<b>Parties<\/b>/, 'the body is text, never markup');
});

test('PartnerProfilesConsole draws a refused send from esign_refusal', () => {
  const s = codeOnly(read('frontend/src/pages/admin/consoles/PartnerProfilesConsole.jsx'));
  assert.match(s, /res\?\.esign_refusal/);
  assert.match(s, /setEsignRefusal\(res\.esign_refusal\)/);
  assert.match(s, /\{esignRefusal\.message\}/);
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
