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
 *   - the route is public and literal, and the panel draws both of its states;
 *   - the committed PDF (D7121 part 2, PGW04–PGW06) is the deck its source draws: five pages,
 *     under 500 KB, the owner's edition and "Proposed · not open", every page's text exactly the
 *     text of its slide in `wellnessDeck.js` (so no name, address or private line can be in it
 *     without being in the source), live links only to the two public addresses, and no
 *     author in its metadata.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellness_presentation_d7121.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { programFor } from '../src/pages/programs/registry.jsx';
import { ProgramCard } from '../src/pages/programs/ProgramsIndexPage.jsx';
import { PresentationName, ViewPresentationLink, manageDoor } from '../src/pages/programs/AdminPresentationLinks.jsx';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('PGW07: the shared catalog exposes the approved public page and PDF, with separate admin presentation links', () => {
  const entry = programFor('wellness');
  assert.ok(entry);
  assert.equal(entry.canonical, '/programs/wellness');
  assert.equal(entry.pdf, '/program-briefs/axal-vc-wellness-v1.pdf');
  assert.equal(entry.avail, 'proposed');
  assert.equal(entry.edition, 'Edition 1 · November 2026');
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(ProgramCard, { p: entry }),
    React.createElement(PresentationName, { programKey: 'wellness', name: 'Wellness' }),
    React.createElement(ViewPresentationLink, { programKey: 'wellness' })));
  assert.match(html, /data-testid="programs-index-card-wellness"/);
  assert.match(html, /href="\/programs\/wellness"/);
  assert.match(html, /href="\/program-briefs\/axal-vc-wellness-v1.pdf"/);
  assert.match(html, /Proposed · not open/);
  assert.doesNotMatch(html, /href="\/wellbeing"/);
});

test('PGW07: a global fallback key gets the Wellness presentation; a studio collision keeps its own identity', () => {
  for (const [key, studioOnly] of [['axal-wellness-2', null], ['wellness', 'lic-private']]) {
    const row = { key, name: 'Wellness', studio_only: studioOnly };
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(PresentationName, { programKey: key, name: row.name, registryRow: row }),
      React.createElement(ViewPresentationLink, { programKey: key, registryRow: row })));
    if (studioOnly === null) assert.match(html, /href="\/programs\/wellness"/);
    else assert.doesNotMatch(html, /href=/);
    const door = manageDoor(React.createElement('a', { href: `/admin/programs/${key}` }, 'Open'), key, row.name, undefined, row);
    assert.equal(door.props.children, studioOnly === null ? 'Manage program' : 'Open');
  }
});

const model = await import('../src/pages/wellbeing/wellnessPresentation.js');
const deck = await import('../src/pages/wellbeing/wellnessDeck.js');
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

test('href: the owner\'s edition is published, and both controls link the committed file', () => {
  assert.equal(ENTRY.pdfPublished, true);
  assert.equal(ENTRY.edition, 'Edition 1 · November 2026');
  const html = render();
  assert.deepEqual(hrefs(html).filter((h) => h.includes('program-briefs')), [PDF, PDF]);
  assert.equal((html.match(/data-testid="wellness-pdf-off"/g) || []).length, 0);
  assert.match(html, /5 slides · 16:9 · Edition 1 · November 2026/);
  // With the PDF out, the studio operators' note is the canvas's again.
  assert.match(html, /Share this page or the PDF\. Neither shows anyone’s check-ins or bookings\./);
});

