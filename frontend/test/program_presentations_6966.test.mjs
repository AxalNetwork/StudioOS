/**
 * D6966 (#6966, pilot of #6965) — program presentations: the key → canonical page → committed
 * PDF map, the PDFs themselves, `/programs` and `/programs/:key`, the reshaped
 * `/spinout-lab/brief` and its availability states, the admin entry points and the /events link.
 *
 * The PDF checks run over EVERY map entry, so each sibling program (#6967–#6975) is checked by
 * this file the moment its `catalog/<key>.js` lands: a missing file would otherwise be answered
 * by the SPA shell as a 200 HTML page, under a "Download PDF" link.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_presentations_6966.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation, Link } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import { collectPrograms, AVAILABILITY } from '../src/pages/programs/collect.js';
import { PROGRAMS, programFor, presentationHref } from '../src/pages/programs/registry.jsx';
import { deckSlides } from '../src/pages/programs/deck.js';
import { manageDoor, PresentationName, ViewPresentationLink } from '../src/pages/programs/AdminPresentationLinks.jsx';
import LAB_CONTENT from '../src/pages/programs/content/spinout-lab.js';
import SpinoutLabBriefPage, { LabAvailabilityPanel, applyLabel, contentFor, labPanelState } from '../src/pages/SpinoutLabBriefPage.jsx';
import ProgramKeyPage, { resolveKey } from '../src/pages/programs/ProgramKeyPage.jsx';
import ProgramsIndexPage, { labLine } from '../src/pages/programs/ProgramsIndexPage.jsx';
import { isPublicPath } from '../src/lib/api.js';
import { ogTagsFor } from '../src/lib/ogRegistry.js';
import { programOgRoutes, loadProgramCatalog, pdfFileOf } from '../../scripts/lib/programCatalog.mjs';

const h = React.createElement;
/** The rendered words, one space between elements (entities decoded). */
const renderedText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const read = (p) => readFileSync(p, 'utf8');
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const LAB = programFor('spinout-lab');

// ── The map ──────────────────────────────────────────────────────────────────

test('the map holds Spin-Out Lab: key → /spinout-lab/brief → its committed PDF', () => {
  assert.ok(LAB, 'spinout-lab has no map entry');
  assert.equal(LAB.canonical, '/spinout-lab/brief');
  assert.equal(LAB.alias, '/programs/spinout-lab');
  assert.equal(LAB.pdf, '/program-briefs/axal-vc-spinout-lab-v1.pdf');
  assert.equal(LAB.file, 'axal-vc-spinout-lab-v1.pdf');
  assert.equal(LAB.edition, 'Edition 1 · November 2026');
  assert.equal(presentationHref('spinout-lab'), '/spinout-lab/brief');
  assert.equal(programFor('no-such-program'), null, 'a key with no map entry has none');
  assert.equal(presentationHref('nope'), null);
});

