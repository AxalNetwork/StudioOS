/**
 * D677 (#1551) — the Firm, Platform and Administrators pages, built to the
 * owner's canvas `design/canvases/integrated/Axal VC Website.dc.html` (FIRM,
 * PLATFORM, ADMINISTRATORS).
 *
 * This pins:
 *   - each page's sections, in the canvas's order;
 *   - option B on Fund I: the band's first line and its link stay, and no
 *     Fund I figure ships (target, hard cap, check sizes, reserves);
 *   - the Firm page links the team page, which moved to /team;
 *   - every Platform module links a route `App.jsx` already serves, and the
 *     counts in their copy are read from the code;
 *   - every data flow is a link the code makes, and the ones it does not make
 *     stay out;
 *   - the DNS table is the Worker's own records (`licenceDomain.ts`);
 *   - the three paths stay reachable logged out (`isPublicPath`).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/firm_platform_admin_d677.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { escapeRe } from './_escapeRe.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const APP = read('frontend/src/App.jsx');
const FIRM_SRC = read('frontend/src/pages/site/FirmPage.jsx');
const DATA_SRC = read('frontend/src/lib/siteFirm.js');

const { default: FirmPage } = await import('../src/pages/site/FirmPage.jsx');
const { default: PlatformPage } = await import('../src/pages/site/PlatformPage.jsx');
const { default: AdministratorsPage } = await import('../src/pages/site/AdministratorsPage.jsx');
const site = await import('../src/lib/siteFirm.js');
const { DIMENSIONS } = await import('../src/lib/scoringViewModel.js');
const { SLIDE_META } = await import('../src/lib/pitchDeckViewModel.js');
const { numberWordCap } = await import('../src/lib/numberWords.js');
const { isPublicPath } = await import('../src/lib/api.js');
const worker = await import('../../cloudflare-worker/src/services/licenceDomain.ts');

const render = (Page) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Page)));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
// Whether App.jsx has a `<Route path="p"`: the text after each route's opening
// quote starts with the path, read by string search rather than a RegExp
// built from `p`.
const routed = (p) => APP.split(/<Route\s+path="/).slice(1).some((rest) => rest.startsWith(`${p}"`));

function assertOrder(html, ids, page) {
  let at = -1;
  for (const id of ids) {
    const i = html.indexOf(`id="${id}"`);
    assert.ok(i > at, `${page}: section ${id} is missing or out of order`);
    at = i;
  }
}

/* ------------------------------------------------------------------ FIRM -- */

test('Firm renders the canvas sections in order', () => {
  const html = render(FirmPage);
  assertOrder(html, ['fx-firm-h', 'fx-mission-h', 'fx-philosophy-h', 'fx-criteria-h', 'fx-fund-h'], 'Firm');
  assert.match(html, /We are early because that is where the outcome is decided\./);
  assert.match(html, /Four things, weighted in this order\./);
});

test('Firm links the team page at /team and the investor overview', () => {
  const html = render(FirmPage);
  assert.match(html, /<a[^>]*href="\/team"[^>]*>Meet the team →<\/a>/, 'the Firm page links the team page');
  assert.match(html, /<a[^>]*href="\/for-investors"[^>]*>Investor overview →<\/a>/, 'the band keeps its link');
});

test('Fund I ships as option B: the band line stays, no Fund I figure does', () => {
  const html = render(FirmPage);
  assert.match(html, /Fund I is open to qualified LPs\./, 'the band keeps its first line');
  for (const src of [code(FIRM_SRC), code(DATA_SRC), text(html)]) {
    for (const figure of [/\$20M/, /\$25M/, /\$100–150K/, /\$250K/, /hard cap/i, /vintage 2026/, /Concentration with reserves/, /30–40%/]) {
      assert.doesNotMatch(src, figure, `option B leaves ${figure} out until the owner answers #1551`);
    }
  }
  // Item 04 is out, so the philosophy is numbered 01–04 with no gap.
  assert.deepEqual(site.PHILOSOPHY.map((p) => p.n), ['01', '02', '03', '04']);
  assert.equal(site.PHILOSOPHY[3].t, 'Access is not the moat — process is');
});

/* -------------------------------------------------------------- PLATFORM -- */