test('href: an unpublished deck is no link, and says so', () => {
  const html = render({ ...ENTRY, pdfPublished: false, edition: null });
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
  for (const f of ['frontend/src/pages/wellbeing/WellnessPresentationPage.jsx', 'frontend/src/pages/wellbeing/wellnessPresentation.js', 'frontend/src/pages/wellbeing/wellnessDeck.js']) {
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

// ── The committed PDF (D7121 part 2, PGW04–PGW06) ───────────────────────────

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const PDF_BYTES = readFileSync(resolve(ROOT, ENTRY.pdfFile));
const DOC = await pdfjs.getDocument({ data: new Uint8Array(PDF_BYTES), isEvalSupported: false, useSystemFonts: false }).promise;
const PAGES = [];
for (let i = 1; i <= DOC.numPages; i += 1) {
  const page = await DOC.getPage(i);
  PAGES.push({
    text: (await page.getTextContent()).items.map((it) => it.str).join(' '),
    links: (await page.getAnnotations()).filter((a) => a.subtype === 'Link').map((a) => a.url),
  });
}
// Letters and digits only, lower case: the PDF spaces out letter-spaced and upper-cased words.
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const pieces = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').split(/<[^>]+>/).map((t) => norm(decode(t))).filter(Boolean);

test('PDF: five 16:9 pages, under 500 KB without LFS, tagged, titled with the edition, no author', async () => {
  assert.equal(PDF_BYTES.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(DOC.numPages, ENTRY.slides);
  assert.ok(statSync(resolve(ROOT, ENTRY.pdfFile)).size < 500 * 1024, 'over 500 KB: LFS-track it (scripts/lfs-size-gate.mjs) or make it smaller');
  const page = await DOC.getPage(1);
  const [, , w, h] = page.view;
  assert.equal(Math.round((w / h) * 900), 1600, '16:9');
  const { info } = await DOC.getMetadata();
  assert.equal(info.Title, 'Wellness · Axal VC · Edition 1 · November 2026');
  assert.equal(info.Author, undefined);
  assert.match(PDF_BYTES.toString('latin1'), /\/StructTreeRoot/, 'tagged');
});

test('PDF: every page is exactly its slide\'s text, so nothing the source lacks is in the file', () => {
  const slides = deck.wellnessSlides(ENTRY);
  assert.equal(slides.length, PAGES.length);
  slides.forEach((s, i) => {
    const got = norm(PAGES[i].text);
    const want = pieces(s.html);
    for (const p of want) assert.ok(got.includes(p), `page ${i + 1} (${s.title}) lacks "${p}" — rebuild with node scripts/build-wellness-brief.mjs`);
    assert.equal(got.length, want.join('').length, `page ${i + 1} (${s.title}) carries text its slide does not draw`);
  });
});

test('PDF: the owner\'s answers, the footer on every page, no private content or name', () => {
  for (const [i, p] of PAGES.entries()) {
    assert.match(p.text, /Edition 1 · November 2026/, `page ${i + 1}: edition`);
    assert.match(p.text, /axal\.vc\/programs\/wellness/, `page ${i + 1}: public address`);
    assert.match(p.text, new RegExp(`0${i + 1} / 05`));
    for (const re of PRIVATE) assert.doesNotMatch(p.text, re, `page ${i + 1}`);
  }
  const all = PAGES.map((p) => p.text).join('\n');
  assert.match(PAGES[0].text, /Proposed · not open/, 'Q1 A: the registry wording');
  assert.doesNotMatch(all, /Eligible members · signed in/);
  // Q3 A: founders and Administrators only; no other role is offered it.
  assert.doesNotMatch(all, /\b(investors?|mentors?|partners?|everyone|all members)\b/i);
  // No expert, member, session or roster: no honorific, no booking time.
  assert.doesNotMatch(all, /\b(Dr|Mr|Mrs|Ms)\.? [A-Z]|\b\d{1,2}:\d{2}\b/);
  // Live links only to the two public addresses, never a sign-in link or an API.
  const links = new Set(PAGES.flatMap((p) => p.links));
  assert.deepEqual([...links].sort(), ['https://axal.vc/programs/wellness', 'https://axal.vc/wellbeing']);
});

test('deck source: the canvas\'s five slides, the page\'s purpose, no deck without an edition', () => {
  const slides = deck.wellnessSlides(ENTRY);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'What happens', 'Available now and planned', 'Access and next step']);
  for (const s of slides) assert.ok(s.alt.length > 40, `${s.title} has its text alternative`);
  assert.ok(slides[0].html.includes(model.PURPOSE));
  assert.match(slides[0].html, /\{\{ART\}\}/, 'the colour cover carries the dawn image');
  assert.doesNotMatch(deck.wellnessSlides(ENTRY, { gray: true })[0].html, /\{\{ART\}\}/, 'the print sheet leaves it out');
  assert.match(slides[2].html, /Private to you/);
  assert.equal((slides[3].html.match(/<li><span class="w-pl">Planned · <\/span>/g) || []).length, 3);
  assert.throws(() => deck.wellnessSlides({ ...ENTRY, edition: null }), /no edition/);
  assert.throws(() => deck.wellnessDeckHtml({ ...ENTRY, slides: 6 }), /says 6 slides/);
});
