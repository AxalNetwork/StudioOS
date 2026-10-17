/**
 * D680 (#1554) — Contact, the three legal pages and cookie preferences, built
 * to the owner's canvas `design/canvases/integrated/Axal VC Website.dc.html`
 * (CONTACT, LEGAL PAGES, COOKIE PREFERENCES).
 *
 * This pins:
 *   - the contact form's intents: the canvas's three, plus Licence only when
 *     `?topic=licence` asks for it, each one a key the Worker route accepts;
 *   - the form posting through the existing `request('/contact')` to the
 *     existing route, with the fields that route reads, its Turnstile and its
 *     honeypot; no sample cohort typed; the canvas's confidentiality line,
 *     printed only while the route keeps submissions off GitHub;
 *   - option A on the legal pages: each page's own text, date and address in
 *     the canvas layout, and none of the canvas's legal text;
 *   - every cookie row is a category the code really gates, every gate has a
 *     row, and turning the row off stops what it controls.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/contact_legal_cookies_d680.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const CANVAS = read('design/canvases/integrated/Axal VC Website.dc.html');
const CONTACT_SRC = read('frontend/src/pages/ContactPage.jsx');
const ROUTE_SRC = read('cloudflare-worker/src/routes/contact.ts');

// A storage the consent helpers can read, installed before any module that
// touches it is imported.
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    keys: () => [...m.keys()],
  };
}
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();

const contact = await import('../src/pages/ContactPage.jsx');
const { default: ContactPage } = contact;
const consent = await import('../src/lib/cookieConsent.js');
const { default: CookieConsent, CookiePreferencesDialog } = await import('../src/components/CookieConsent.jsx');

const render = (el, url = '/') => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, el));
// `&amp;` is decoded last, so an escaped entity (`&amp;lt;`) reads as the text
// `&lt;` it is, not as `<`.
const text = (html) => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();
const pills = (html) => [...html.matchAll(/<button type="button" class="ax-pill[^"]*" aria-pressed="(true|false)">([^<]+)<\/button>/g)]
  .map(([, on, label]) => ({ label: label.replace(/&amp;/g, '&'), on: on === 'true' }));

// The Worker route's own intent table, read from its source.
const ROUTE_INTENTS = (() => {
  const block = ROUTE_SRC.slice(ROUTE_SRC.indexOf('export const CONTACT_INTENTS'), ROUTE_SRC.indexOf('};', ROUTE_SRC.indexOf('export const CONTACT_INTENTS')));
  return Object.fromEntries([...block.matchAll(/^\s*(\w+): '([^']+)',$/gm)].map(([, k, v]) => [k, v]));
})();

// ---------------------------------------------------------------- Contact

test('the form offers the canvas\'s three intents, Spin-Out Lab first and pressed', () => {
  // The canvas's own list, read from its logic script.
  const canvasIntents = [...CANVAS.match(/const INTENTS = \[(.*?)\];/)[1].matchAll(/l:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(canvasIntents, ['Spin-Out Lab', 'Investing / LP', 'Advising']);
  assert.deepEqual(contact.INTENTS.map((i) => i.label), canvasIntents);

  const html = render(React.createElement(ContactPage), '/contact');
  assert.deepEqual(pills(html), [
    { label: 'Spin-Out Lab', on: true },
    { label: 'Investing / LP', on: false },
    { label: 'Advising', on: false },
  ], 'three pills, the first pressed, and no Licence without the topic');
  assert.match(html, /Application enquiry/);
  for (const placeholder of ['Full name', 'Email', 'Company or project name', 'Website, repo, or deck link (optional)',
    'What are you building, and what is the hardest unresolved question in it right now?']) {
    assert.ok(html.includes(`placeholder="${placeholder}"`), `the field "${placeholder}" is missing`);
  }
  assert.equal((html.match(/class="ax-contact-input"/g) || []).length, 5, 'five fields');
  assert.match(html, />Send enquiry →<\/button>/);
});

test('?topic=licence adds a fourth intent, Licence, and presses it', () => {
  const html = render(React.createElement(ContactPage), '/contact?topic=licence');
  assert.deepEqual(pills(html), [
    { label: 'Spin-Out Lab', on: false },
    { label: 'Investing / LP', on: false },
    { label: 'Advising', on: false },
    { label: 'Licence', on: true },
  ]);
  assert.equal(contact.initialIntent('licence'), 'licence');
  // Any other topic (Circles links `?topic=circle`) keeps the canvas's three.
  assert.deepEqual(contact.intentsFor('circle').map((i) => i.value), ['lab', 'invest', 'advise']);
  assert.equal(contact.initialIntent('circle'), 'lab');
  assert.equal(contact.initialIntent(null), 'lab');
});

test('every intent the page can send is one the Worker route accepts, under the same name', () => {
  assert.deepEqual(Object.keys(ROUTE_INTENTS), ['lab', 'invest', 'advise', 'licence']);
  for (const i of contact.intentsFor('licence')) {
    assert.equal(ROUTE_INTENTS[i.value], i.label, `the route does not accept "${i.value}" as ${i.label}`);
  }
});

test('the form posts through the existing request(\'/contact\') to the existing route, with the fields it reads', () => {
  const code = codeOnly(CONTACT_SRC);
  assert.match(code, /import \{ request \} from '\.\.\/lib\/api';/);
  assert.match(code, /await request\('\/contact', \{\s*method: 'POST',\s*body: JSON\.stringify\(contactPayload\(\{ intent, form, turnstileToken \}\)\),/);
  assert.equal((code.match(/request\(/g) || []).length, 1, 'one call, the contact post');
  // The route is the one already mounted, not a new one.
  assert.match(ROUTE_SRC, /contact\.post\('\/contact',/);
  assert.match(read('cloudflare-worker/src/index.ts'), /app\.route\('\/api', contactRoutes\);/);

  const body = contact.contactPayload({
    intent: 'invest',
    form: { name: 'N', email: 'n@example.com', company: 'C', link: ' https://example.com ', about: 'About the fund', hp: '' },
    turnstileToken: 'tok',
  });
  assert.deepEqual(body, {
    intent: 'invest', name: 'N', email: 'n@example.com', company: 'C', link: 'https://example.com',
    message: 'About the fund', hp: '', turnstileToken: 'tok',
  });
  for (const key of Object.keys(body)) {
    assert.match(ROUTE_SRC, new RegExp(`body\\.${key}\\b`), `the route never reads "${key}"`);
  }
  // The route still turns away a filled honeypot and checks Turnstile first.
  assert.match(ROUTE_SRC, /const hp = sanitize\(body\.hp, 100\);\s*if \(hp\) return c\.json\(\{ ok: true \}\);/);
  assert.match(ROUTE_SRC, /verifyTurnstile\(c\.env, turnstileToken, clientIp\)/);
  // The page keeps both: the off-screen honeypot and the Turnstile widget.
  assert.match(code, /name="hp"[\s\S]{0,120}tabIndex=\{-1\}/);
  assert.match(code, /loadTurnstile\(\)/);
});

test('the link check matches the route: empty, or http(s) up to 500 characters', () => {
  assert.equal(contact.isHttpLink(''), true);
  assert.equal(contact.isHttpLink('https://example.com/deck'), true);
  assert.equal(contact.isHttpLink('http://example.com'), true);
  for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'example.com', 'https://example.com/' + 'a'.repeat(481)]) {
    assert.equal(contact.isHttpLink(bad), false, bad.slice(0, 40));
  }
  assert.match(ROUTE_SRC, /export const MAX_CONTACT_LINK = 500;/);
  assert.equal(contact.MAX_LINK, 500);
});

test('the form is the only way in: no mail address is printed, and no canvas cohort is typed', () => {
  // Owner, 2026-10-12: "Remove the emails here, just keep the form." The
  // canvas's three addresses still route each intent server-side.
  const html = render(React.createElement(ContactPage), '/contact');
  assert.doesNotMatch(html, /mailto:/, 'the contact page links no mailbox');
  assert.doesNotMatch(text(html), /@axal\.vc/, 'the contact page prints no address');
  assert.equal(contact.contactRoutes, undefined, 'the address list is gone, not hidden');
  assert.match(html, /<form/, 'the form stays');
  assert.match(ROUTE_SRC, /export const CONTACT_MAILBOX/, 'each intent still reaches its mailbox');

  assert.doesNotMatch(codeOnly(CONTACT_SRC), /Cohort 5/, 'the canvas\'s cohort is an example');
  assert.equal(contact.sentNote('lab', { cohortNum: 9 }),
    'We reply within five business days. If Cohort 9 is full, we will tell you which cohort you are being held for.');
  assert.equal(contact.sentNote('lab', null),
    'We reply within five business days. If the open cohort is full, we will tell you which cohort you are being held for.');
  assert.equal(contact.sentNote('invest', { cohortNum: 9 }), 'We reply within five business days.',
    'the cohort sentence is about Lab applications only');
});

test('the canvas\'s confidentiality line is printed, and the route it describes keeps submissions off GitHub', () => {
  // The line is true only because the route stores a submission in D1 and
  // emails the firm's own mailbox (migration 448). It used to file each one as
  // an issue on AxalNetwork/StudioOS, a public repository; if a GitHub call
  // comes back, the line is false again and this fails.
  const html = render(React.createElement(ContactPage), '/contact');
  assert.ok(text(html).includes('Everything you send is confidential. We do not share applications outside the fund team.'),
    'the canvas\'s line is missing');
  const routeCode = ROUTE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // No `api.github.` anywhere in the code, so GitHub's API host fails this in
  // any URL or bare string. It is a ban on the text, not a URL check, so it
  // stops at the dot: every string that holds `api.github.com` still fails.
  assert.doesNotMatch(routeCode, /api\.github\./, 'contact.ts calls GitHub');
  assert.doesNotMatch(routeCode, /GITHUB_/, 'contact.ts reads a GitHub setting');
  assert.match(routeCode, /INSERT INTO contact_submissions/, 'the route stores the submission');
  assert.match(routeCode, /sendNotificationEmail\(/, 'the route emails the firm');
});

// ---------------------------------------------------------------- Legal pages

const LEGAL = [
  { file: 'TermsPage', title: 'Terms of Service', updated: 'July 8, 2026', email: 'legal@axal.vc', sections: 21,
    first: ['01', 'Definitions & parties'],
    own: ['Axal VC Management LLC is not a registered investment adviser or broker-dealer.',
      'These Terms and your use of the Platform are governed by the laws of the State of Delaware'] },
  { file: 'PrivacyPage', title: 'Privacy Policy', updated: 'March 31, 2026', email: 'privacy@axal.vc', sections: 9,
    first: ['00', 'Who we are'],
    own: ['in compliance with the Gramm-Leach-Bliley Act (GLBA), SEC Regulation S-P',
      'typically 7 years after the dissolution of a fund or termination of a relationship'] },
  { file: 'RiskDisclosuresPage', title: 'Risk Disclosures & Disclaimers', updated: 'March 31, 2026', email: 'legal@axal.vc', sections: 8,
    first: ['01', 'Loss of principal'],
    own: ['Investment in startups involves a high degree of risk and may result in the loss of your entire investment.',
      'Statistically, most startup companies fail.'] },
];

// Every sentence of the canvas's LEGAL object: its intros and section bodies.
const CANVAS_LEGAL = (() => {
  const block = CANVAS.slice(CANVAS.indexOf('const LEGAL = {'), CANVAS.indexOf('const legalLinks'));
  const strings = [...block.matchAll(/(?:intro|b):'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1].replace(/\\u2019/g, '’').replace(/\\u2014/g, '—').replace(/\\'/g, "'"));
  return strings.flatMap((s) => s.split(/(?<=[.;])\s+/)).map((s) => s.trim()).filter((s) => s.length > 25);
})();

test('option A: each legal page keeps its own text, date and address in the canvas layout', async () => {
  for (const page of LEGAL) {
    const { default: Page } = await import(`../src/pages/${page.file}.jsx`);
    const html = render(React.createElement(Page), '/');
    const body = text(html.slice(html.indexOf('<article'), html.indexOf('</article>')));
    assert.match(html, /<div class="ax-lbl-q">Legal<\/div>/, `${page.file}: the "Legal" eyebrow`);
    assert.match(html, new RegExp(`<h1 id="ax-legal-h" class="ax-legal-h1">${page.title.replace(/&/g, '&amp;')}</h1>`));
    assert.match(html, new RegExp(`<div class="ax-mono ax-legal-updated">Last updated ${page.updated}</div>`),
      `${page.file}: its own date, as "Last updated"`);
    assert.doesNotMatch(body, /July 1, 2026/, `${page.file}: the canvas's date`);
    assert.equal((html.match(/class="ax-legal-section"/g) || []).length, page.sections, `${page.file}: its own sections`);
    const [n, h] = page.first;
    assert.match(html, new RegExp(`<span class="ax-mono ax-legal-n">${n}</span><h2 id="ax-legal-s0" class="ax-legal-h2">${h.replace(/&/g, '&amp;')}</h2>`));
    for (const s of page.own) assert.ok(body.includes(s), `${page.file}: its own sentence "${s.slice(0, 50)}…" is gone`);
    assert.ok(body.endsWith(`Questions about this document? Write to ${page.email} .`),
      `${page.file}: the questions line names ${page.email}`);
    assert.match(html, new RegExp(`href="mailto:${page.email}"`));
  }
});

test('option A: none of the canvas\'s legal text appears on the live pages', async () => {
  assert.ok(CANVAS_LEGAL.length > 40, 'the canvas\'s legal sentences were read');
  const named = [
    'the courts of Geneva have exclusive jurisdiction',
    'Application data for declined applications is deleted after twelve months',
  ];
  for (const s of named) assert.ok(CANVAS_LEGAL.some((c) => c.includes(s)), `the canvas no longer says "${s}"`);
  for (const page of LEGAL) {
    const { default: Page } = await import(`../src/pages/${page.file}.jsx`);
    const body = text(render(React.createElement(Page), '/'));
    for (const s of [...named, ...CANVAS_LEGAL]) {
      assert.ok(!body.includes(s), `${page.file} carries the canvas's "${s.slice(0, 60)}…", which waits on the owner`);
    }
  }
});

// ---------------------------------------------------------------- Cookies

// Every category some module gates on, read from the source.
function gatedCategories() {
  const out = new Map();
  const walk = (dir) => {
    // The entry's own type from the listing: no separate stat of the path
    // before it is read.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const { name } = entry;
      const full = join(dir, name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jsx?|tsx?)$/.test(name)) {
        const rel = relative(ROOT, full);
        if (/lib\/cookieConsent\.js$|components\/CookieConsent\.jsx$/.test(rel)) continue;
        for (const [, cat] of codeOnly(readFileSync(full, 'utf8')).matchAll(/hasConsent\(\s*['"](\w+)['"]\s*\)/g)) {
          out.set(cat, [...(out.get(cat) || []), rel]);
        }
      }
    }
  };
  walk(resolve(ROOT, 'frontend/src'));
  return out;
}

test('every cookie row is a category the code really gates, and every gate has a row', () => {
  const rows = consent.COOKIE_ROWS;
  assert.equal(rows[0].key, 'essential');
  assert.equal(rows[0].locked, true, 'Essential is locked on');
  const optional = rows.filter((r) => !r.locked);
  for (const r of optional) assert.ok(consent.COOKIE_CATEGORIES.includes(r.key), `${r.key} is not a stored category`);
  const gated = gatedCategories();
  assert.deepEqual(optional.map((r) => r.key).sort(), [...gated.keys()].sort(),
    `rows ${optional.map((r) => r.key)} vs gates ${[...gated.keys()]}: a row with no gate does nothing, a gate with no row cannot be chosen`);
  // Each optional row's storage is really written by the module it names.
  for (const r of optional) {
    const src = read(r.controls.module);
    assert.ok(gated.get(r.key).includes(r.controls.module), `${r.controls.module} does not gate on ${r.key}`);
    for (const key of r.controls.storage) assert.ok(src.includes(`'${key}'`), `${r.controls.module} never writes ${key}`);
  }
  // The canvas's Preferences and Marketing rows have nothing behind them.
  assert.ok(!rows.some((r) => /^(Preferences|Marketing)$/.test(r.title)));
});

test('the dialog draws the canvas\'s pieces, Essential locked on and every optional row off by default', () => {
  localStorage.clear();
  const prefs = consent.getConsent().categories;
  const html = render(React.createElement(CookiePreferencesDialog, {
    prefs, saved: false, onToggle() {}, onSave() {}, onAcceptAll() {}, onClose() {},
  }));
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, />Cookie preferences<\/h2>/);
  assert.match(html, /We use a minimal set of cookies\. Essential cookies keep the workspaces signed in and cannot be disabled\. Everything else is optional and off by default\./);
  const rows = [...html.matchAll(/data-category="(\w+)"[\s\S]*?(<button type="button" role="switch"[^>]*>)/g)]
    .map(([, key, tag]) => ({ key, on: /aria-checked="true"/.test(tag), locked: /disabled=""/.test(tag) }));
  assert.deepEqual(rows, consent.COOKIE_ROWS.map((r) => ({ key: r.key, on: Boolean(r.locked), locked: Boolean(r.locked) })));
  assert.match(html, />Save preferences<\/button>/);
  assert.match(html, />Accept all<\/button>/);
  assert.doesNotMatch(html, /Preferences saved\./);
  assert.match(render(React.createElement(CookiePreferencesDialog, { prefs, saved: true })), /role="status">Preferences saved\.</);

  // With no optional category the dialog says so and shows only Essential.
  const bare = render(React.createElement(CookiePreferencesDialog, { rows: consent.COOKIE_ROWS.slice(0, 1), prefs }));
  assert.match(bare, /The site sets no optional cookies/);
  assert.doesNotMatch(bare, /Save preferences|Accept all/);
  assert.equal((bare.match(/role="switch"/g) || []).length, 1);
});

test('the banner names only the optional purposes the site has, and the footer\'s link opens the dialog', () => {
  localStorage.clear();
  const html = render(React.createElement(CookieConsent));
  assert.match(text(html), /for analytics purposes\./);
  assert.doesNotMatch(html, /functional|advertising/i);
  const src = codeOnly(read('frontend/src/components/CookieConsent.jsx'));
  assert.match(src, /window\.addEventListener\(OPEN_PREFERENCES_EVENT, onOpen\)/);
  assert.match(src, /if \(view === 'prefs'\) \{\s*return \(\s*<CookiePreferencesDialog/);
  assert.match(read('frontend/src/components/PublicFooter.jsx'), /onClick=\{openCookiePreferences\}/);
});

test('turning Analytics off stops the funnel tracker, and turning it off later erases what it kept', async () => {
  // A browser just big enough for lib/funnel.js: it wires itself to `window`
  // at import and gates every write and send on hasConsent('analytics').
  localStorage.clear();
  sessionStorage.clear();
  const sent = [];
  const win = new EventTarget();
  win.location = { search: '?utm_source=test', pathname: '/', origin: 'https://axal.vc' };
  globalThis.window = win;
  globalThis.document = { visibilityState: 'hidden', referrer: '', addEventListener() {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  const funnelKeys = consent.COOKIE_ROWS.find((r) => r.key === 'analytics').controls.storage;
  const kept = () => [...localStorage.keys(), ...sessionStorage.keys()].filter((k) => funnelKeys.includes(k));
  try {
    const { track } = await import('../src/lib/funnel.js');

    consent.saveConsent({ analytics: false });
    track('landing_view');
    assert.equal(sent.length, 0, 'off: nothing is sent');
    assert.deepEqual(kept(), [], 'off: nothing is kept');

    consent.saveConsent({ analytics: true });
    track('register_view');
    assert.equal(sent.length, 1, 'on: the event is sent');
    assert.equal(sent[0].url, '/api/track');
    assert.ok(kept().includes('axal:funnel_anon_id'), 'on: the random id is kept');

    consent.saveConsent({ analytics: false });
    assert.deepEqual(kept(), [], 'turned off: the id, the session and the attribution are erased');
    track('login_view');
    assert.equal(sent.length, 1, 'turned off: nothing more is sent');
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    globalThis.fetch = realFetch;
  }
});