test('the map refuses an entry that would point nowhere or collide', () => {
  const ok = { ...LAB };
  delete ok.alias; delete ok.file;
  const one = (file, entry) => collectPrograms({ [`./catalog/${file}`]: { default: entry } });
  assert.equal(one('spinout-lab.js', ok)[0].key, 'spinout-lab');
  assert.throws(() => one('other.js', ok), /must be the file's name/);
  assert.throws(() => one('spinout-lab.js', { ...ok, pdf: '/program-briefs/axal-vc-other-v1.pdf' }), /pdf/);
  assert.throws(() => one('spinout-lab.js', { ...ok, pdf: 'https://cdn.example.com/axal-vc-spinout-lab-v1.pdf' }), /pdf/);
  assert.throws(() => one('spinout-lab.js', { ...ok, avail: 'maybe' }), /avail/);
  assert.throws(() => one('spinout-lab.js', { ...ok, canonical: '//evil.example/x' }), /canonical/);
  assert.throws(() => one('spinout-lab.js', { ...ok, slides: 9 }), /slides/);
  assert.throws(() => collectPrograms({
    './catalog/spinout-lab.js': { default: ok },
    './catalog/twin.js': { default: { ...ok, key: 'twin', pdf: '/program-briefs/axal-vc-twin-v1.pdf' } },
  }), /share the canonical page \/spinout-lab\/brief/);
});

test('every map entry: a same-origin /program-briefs/ href, a unique file, its own canonical page', () => {
  const files = new Set();
  for (const p of PROGRAMS) {
    assert.match(p.pdf, /^\/program-briefs\/axal-vc-[a-z0-9-]+-v[1-9][0-9]*\.pdf$/, `${p.key}: href`);
    assert.ok(!files.has(p.file), `${p.key}: ${p.file} is another program's file`);
    files.add(p.file);
    assert.ok(p.canonical.startsWith('/') && !p.canonical.startsWith('//'), `${p.key}: canonical is same-origin`);
    assert.ok(AVAILABILITY[p.avail], `${p.key}: availability in words`);
  }
});

test('every mapped PDF is committed, is a PDF, has the slides its link promises and needs no LFS', async () => {
  const fromDisk = await loadProgramCatalog();
  assert.deepEqual(fromDisk.map((p) => p.key), PROGRAMS.map((p) => p.key), 'Node and the SPA read one map');
  const tracked = execFileSync('git', ['ls-files', '--', 'frontend/public/program-briefs'], { encoding: 'utf8' });
  for (const p of fromDisk) {
    const file = pdfFileOf(p);
    assert.ok(existsSync(file), `${p.pdf} is not in frontend/public — the SPA shell would answer it with HTML`);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', `${p.pdf} does not start %PDF-`);
    const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
    assert.equal(pages, p.slides, `${p.pdf} has ${pages} pages; its Download PDF says ${p.slides} slides`);
    assert.ok(statSync(file).size < 500 * 1024, `${p.pdf} is over 500 KB: LFS-track it (scripts/lfs-size-gate.mjs) or make it smaller`);
    assert.ok(tracked.includes(p.pdf.replace(/^\//, 'frontend/public/')) || !tracked, `${p.pdf} is not committed`);
  }
});

test('the deck: cover, the content\'s slides, a closing with the public address and the edition', () => {
  const slides = deckSlides(LAB, LAB_CONTENT);
  assert.equal(slides.length, LAB.slides);
  assert.deepEqual(slides.map((s) => s.title), ['Cover', 'Who it helps', 'What happens', 'How participation works', 'Access and next step']);
  for (const s of slides) {
    assert.ok(s.alt && s.alt.length > 20, `${s.title} has its text alternative`);
    assert.ok(s.html.includes('axal.vc/spinout-lab/brief'), `${s.title}'s footer carries the public page`);
    assert.ok(s.html.includes('Edition 1 · November 2026'), `${s.title}'s footer carries the edition`);
  }
  const closing = renderedText(slides[4].html);
  assert.match(closing, /axal\.vc\/spinout-lab\/apply/);
  assert.match(closing, /axal\.vc\/contact\?topic=licence/);
  assert.throws(() => deckSlides({ ...LAB, slides: 6 }, LAB_CONTENT), /says 6 slides/);
});

// ── The words the owner held back (2026-11-19) ──────────────────────────────

test('no unapproved claim: no equity line, no general "Ask a question", no Demo Day, no promised outcome', () => {
  const all = [
    read('frontend/src/pages/programs/catalog/spinout-lab.js'), read('frontend/src/pages/programs/content/spinout-lab.js'),
    read('frontend/src/pages/SpinoutLabBriefPage.jsx'), readFileSync('frontend/public/program-briefs/axal-vc-spinout-lab-v1.pdf').toString('latin1'),
  ];
  const page = renderedText(at('/spinout-lab/brief', h(SpinoutLabBriefPage)));
  for (const src of [...all.slice(0, 3).map(codeOnly), page]) {
    assert.doesNotMatch(src, /takes no equity|Ask a question|Demo Day|funded company|time to incorporation/i);
  }
  const support = LAB_CONTENT.sections[2].blocks[0].items[1].block.items;
  assert.deepEqual(support.at(-1), ['Introductions', 'Not promised.']);
});

// ── /spinout-lab/brief: the four actions and the states ──────────────────────

test('Download PDF is a same-origin link to the committed file with download; Print is its own button', () => {
  const html = at('/spinout-lab/brief', h(SpinoutLabBriefPage));
  const links = [...html.matchAll(/<a [^>]*data-testid="program-download-pdf(?:-take)?"[^>]*>/g)].map((m) => m[0]);
  assert.equal(links.length, 2, 'Download PDF above the fold and again under "Take it with you"');
  for (const a of links) {
    assert.match(a, /href="\/program-briefs\/axal-vc-spinout-lab-v1\.pdf"/);
    assert.match(a, /download="axal-vc-spinout-lab-v1\.pdf"/);
  }
  assert.match(html, /<button type="button" class="pgs-print" data-testid="program-print">/);
  assert.doesNotMatch(html, /Save as PDF/);
  const t = renderedText(html);
  assert.match(t, /Download PDF 5 slides · 16:9 · Edition 1 · November 2026/);
  assert.match(html, /<h1 class="pgs-h1" id="pgs-h1">Spin-Out Lab<\/h1>/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, 'one h1');
  // The five sections in their fixed order.
  const order = ['Who it helps', 'What they do', 'How participation works', 'Access required', 'Next step']
    .map((s) => html.indexOf(`</span>${s}</div>`));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), 'sections out of order');
  // Apply, Sign in and the licence enquiry keep their destinations.
  assert.match(html, /data-testid="program-action-apply" href="\/spinout-lab\/apply"/);
  assert.match(html, /data-testid="program-action-signin" href="\/login\?next=%2Fspinout-lab%2Fapply"/);
  assert.match(html, /data-testid="program-action-licence" href="\/contact\?topic=licence"/);
});

const OPEN = {
  cohort: { name: 'December 2026', start_date: '2026-12-01T05:00:00Z', close_at: '2026-11-25T04:59:00Z', places: 12 },
  zone: 'America/New_York', applications_open: true, places_unreadable: false,
};
const panel = (s) => renderedText(at('/spinout-lab/brief', h(LabAvailabilityPanel, { program: LAB, s, onRetry() {} })));

test('availability open: the cohort as read, in its zone, and Apply names it', () => {
  const s = labPanelState({ status: 'ok', data: OPEN });
  assert.deepEqual([s.state, s.name, s.starts, s.applyBy, s.closesAt, s.city, s.places], ['open', 'December 2026', '1 Dec 2026', '24 Nov 2026', '23:59', 'New York', 12]);
  const t = panel(s);
  assert.match(t, /Cohort December 2026 Starts 1 Dec 2026 Apply by 24 Nov 2026 Places 12/);
  assert.match(t, /Applications close at 23:59 New York time\./);
  assert.match(t, /Apply to December 2026 →/);
  assert.equal(applyLabel(s), 'Apply to December 2026 →');
});

test('availability closed: no Apply anywhere on the page, and the label stays "By application"', () => {
  const s = labPanelState({ status: 'ok', data: { ...OPEN, applications_open: false } });
  assert.equal(s.state, 'closed');
  const html = at('/spinout-lab/brief', h(LabAvailabilityPanel, { program: LAB, s, onRetry() {} }));
  assert.match(renderedText(html), /Applications are closed\. The next cohort date is not set yet\./);
  assert.doesNotMatch(html, /\/spinout-lab\/apply/);
  assert.match(renderedText(html), /By application/);
  assert.ok(!contentFor(s).next.actions.some((a) => a.id === 'apply'), 'the Next step band drops Apply while closed');
  assert.ok(contentFor(labPanelState({ status: 'ok', data: OPEN })).next.actions.some((a) => a.id === 'apply'));
});

test('availability unavailable: says so, never "closed", and keeps Apply to the next cohort', () => {
  const s = labPanelState({ status: 'error' });
  assert.equal(s.state, 'unavailable');
  const t = panel(s);
  assert.match(t, /Unavailable/);
  assert.match(t, /This is not a statement that applications are closed\./);
  assert.doesNotMatch(t, /Applications are closed/);
  assert.match(t, /Apply to the next cohort →/);
});

test('availability blank fields: Not recorded, never 0; loading: a skeleton in the card\'s shape', () => {
  const s = labPanelState({ status: 'ok', data: { ...OPEN, cohort: { ...OPEN.cohort, places: null }, places_unreadable: true } });
  assert.equal(s.places, null);
  const t = panel(s);
  assert.match(t, /Places Not recorded/);
  assert.doesNotMatch(t, /Places 0/);
  const zero = labPanelState({ status: 'ok', data: { ...OPEN, cohort: { ...OPEN.cohort, places: 0 } } });
  assert.equal(zero.places, null, 'a zero is not a cohort size');
  const nameless = panel(labPanelState({ status: 'ok', data: { ...OPEN, cohort: { ...OPEN.cohort, name: null } } }));
  assert.match(nameless, /Cohort Not recorded/);
  assert.match(nameless, /Apply to the next cohort →/);
  const loading = at('/spinout-lab/brief', h(LabAvailabilityPanel, { program: LAB, s: labPanelState({ status: 'loading' }), onRetry() {} }));
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Apply to the next cohort →/);
});

// ── /programs and /programs/:key ────────────────────────────────────────────

function Where() { return h('output', { 'data-at': useLocation().pathname + useLocation().search }); }
const routed = (path) => at(path, h(Routes, null,
  h(Route, { path: '/programs/:key', element: h(ProgramKeyPage) }),
  h(Route, { path: '*', element: h(Where) })));

test('/programs/<key> resolves to the canonical page, keeping the query; an unknown key gets its own page', () => {
  assert.deepEqual(
    (({ kind, to }) => ({ kind, to }))(resolveKey('spinout-lab', '?ref=deck', '#how')),
    { kind: 'redirect', to: '/spinout-lab/brief?ref=deck#how' },
  );
  assert.equal(resolveKey('not-a-program').kind, 'missing');
  const miss = renderedText(routed('/programs/not-a-program'));
  assert.match(miss, /We could not find that programme\./);
  assert.match(miss, /See all programs →/);
  assert.doesNotMatch(routed('/programs/not-a-program'), /href="\/admin\//, 'no admin link');
  assert.equal(ogTagsFor('/programs/x', { robots: 'noindex' }).robots, 'noindex');
});

test('/programs lists every mapped program, and only those, with its presentation and PDF', () => {
  const html = at('/programs', h(ProgramsIndexPage));
  const cards = [...html.matchAll(/data-testid="programs-index-card-([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cards, PROGRAMS.map((p) => p.key));
  assert.doesNotMatch(renderedText(html), /Labelled example/, 'no example card published as a program');
  assert.match(html, /data-testid="programs-index-view-spinout-lab" href="\/spinout-lab\/brief"/);
  assert.match(html, /href="\/program-briefs\/axal-vc-spinout-lab-v1\.pdf" download="axal-vc-spinout-lab-v1\.pdf"/);
  assert.equal(labLine({ status: 'error' }).kind, 'unavailable');
  assert.equal(labLine({ status: 'ok', data: { applications_open: false } }).kind, 'closed');
  assert.equal(labLine({ status: 'ok', data: OPEN }).text, 'Applications open · December 2026 · apply by 24 Nov 2026');
});

test('both routes are public, refreshable signed out, and previewed with their own title', async () => {
  const mod = read('frontend/src/routes/programs.jsx');
  assert.match(mod, /<Route path="\/programs" element=\{<ProgramsIndexPage \/>\} \/>/);
  assert.match(mod, /<Route path="\/programs\/:key" element=\{<ProgramKeyPage \/>\} \/>/);
  assert.doesNotMatch(mod, /guard\(|authOnly\(|hqOnly\(/);
  for (const p of ['/programs', '/programs/', '/programs/spinout-lab', '/spinout-lab/brief']) assert.ok(isPublicPath(p), p);
  assert.ok(!isPublicPath('/programsx'));
  assert.equal(ogTagsFor('/programs').title, 'Programs — Axal VC StudioOS');
  const og = await programOgRoutes();
  const lab = og.find((r) => r.path === '/spinout-lab/brief');
  assert.deepEqual(lab.overrides, LAB.og);
  assert.equal(ogTagsFor(lab.path, lab.overrides).title, 'Spin-Out Lab · Programs — Axal VC StudioOS');
  assert.equal(ogTagsFor(lab.path, lab.overrides).url, 'https://axal.vc/spinout-lab/brief');
  assert.match(read('frontend/public/sitemap.xml'), /<loc>https:\/\/axal\.vc\/programs<\/loc>/);
});

// ── The admin entry points (PGS07) and /events (PGS08C) ─────────────────────

test('admin: a mapped program\'s name opens its presentation and Open reads Manage program; others are unchanged', () => {
  const name = at('/admin/programs', h(PresentationName, { programKey: 'spinout-lab', name: 'Spin-Out Lab', hint: true }));
  assert.match(name, /<a [^>]*aria-label="Spin-Out Lab, presentation"[^>]*href="\/spinout-lab\/brief"/);
  assert.match(renderedText(name), /Opens the presentation · \/spinout-lab\/brief/);
  assert.doesNotMatch(at('/admin/programs', h(PresentationName, { programKey: 'no-such-program', name: 'No such program' })), /<a /);

  const door = h(Link, { to: '/admin/programs/spinout-lab', 'aria-label': 'Open Spin-Out Lab' }, 'Open');
  const managed = at('/admin/programs', manageDoor(door, 'spinout-lab', 'Spin-Out Lab'));
  assert.match(managed, /aria-label="Manage program: Spin-Out Lab" class="whitespace-nowrap" href="\/admin\/programs\/spinout-lab"[^>]*>Manage program<\/a>/);
  assert.match(at('/admin/programs', manageDoor(door, 'spinout-lab', 'Spin-Out Lab', 'Manage')), />Manage<\/a>/);
  const unmapped = h(Link, { to: '/admin/programs/no-such-program' }, 'Open');
  assert.match(at('/admin/programs', manageDoor(unmapped, 'no-such-program', 'No such program')), />Open<\/a>/);
  const frag = h(React.Fragment, null, h(Link, { to: '/a' }, 'Open'), h(Link, { to: '/b' }, 'Other'));
  assert.match(at('/', manageDoor(frag, 'spinout-lab', 'Spin-Out Lab')), />Manage program<\/a><a href="\/b"[^>]*>Other<\/a>/);

  assert.match(at('/admin/programs/spinout-lab', h(ViewPresentationLink, { programKey: 'spinout-lab' })), /href="\/spinout-lab\/brief"[^>]*>.*View presentation/);
  assert.equal(at('/admin/programs/no-such-program', h(ViewPresentationLink, { programKey: 'no-such-program' })), '');

  const cat = codeOnly(read('frontend/src/pages/admin/programs/ProgramsCatalogue.jsx'));
  assert.equal((cat.match(/<PresentationName programKey=\{p\.key\}/g) || []).length, 3, 'card, desktop row and phone row');
  assert.equal((cat.match(/manageDoor\(/g) || []).length, 3, 'card, desktop row and phone row');
  assert.match(codeOnly(read('frontend/src/pages/admin/lab/AdminLab.jsx')), /<ViewPresentationLink programKey=\{LAB_KEY\} \/>\s*<Link to="\/admin\/programs\/spinout-lab\/preview"/);
  assert.match(codeOnly(read('frontend/src/pages/admin/programs/ProgramFrame.jsx')), /<ViewPresentationLink programKey=\{program\} \/>/);
});

test('/events: "See all programs →" goes to the index, beside the Programs heading', () => {
  const src = codeOnly(read('frontend/src/pages/events/PublicEventsPage.jsx'));
  assert.match(src, /<h2 id="ax-n2-programs" className="ax-n2-k">Programs<\/h2>\s*<Link to="\/programs" className="ax-link ax-n2-all" data-testid="events-all-programs">See all programs →<\/Link>/);
});