test('Platform renders the layers, then the data flows', () => {
  const html = render(PlatformPage);
  assertOrder(html, ['fx-plat-h', 'fx-layers', 'fx-flows-h'], 'Platform');
  const layers = [...html.matchAll(/<h2 class="fx-layer-t">([^<]+)<\/h2>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.deepEqual(layers, ['Founder intelligence', 'Evidence capture', 'Execution systems', 'Formation & capital']);
});

test('every Platform module links a route App.jsx already serves', () => {
  const html = render(PlatformPage);
  const mods = site.PLATFORM_LAYERS.flatMap((l) => l.mods);
  assert.ok(mods.length >= 9, `the layers keep their modules (${mods.length})`);
  for (const m of mods) {
    assert.ok(m.to && routed(m.to), `${m.t} links ${m.to}, which App.jsx does not route — it would 404`);
    const card = new RegExp(`<a[^>]*class="fx-mod"[^>]*href="${m.to}"|<a[^>]*href="${m.to}"[^>]*class="fx-mod"`);
    assert.match(html, card, `the ${m.t} card is a link to ${m.to}`);
  }
  const cards = html.match(/class="fx-mod"/g) || [];
  assert.equal(cards.length, mods.length, 'every module card is a link, and nothing else is drawn as one');
});

test('the counts in the module copy are read from the code', () => {
  const html = text(render(PlatformPage));
  assert.match(html, new RegExp(`Scoring Engine ${numberWordCap(DIMENSIONS.length)} weighted dimensions`));
  assert.match(html, new RegExp(`Pitch Deck Builder ${numberWordCap(SLIDE_META.length)} slides generated`));
  // What the canvas claimed and the code does not do stays out.
  for (const claim of [/Nine weighted/, /evidence provenance/, /archetype blend/, /confidence bands/, /warm-intro routing/, /SAFE generation/, /measured rather than claimed/]) {
    assert.doesNotMatch(html, claim, `${claim} is not true of the code`);
  }
  assert.doesNotMatch(code(DATA_SRC), /'Nine |'Eleven /, 'a count in the module copy is read, never typed');
});

test('every data flow is a link the code makes', () => {
  const html = text(render(PlatformPage));
  const trace = {
    'Customer Discovery interviews': ['cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts', /const interviewQuotes = \(starred\.length > 0 \? starred : candidateQuotes\)/],
    'Use of Funds allocation': ['cloudflare-worker/src/services/decks/spinoutDeckData.ts', /useLabel: 'USE OF FUNDS'/],
    'Profiling skill gaps': ['cloudflare-worker/src/routes/advisors.ts', /skillComplementarity\(callerVectors\.skills/],
  };
  assert.deepEqual(site.DATA_FLOWS.map((d) => d.from), Object.keys(trace), 'only traced flows ship');
  for (const d of site.DATA_FLOWS) {
    const [file, link] = trace[d.from];
    assert.match(read(file), link, `${d.from} → ${d.to}: the link is gone from ${file}; drop the flow`);
    assert.ok(html.includes(d.from) && html.includes(d.to), `${d.from} → ${d.to} is drawn`);
  }
  assert.match(read('cloudflare-worker/src/routes/cofounder.ts'), /skillComplementarity\(viewerVectors\.skills/,
    'co-founder matching also reads the profiling skill vectors');
  // The flows nothing in the code makes stay out, and so do their sentences.
  for (const untraced of [/83\(b\)/, /LP report/, /traction dimension/i, /scoring dimensions select/i]) {
    assert.doesNotMatch(html, untraced, `${untraced} is not a link the code makes`);
  }
});

/* -------------------------------------------------------- ADMINISTRATORS -- */

test('Administrators renders the canvas sections in order', () => {
  const html = render(AdministratorsPage);
  assertOrder(html, ['fx-adm-h', 'admin-console', 'fx-console-h', 'fx-settings', 'fx-licence-h', 'fx-faq-h', 'fx-adm-close-h'], 'Administrators');
  const places = [...html.matchAll(/<div class="fx-place-n">(\d\d)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(places, ['01', '02', '03', '04', '05', '06', '07', '08'], 'the console\'s eight places, in order');
  assert.match(html, /<div class="fx-sketch" aria-hidden="true">/, 'the Studio sketch is decorative, as in the canvas');
  assert.equal((html.match(/class="fx-licence"/g) || []).length, 2, 'two kinds of licence');
  assert.equal((html.match(/class="fx-q"/g) || []).length, site.ADMIN_FAQ.length);
});

test('the licence buttons go to the contact topic and the console', () => {
  const html = render(AdministratorsPage);
  const requests = html.match(/<a[^>]*href="\/contact\?topic=licence"[^>]*>Request a licence<\/a>/g) || [];
  assert.equal(requests.length, 2, '"Request a licence" opens the contact page on the licence topic, twice');
  assert.match(html, /<a[^>]*href="#admin-console"[^>]*>See the console<\/a>/);
  assert.match(html, /<section id="admin-console"/, 'the console is the anchor\'s target');
});

test('the DNS table is the records the Worker asks for and checks', () => {
  const html = render(AdministratorsPage);
  const want = worker.recordsFor(site.DNS_EXAMPLE_HOST, 'TOKEN');
  assert.equal(site.DNS_EXAMPLE_HOST, 'app.yourterritory.com');
  assert.equal(site.DNS_RECORDS.length, want.length, 'two records');
  for (const rec of want) {
    const row = site.DNS_RECORDS.find((r) => r.type === rec.type);
    assert.ok(row, `the page draws the ${rec.type} record`);
    assert.equal(row.host, rec.name, `${rec.type} host is the Worker's`);
    if (rec.type === 'CNAME') {
      assert.equal(row.value, worker.CNAME_TARGET, 'the CNAME target is the Worker\'s');
    } else {
      assert.equal(`${row.value}TOKEN`, rec.value, 'the TXT value is the Worker\'s prefix with the licence\'s token');
      assert.ok(row.token, 'the token is named, not invented');
    }
    const cells = new RegExp(`<td>${rec.type}</td><td>${escapeRe(row.host)}</td><td>${escapeRe(row.value)}`);
    assert.match(html, cells, `the ${rec.type} row is drawn`);
  }
  assert.match(html, /Two records\. Your nameservers stay where they are\./);
});

test('Settings and the questions claim only what the console does', () => {
  const html = text(render(AdministratorsPage));
  assert.doesNotMatch(html, /powered-by/i, 'no powered-by setting exists');
  assert.doesNotMatch(html, /sets its own mark/, 'Super Admin captures the mark and colours at issue');
  assert.doesNotMatch(html, /KYB, and conflicts/, 'the Contracts place holds no KYB or conflict record');
  assert.deepEqual(site.ADMIN_SETTINGS_CHIPS, ['Hostname']);
});

/* ------------------------------------------------------------ THE PATHS -- */

test('the Firm, team, Platform and Administrators paths stay reachable logged out', () => {
  for (const p of ['/about', '/team', '/platform', '/administrators']) {
    assert.equal(isPublicPath(p), true, `${p} must not bounce a logged-out visitor to /login`);
  }
});
