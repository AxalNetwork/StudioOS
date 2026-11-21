/**
 * D7121 (#7121) — the public Wellness presentation at `/programs/wellness`,
 * built to `design/incoming/Program Wellness Presentation Page.dc.html`
 * (PGW01, PGW02A/B, PGW03).
 *
 * This pins:
 *   - the href: the page links the deck only at
 *     `/program-briefs/axal-vc-wellness-v1.pdf`, as a download, and only once
 *     that file is committed and the edition is set;
 *   - the content type: the map's `pdfPublished` agrees with the file on disk,
 *     a committed file starts `%PDF-`, and `_headers` overrides no type under
 *     `/program-briefs/`. A link to a missing file would be answered by the SPA
 *     fallback with 200 text/html, so an unpublished deck is no link at all;
 *   - no private content: the page imports no API module and reads nothing; its
 *     markup, its og entry and (once committed) the PDF carry no e-mail address,
 *     API path, check-in field or booking note; the shared link is never
 *     `/wellbeing`, which has no og entry;
 *   - the route is public and literal, and the panel draws both of its states.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellness_presentation_d7121.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const model = await import('../src/pages/wellbeing/wellnessPresentation.js');
const { default: Page } = await import('../src/pages/wellbeing/WellnessPresentationPage.jsx');
const { ogTagsFor, ogEntryFor } = await import('../src/lib/ogRegistry.js');
const { isPublicPath } = await import('../src/lib/api.js');

const { WELLNESS_PRESENTATION: ENTRY } = model;
const PDF = '/program-briefs/axal-vc-wellness-v1.pdf';
const render = (entry) => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/programs/wellness'] }, React.createElement(Page, entry ? { entry } : {})),
);
const published = { ...ENTRY, pdfPublished: true, edition: 'Edition 1 · Test' };
const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

// Strings that would mean private Wellbeing content reached the public page.
const PRIVATE = [
  /[\w.+-]+@[\w-]+\.[\w.]+/, // an e-mail address
  /\/api\//, // a live read
  /booker_note/, /checkin_id/, /\bmood_score\b/, /\bsleep_score\b/, /\bstress_score\b/,
  /\bnote_ciphertext\b/, /\buser_id\b/, /\bexpert_id\b/,
];

test('the map entry names the page, the deck and the private workspace apart', () => {
  assert.equal(ENTRY.key, 'wellness');
  assert.equal(ENTRY.url, '/programs/wellness');
  assert.equal(ENTRY.pdf, PDF);
  assert.equal(ENTRY.pdfFile, `frontend/public${PDF}`);
  assert.notEqual(ENTRY.url, ENTRY.workspace);
  assert.equal(ENTRY.openHref, '/login?next=/wellbeing');
});

test('href: a published deck is one download link to the committed path, in the hero and the next step', () => {
  const html = render(published);
  const pdfLinks = hrefs(html).filter((h) => h.includes('program-briefs'));
  assert.deepEqual(pdfLinks, [PDF, PDF]);
  const tags = html.match(/<a[^>]*data-testid="wellness-pdf"[^>]*>/g) || [];
  assert.equal(tags.length, 2);
  for (const t of tags) {
    assert.match(t, /download="axal-vc-wellness-v1\.pdf"/);
    assert.match(t, /type="application\/pdf"/);
  }
  assert.match(html, /5 slides · 16:9 · Edition 1 · Test/);
});

test('href: an unpublished deck is no link, and says so', () => {
  const html = render();
  assert.equal(hrefs(html).filter((h) => h.includes('program-briefs') || h.endsWith('.pdf')).length, 0);
  assert.equal((html.match(/data-testid="wellness-pdf-off"/g) || []).length, 2);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /Not published yet/);
  // An edition is required too: a file without an approved edition is not linked.
  assert.equal(model.downloadState({ ...published, edition: null }).published, false);
});

test('content type: the map agrees with the file on disk, and a committed file is a PDF', () => {
  const file = resolve(ROOT, ENTRY.pdfFile);
  assert.equal(ENTRY.pdfPublished, existsSync(file), 'pdfPublished must match whether the PDF is committed');
  if (existsSync(file)) {
    assert.equal(readFileSync(file).subarray(0, 5).toString('latin1'), '%PDF-');
    const text = readFileSync(file).toString('latin1');
    for (const re of PRIVATE) assert.doesNotMatch(text, re);
  }
  assert.match(ENTRY.pdf, /^\/program-briefs\/[a-z0-9-]+-v\d+\.pdf$/);
  // Workers static assets type a .pdf as application/pdf; no _headers rule may override it.
  const headers = read('frontend/public/_headers');
  assert.doesNotMatch(headers, /program-briefs/);
  assert.doesNotMatch(headers, /Content-Type\s*:/i);
});

test('no private content: the page reads nothing and shows no one', () => {
  for (const f of ['frontend/src/pages/wellbeing/WellnessPresentationPage.jsx', 'frontend/src/pages/wellbeing/wellnessPresentation.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /from ['"][^'"]*lib\/api/);
    assert.doesNotMatch(src, /\bfetch\(|\brequest\(|useAuth|localStorage/);
  }
  for (const html of [render(), render({ ...published, availability: 'elig' })]) {
    for (const re of PRIVATE) assert.doesNotMatch(html, re);
    // The only way to the workspace is through sign-in.
    assert.deepEqual(hrefs(html).filter((h) => h.includes('wellbeing')), ['/login?next=/wellbeing', '/login?next=/wellbeing']);
    assert.match(html, /Eadwyn never reads your check-ins/);
  }
});

test('og: the presentation has its own entry; /wellbeing has none', () => {
  const tags = ogTagsFor('/programs/wellness');
  assert.equal(tags.url, 'https://axal.vc/programs/wellness');
  assert.equal(tags.title, 'Wellness · Programs — Axal VC StudioOS');
  assert.equal(tags.description, model.PURPOSE);
  for (const v of Object.values(tags)) for (const re of PRIVATE) assert.doesNotMatch(String(v ?? ''), re);
  assert.equal(ogEntryFor('/wellbeing'), null);
});

test('route: /programs/wellness is literal, unguarded and public', () => {
  const src = read('frontend/src/routes/programsWellness.jsx');
  assert.match(src, /<Route path="\/programs\/wellness" element=\{<WellnessPresentationPage \/>\} \/>/);
  assert.doesNotMatch(src, /guard\(|authOnly\(/);
  assert.equal(isPublicPath('/programs/wellness'), true);
  assert.equal(isPublicPath('/wellbeing'), false);
});

test('panel: the registry wording by default (PGW02B), the drawn wording on request (PGW02A)', () => {
  assert.equal(ENTRY.availability, 'proposed');
  const held = render();
  assert.match(held, /data-state="proposed"/);
  assert.match(held, /Proposed · not open through Programs yet\./);
  assert.doesNotMatch(held, /Eligible members · signed in/);
  const drawn = render({ ...ENTRY, availability: 'elig' });
  assert.match(drawn, /data-state="elig"/);
  assert.match(drawn, /Eligible members · signed in/);
  assert.match(drawn, /Open to founders and Administrators with access to Wellbeing\./);
  // One violet action, Open Wellbeing, in both states.
  for (const html of [held, drawn]) assert.equal((html.match(/data-testid="wellness-open"/g) || []).length, 1);
});
