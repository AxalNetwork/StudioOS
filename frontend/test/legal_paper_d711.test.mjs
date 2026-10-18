// D711 (#1776, PR 2) — the screens draw the Worker's paper. The live preview,
// the signer's page and the envelope wizard use the paper the PDF prints; the
// frame runs no script; Word sits beside Download PDF; an envelope lists its
// recorded files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaperFrame, withPaperFonts } from '../src/components/PaperPreview.jsx';
import { envelopeBody } from '../src/pages/admin/contracts/EnvelopeWizard.jsx';
import { FileRows } from '../src/pages/admin/contracts/AgreementDetail.jsx';
import { SignerPaper } from '../src/pages/ESignPage.jsx';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const PAPER = '<!doctype html><html><head><style id="paper-fonts"></style></head><body><main>The parties agree.</main></body></html>';

test('D711: PaperFrame is an iframe sandboxed to allow-same-origin only, with the paper in srcdoc', () => {
  const html = renderToStaticMarkup(createElement(PaperFrame, { html: PAPER, title: 'Founder NDA' }));
  const sandbox = html.match(/sandbox="([^"]*)"/);
  assert.ok(sandbox, 'the frame is sandboxed');
  assert.equal(sandbox[1], 'allow-same-origin');
  assert.ok(!html.includes('allow-scripts'));
  assert.match(html, /srcDoc="[^"]*The parties agree\./i);
  assert.match(html, /title="Founder NDA"/);
});

test('D711: the faces fill the paper\'s slot, and CSS holding a < is never spliced in', () => {
  const css = "@font-face{font-family:'Public Sans';src:url(data:font/woff2;base64,AAAA)}";
  assert.ok(withPaperFonts(PAPER, css).includes(`<style id="paper-fonts">${css}</style>`));
  assert.equal(withPaperFonts(PAPER, `${css}</style><img src=x>`), PAPER);
  assert.equal(withPaperFonts(PAPER, ''), PAPER);
});

test('D711: PaperPreview asks the Worker for the paper, with the faces omitted, and draws none of its own', () => {
  const preview = src('../src/components/PaperPreview.jsx');
  assert.ok(!preview.includes('dangerouslySetInnerHTML'));
  assert.ok(!/from ['"][^'"]*lib\/legalDocFormat/.test(preview), 'the preview imports no client mirror of the paper');
  assert.ok(!preview.includes('resolveWithBrackets'));
  assert.match(preview, /contractsApi\.renderPaper\(\{[\s\S]*fonts: 'omit'/);
  assert.match(preview, /contractsApi\.paperFonts\(\)/);
  assert.match(preview, /setTimeout\([\s\S]*500\)/, 'the redraw waits 500 ms after the last edit');
  const contracts = src('../src/lib/api/contracts.js');
  assert.match(contracts, /renderPaper: body => request\('\/admin\/contracts\/templates\/render', \{ method: 'POST'/);
  assert.match(contracts, /paperFonts: \(\) => request\('\/admin\/contracts\/templates\/paper-fonts'\)/);
  assert.match(contracts, /files: uid => request\(`\/admin\/contracts\/\$\{encodeURIComponent\(uid\)\}\/files`\)/);
});

test('D711: the envelope body carries page_size and cover, so changing either clears the preview', () => {
  const t = { slug: 'founder_nda_v1', version: 3 };
  const base = { template: t, name: 'Ivy', email: 'ivy@example.test', fields: {}, deal: null, provider: 'native' };
  assert.deepEqual([envelopeBody(base).page_size, envelopeBody(base).cover], ['letter', 'dark']);
  const a4 = envelopeBody({ ...base, pageSize: 'a4', cover: 'light' });
  assert.deepEqual([a4.page_size, a4.cover], ['a4', 'light']);
  assert.notEqual(JSON.stringify(a4), JSON.stringify(envelopeBody(base)));
  const wizard = src('../src/pages/admin/contracts/EnvelopeWizard.jsx');
  assert.match(wizard, /const body = envelopeBody\(\{[^}]*pageSize, cover \}\)/);
  assert.match(wizard, /aria-pressed=\{pageSize === key\}/);
  assert.match(wizard, /aria-pressed=\{cover === key\}/);
});

test('D711: the template editor downloads Word beside the PDF, both on the chosen paper', () => {
  const page = src('../src/pages/admin/AdminTemplates.jsx');
  assert.ok(page.includes('data-testid="template-download-docx"'));
  assert.match(page, /api\.adminTemplateStoreDocxBlob\(slug/);
  assert.match(page, /adminTemplateStorePreviewPdfBlob\(slug, \{\s*resolve: [^}]*page: pageSize, cover,/);
  assert.match(page, /pageSize=\{pageSize\}\s*cover=\{cover\}/);
  const api = src('../src/lib/api.js');
  assert.match(api, /\/templates\/store\/\$\{encodeURIComponent\(slug\)\}\/export\.docx\?/);
  assert.match(api, /fetch\(`\/api\/legal\/esign\/sign\/\$\{encodeURIComponent\(token\)\}\/paper`\)/);
});

test('D711: the signer sees the paper when it loads, and the same text, said so, when it does not', () => {
  const envelope = { document_title: 'Founder NDA', document_body: 'The parties agree.' };
  const none = renderToStaticMarkup(createElement(SignerPaper, { paper: null, envelope }));
  assert.ok(none.includes('The formatted page did not load. This is the same text.'));
  assert.ok(none.includes('The parties agree.'));
  assert.ok(!none.includes('<iframe'));
  const loading = renderToStaticMarkup(createElement(SignerPaper, { paper: { loading: true }, envelope }));
  assert.ok(!loading.includes('did not load'));
  const drawn = renderToStaticMarkup(createElement(SignerPaper, { paper: { html: PAPER }, envelope }));
  assert.ok(drawn.includes('<iframe'));
  assert.ok(drawn.includes('sandbox="allow-same-origin"'));
  assert.ok(!drawn.includes('did not load'));
});

test('D711: an envelope lists its files by kind, signer, renderer, size, date and hash prefix', () => {
  const html = renderToStaticMarkup(createElement(FileRows, { files: [
    { kind: 'signed_copy', signer: 2, renderer: 'browser_run', bytes: 48_000, created_at: '2026-10-18T02:00:00Z', sha256: 'a'.repeat(64), stored: true },
    { kind: 'docusign_source', signer: null, renderer: 'pdf_lib', bytes: 2_400_000, created_at: '2026-10-18T02:00:00Z', sha256: 'b'.repeat(64), stored: false },
  ] }));
  assert.ok(html.includes('Signed copy · Signer 2 · Browser Run · 47 KB'));
  assert.ok(html.includes('a'.repeat(12)) && !html.includes('a'.repeat(13)), 'a hash prefix, not the hash');
  assert.ok(html.includes('DocuSign source · Fallback · 2.3 MB'));
  assert.ok(html.includes('not stored'));
  const detail = src('../src/pages/admin/contracts/AgreementDetail.jsx');
  assert.match(detail, /contractsApi\.files\(uid\)/);
  assert.ok(!detail.includes('r2_key'));
});
