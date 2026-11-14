/**
 * D1077 (#2969, part 5 of #2425) — the public trust center on the published
 * store (D1075), with the Status strip (D1076), the matrix, the change log,
 * subscribe, the report dialog, and its states, phone and shell.
 *
 *  1. The model: a block is loading, unreadable, fallback (never published:
 *     the page's own lines) or ready (each line with its Checked date); the
 *     strip draws the worst day across monitored services and never calls a
 *     Not recorded day a good one; nothing missing is a zero.
 *  2. Mounted on a stubbed fetch: a failed status tile leaves the rest drawn
 *     (TRU17a); a failed store read is Unreadable with Try again; a block the
 *     store lacks says Not recorded; no changes reads TRU15c; no listed
 *     subprocessor reads counsel's line (TRU4v).
 *  3. Subscribe posts once and says to check the inbox; the report dialog is
 *     signed in only and sends the three fields.
 *  4. Phone at 390: no matrix and no header buttons, the tiles still drawn.
 *  5. Wiring: signed in, the six public addresses render inside the app shell.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/trust_center_d1077.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import TrustCenter from '../src/pages/site/TrustCenter.jsx';
import {
  CHECKED_WAIT, FALLBACK, NO_CHANGES, SUBPROCESSORS_WAIT, blockOf, certificationsTile, changesOf, checkedLine, dayWord, lastReviewed,
  matrixCell, statusStrip, subprocessorsOf,
} from '../src/pages/site/trustCenterModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ready = (data) => ({ status: 'ready', data });
const UNREAD = { unreadable: true, message: 'This part could not be read just now. Try again.' };

const lines = (...xs) => xs.map(([text, checked_at, why]) => (why ? { text, recorded: false, why, checked_at: null } : { text, recorded: true, why: null, checked_at }));
const BLOCK = (key, label, groups, published_at = '2026-10-14T09:00:00Z') => ({ key, label, body: { intro: null, groups }, checked_at: '2026-10-14', published_at });
const TRUST = {
  blocks: {
    glance: BLOCK('glance', 'At a glance', [{ title: 'Security', lines: lines(['HTTPS everywhere, with HSTS.', '2026-10-14']) }, { title: 'Money', lines: lines(['Investors pass an identity check before they invest.', '2026-09-02']) }]),
    security: BLOCK('security', 'Security', [{ title: 'Encryption', lines: lines(['Files are encrypted with AES-GCM before storage.', '2026-08-14'], ['Last recovery drill', null, 'No recovery drill has been recorded yet.']) }], '2026-08-14T09:00:00Z'),
    data: null, subprocessors: null, certifications: null, documents: null, disclosure: null,
  },
  subprocessors: { items: [
    { uid: 's1', name: 'Vendor A', purpose: 'Hosting', data: 'Account data', location: 'United States', starts_at: '2025-01-10', active: true },
    { uid: 's2', name: 'Vendor F', purpose: 'Error monitoring', data: 'Error reports', location: 'United States', starts_at: '2026-11-03', active: false },
  ], last_change: '2026-09-02T10:00:00Z' },
  changes: { items: [{ uid: 'c1', published_at: '2026-09-02T10:00:00Z', note: 'Vendor E added for support routing.', blocks: [{ key: 'subprocessors', label: 'Subprocessors' }], subprocessors: [] }], complete: true },
  read_at: '2026-10-25T10:00:00Z',
};
const MATRIX = {
  profiles: [{ key: 'founder', label: 'Founder' }, { key: 'investor', label: 'Investor' }],
  rows: [
    { key: 'tos', label: 'Terms of Service', cells: { founder: { asked: 'always', renews_months: null }, investor: { asked: 'always', renews_months: null } } },
    { key: 'role_nda', label: 'Role NDA', cells: { founder: { asked: 'always', renews_months: 24 }, investor: null } },
  ],
};
const cells = (nr, rec, bad = {}) => [
  ...Array.from({ length: nr }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, status: 'not_recorded' })),
  ...Array.from({ length: rec }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, status: bad[i] || 'no_incident' })),
];
const STATUS = { services: [
  // The degraded day comes first, so a later good day must not overwrite it.
  { name: 'Files', status: 'operational', history: cells(3, 4, { 2: 'degraded' }), records_since: '2026-10-01' },
  { name: 'API', status: 'operational', history: cells(3, 4), records_since: '2026-10-01' },
  { name: 'MCP', status: 'unknown', monitoring: 'not_monitored', history: cells(0, 0) },
] };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The stubbed Worker: each read answers its fixture or a function of the request. */
function worker(o = {}) {
  const f = { trust: TRUST, status: STATUS, matrix: MATRIX, subscribe: { ok: true, message: 'Check your inbox.' }, report: { uid: 'r1', status: 'open' }, changes: TRUST.changes, ...o };
  const answer = (v, init) => (typeof v === 'function' ? v(init) : json(v));
  return (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const p = u.pathname.replace(/^\/api/, '');
    if (p === '/public/trust') return answer(f.trust, init);
    if (p === '/public/trust/matrix') return answer(f.matrix, init);
    if (p === '/public/trust/changes') return answer(f.changes, init);
    if (p === '/public/trust/subprocessors/subscribe') return answer(f.subscribe, init);
    if (p === '/public/status') return answer(f.status, init);
    if (p === '/help/security-reports') return answer(f.report, init);
    return json({}, 404);
  };
}

async function mount(url, handle, { user = null, phone = false, inShell = false } = {}) {
  const restore = installDocument();
  const meta = { getAttribute: () => '', setAttribute() {}, remove() {} };
  document.head = { querySelector: () => meta, appendChild() {} };
  document.getElementById = () => null;
  // The site frame forces the light theme on <html> (useForcedLightTheme).
  const classes = new Set();
  document.documentElement = { dataset: {}, classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, innerWidth: globalThis.innerWidth };
  const requests = [];
  globalThis.fetch = async (u, init = {}) => { requests.push({ url: String(u), method: String(init.method || 'GET'), body: init.body }); return handle(String(u), init); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  if (globalThis.window) { window.matchMedia = globalThis.matchMedia; window.innerWidth = phone ? 390 : 1440; }
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const page = h(TrustCenter, { inShell });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, user ? h(AuthProvider, null, page) : page)); });
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent || '' : n?.childNodes?.length ? n.childNodes.map(textOf).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const all = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  const ev = { preventDefault() {}, stopPropagation() {} };
  return {
    requests, flush,
    text: () => textOf(container),
    textOf: (id) => textOf(byId(id)),
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    all: (id) => all(id).map(textOf),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id}`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(ev); }); await flush(); },
    async press(label) {
      const n = walk(container).find((x) => String(x.tagName).toUpperCase() === 'BUTTON' && textOf(x).trim() === label);
      assert.ok(n, `no button ${label}`);
      await act(async () => { await props(n).onClick(ev); }); await flush();
    },
    async type(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async submit(id) { await act(async () => { await props(byId(id)).onSubmit(ev); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      if (user) localStorage.removeItem('user');
      restore();
    },
  };
}

/* ------------------------------------------------------------------ *
 * 1. The model
 * ------------------------------------------------------------------ */

test('the model: each block in its state; a published line carries its Checked date; never published keeps the page\'s own lines', () => {
  assert.equal(blockOf({ status: 'loading' }, 'security').state, 'loading');
  assert.equal(blockOf({ status: 'error' }, 'security').state, 'unreadable');
  assert.equal(blockOf(ready({ ...TRUST, blocks: UNREAD }), 'security').state, 'unreadable', 'a blocks part the Worker could not read');
  const fallback = blockOf(ready(TRUST), 'data');
  assert.equal(fallback.state, 'fallback');
  assert.deepEqual(fallback.groups, FALLBACK.data);
  assert.ok(fallback.groups.flatMap((g) => g.lines).every((l) => l.checked_at === null), 'the page\'s own lines carry no Checked date');
  const sec = blockOf(ready(TRUST), 'security');
  assert.equal(sec.state, 'ready');
  assert.deepEqual(sec.groups[0].lines.map((l) => [l.text, l.recorded, checkedLine(l.checked_at)]), [
    ['Files are encrypted with AES-GCM before storage.', true, 'Checked 14 Aug 2026'], ['Last recovery drill', false, CHECKED_WAIT],
  ]);
  assert.equal(sec.groups[0].lines[1].why, 'No recovery drill has been recorded yet.');
  assert.equal(checkedLine(null), 'Checked: Not recorded');
  assert.equal(dayWord('2026-13-01'), null, 'no made-up day');
  // A stored line with no text is dropped, never drawn half-read.
  const odd = blockOf(ready({ ...TRUST, blocks: { ...TRUST.blocks, data: BLOCK('data', 'Data', [{ title: 'x', lines: [{ text: '' }, { text: 'Real', recorded: true, checked_at: '2026-10-01' }] }]) } }), 'data');
  assert.deepEqual(odd.groups[0].lines.map((l) => l.text), ['Real']);
  assert.equal(lastReviewed(ready(TRUST)), 'Last reviewed 14 Oct 2026');
  assert.equal(lastReviewed(ready({ ...TRUST, blocks: { glance: null } })), 'Last reviewed: Not recorded');
  assert.equal(lastReviewed({ status: 'error' }), null);
});

test('the model: tiles, subprocessors, changes and the matrix in words; none listed is counsel\'s line; nothing missing is a zero', () => {
  assert.deepEqual(certificationsTile(ready(TRUST)), { state: 'ready', value: 'None held', sub: 'We list a certification here only after an auditor issues it.' });
  const held = certificationsTile(ready({ ...TRUST, blocks: { ...TRUST.blocks, certifications: { key: 'certifications', body: { items: [{ name: 'SOC 2 Type I', auditor: 'An auditor', issued_on: '2026-09-01', report_on_file: true }] } } } }));
  assert.equal(held.value, '1 held');
  assert.equal(held.sub, 'SOC 2 Type I, issued by An auditor');
  const subs = subprocessorsOf(ready(TRUST));
  assert.deepEqual(subs.items.map((x) => x.since), ['10 Jan 2025', 'From 3 Nov 2026'], 'one not started yet says From');
  assert.equal(subs.lastChange, '2 Sep 2026');
  assert.deepEqual(subprocessorsOf(ready({ ...TRUST, subprocessors: { items: [], last_change: null } })), { state: 'review', line: SUBPROCESSORS_WAIT });
  assert.equal(subprocessorsOf(ready({ ...TRUST, subprocessors: UNREAD })).state, 'unreadable');
  const ch = changesOf(TRUST.changes);
  assert.deepEqual(ch.items[0].date, { m: 'SEP', d: '02', y: '2026' });
  assert.equal(ch.items[0].text, 'Subprocessors · Vendor E added for support routing.');
  assert.equal(changesOf({ items: [], complete: true }).state, 'empty');
  assert.equal(changesOf(UNREAD).state, 'unreadable');
  assert.deepEqual(matrixCell(null), { text: '—', tip: 'Not asked of this profile', asked: false });
  assert.equal(matrixCell({ asked: 'always', renews_months: null }).text, 'Required');
  assert.equal(matrixCell({ asked: 'always', renews_months: 24 }).text, 'Renew every 24 months');
  assert.equal(matrixCell({ asked: 'when_it_applies', renews_months: null }).text, 'When it applies');
});

test('the strip: the worst day across monitored services; a Not recorded day is never a good one; the count is of recorded days, never a percentage', () => {
  const s = statusStrip(ready(STATUS));
  assert.equal(s.state, 'ready');
  assert.deepEqual(s.cells.map((c) => c.status), ['not_recorded', 'not_recorded', 'not_recorded', 'no_incident', 'no_incident', 'degraded', 'no_incident']);
  assert.equal(s.line, 'Days with no incident reported: 3 of 4 days recorded');
  assert.equal(s.title, 'Status · records began on 1 Oct 2026');
  assert.doesNotMatch(`${s.line} ${s.alt}`, /%|uptime/i);
  assert.equal(statusStrip({ status: 'error' }).state, 'unreadable');
  assert.equal(statusStrip(ready({ services: [{ name: 'MCP', monitoring: 'not_monitored', history: [] }] })).state, 'none');
  const before = statusStrip(ready({ services: [{ name: 'API', history: cells(5, 0), records_since: '2026-12-01' }] }));
  assert.equal(before.line, 'Not recorded yet: records begin on 1 Dec 2026');
});

/* ------------------------------------------------------------------ *
 * 2. Mounted: the overview and its states
 * ------------------------------------------------------------------ */

test('TRU17a: the status tile fails and the rest of the overview still draws, each fact with its Checked date', async () => {
  const v = await mount('/trust', worker({ status: () => json({ error: 'down' }, 503) }));
  try {
    assert.equal(v.textOf('trust-status-line'), 'Status could not be read.');
    assert.match(v.textOf('trust-status'), /The rest of the page reads as usual\./);
    assert.ok(v.has('trust-status-strip-unreadable'), 'the strip says so too, with Try again');
    assert.equal(v.textOf('trust-certifications-value'), 'None held');
    assert.equal(v.textOf('trust-subprocessors-value'), '2 listed');
    assert.match(v.textOf('trust-glance'), /HTTPS everywhere, with HSTS\.Checked 14 Oct 2026/);
    assert.match(v.textOf('trust-glance'), /Money/);
    assert.match(v.textOf('trust-matrix'), /Role NDARenew every 24 months—/);
    assert.equal(v.props('trust-matrix-role_nda') ? true : false, true);
    assert.equal(v.all('trust-change').length, 1);
    assert.match(v.textOf('trust-changes'), /SEP022026Subprocessors · Vendor E added for support routing\./);
    assert.equal(v.textOf('trust-reviewed'), 'Last reviewed 14 Oct 2026');
    assert.equal(v.props('trust-center')['data-frame'], 'site', 'signed out: the public site frame');
  } finally { await v.close(); }
});

test('the strip draws the worst day, a Not recorded day dashed and never green, and the count line', async () => {
  const v = await mount('/trust', worker());
  try {
    assert.equal(v.textOf('trust-status-count'), 'Days with no incident reported: 3 of 4 days recorded');
    assert.match(v.props('trust-status-cells')['aria-label'], /3 of 4 days recorded; the 3 days before records began are not recorded\./);
    assert.equal(v.textOf('trust-status-line'), 'All systems operational');
  } finally { await v.close(); }
});

test('a failed store read is Unreadable with Try again, never the page\'s lines passed off as current; Try again reads again', async () => {
  let n = 0;
  const v = await mount('/trust', worker({ trust: () => { n += 1; return n === 1 ? json({ error: 'down' }, 503) : json(TRUST); } }));
  try {
    assert.ok(v.has('trust-glance-unreadable'));
    assert.ok(!v.has('trust-glance'), 'no fallback lines in its place');
    assert.ok(v.has('trust-changes-unreadable'));
    assert.match(v.textOf('trust-status-line'), /All systems operational/, 'the status still answers');
    await v.press('Try again');
    assert.equal(n, 2);
    assert.ok(v.has('trust-glance'));
  } finally { await v.close(); }
});

test('TRU15c and never-published blocks: no changes reads its line; a block the store lacks keeps Not recorded', async () => {
  const empty = { ...TRUST, blocks: { glance: null, security: null, data: null, subprocessors: null, certifications: null, documents: null, disclosure: null }, changes: { items: [], complete: true } };
  const v = await mount('/trust', worker({ trust: empty }));
  try {
    assert.match(v.textOf('trust-changes-empty'), new RegExp(NO_CHANGES));
    assert.equal(v.props('trust-glance')['data-source'], 'fallback');
    assert.match(v.textOf('trust-glance'), new RegExp(`Axal VC Management LLC is the data controller\\.${CHECKED_WAIT}`));
    assert.equal(v.textOf('trust-reviewed'), 'Last reviewed: Not recorded');
  } finally { await v.close(); }
  const sec = await mount('/trust/security', worker({ trust: empty }));
  try {
    assert.match(sec.text(), /Independent penetration test Not recordedNone is on record\./);
    assert.ok(!/Checked \d/.test(sec.text()), 'no Checked date on the page\'s own lines');
  } finally { await sec.close(); }
});

test('TRU4 and TRU4v: the listed companies, From for one not started; none listed is counsel\'s line', async () => {
  const v = await mount('/trust/subprocessors', worker());
  try {
    assert.deepEqual(v.all('trust-subprocessor'), ['Vendor AHostingAccount dataUnited States10 Jan 2025', 'Vendor FError monitoringError reportsUnited StatesFrom 3 Nov 2026']);
    assert.ok(!v.has('trust-subprocessors-review'));
  } finally { await v.close(); }
  const r = await mount('/trust/subprocessors', worker({ trust: { ...TRUST, subprocessors: { items: [], last_change: null } } }));
  try {
    assert.equal(r.textOf('trust-subprocessors-review'), `Subprocessors${SUBPROCESSORS_WAIT}`);
    assert.ok(!r.has('trust-subprocessors-list'));
  } finally { await r.close(); }
});

/* ------------------------------------------------------------------ *
 * 3. Subscribe and the report dialog
 * ------------------------------------------------------------------ */

test('Subscribe posts the address once and says to check the inbox; a refusal is the Worker\'s sentence', async () => {
  let reply = () => json({ error: 'subscriptions_unconfigured', code: 'subscriptions_unconfigured', message: 'Subscriptions are not open yet.' }, 503);
  const v = await mount('/trust/subprocessors', worker({ subscribe: () => reply() }));
  try {
    assert.ok(v.props('trust-subscribe-go').disabled, 'no address, no send');
    await v.type('trust-subscribe-email', 'ana@example.com');
    await v.submit('trust-subscribe-form');
    assert.equal(v.textOf('trust-subscribe-refusal'), 'Subscriptions are not open yet.');
    reply = () => json({ ok: true, message: 'x' });
    await v.submit('trust-subscribe-form');
    const sent = v.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/public/trust/subprocessors/subscribe'));
    assert.equal(sent.length, 2);
    assert.deepEqual(JSON.parse(sent[1].body), { email: 'ana@example.com', turnstileToken: '', hp: '' });
    assert.match(v.textOf('trust-subscribe-done'), /Check your inbox to confirm\./);
  } finally { await v.close(); }
});

test('TRU6: signed out the third way is Sign in to report; signed in it opens the dialog and sends the three fields', async () => {
  const out = await mount('/trust/disclosure', worker());
  try {
    assert.equal(out.props('trust-report-signin').href, '/login?next=%2Ftrust%2Fdisclosure');
    assert.ok(!out.has('trust-report-open'));
    assert.match(out.text(), /PGP key Not recordedNone is published/);
  } finally { await out.close(); }
  const v = await mount('/trust/disclosure', worker(), { user: { id: 7, role: 'founder', name: 'Ana' } });
  try {
    await v.click('trust-report-open');
    assert.ok(v.has('trust-report-dialog'));
    assert.ok(v.props('trust-report-send').disabled, 'nothing to send yet');
    await v.type('trust-report-affected', 'Data room');
    await v.type('trust-report-what', 'A link opens another member\'s file.');
    await v.click('trust-report-send');
    const sent = v.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/help/security-reports'));
    assert.equal(sent.length, 1);
    assert.deepEqual(JSON.parse(sent[0].body), { affected: 'Data room', what_happened: 'A link opens another member\'s file.' });
    assert.ok(v.has('trust-report-done'));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * 4. Phone, and 5. the shell
 * ------------------------------------------------------------------ */

test('TRU19a, phone at 390: the tiles and the cards, no matrix and no header buttons', async () => {
  const v = await mount('/trust', worker(), { phone: true });
  try {
    assert.ok(v.has('trust-tiles'));
    assert.ok(v.has('trust-glance'));
    assert.ok(!v.has('trust-matrix'), 'the canvas leaves the matrix off the phone');
    assert.ok(!v.has('trust-subscribe-link'));
    assert.ok(!v.has('trust-reviewed'));
  } finally { await v.close(); }
});

test('TRU20: signed in, the six public addresses render inside the app shell, in the member\'s colours, with Your trust', async () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /const trustCenter = user\s*\? guard\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\], <TrustCenter inShell \/>\)\s*: <TrustCenter \/>;/);
  for (const p of ['/trust', '/trust/security', '/trust/data', '/trust/subprocessors', '/trust/documents', '/trust/disclosure']) {
    assert.ok(app.includes(`<Route path="${p}" element={trustCenter} />`), p);
  }
  const v = await mount('/trust', worker(), { user: { id: 7, role: 'founder', name: 'Ana' }, inShell: true });
  try {
    assert.equal(v.props('trust-center')['data-frame'], 'shell');
    assert.ok(v.has('trust-tab-me'));
  } finally { await v.close(); }
  const src = read('frontend/src/pages/site/TrustCenter.jsx');
  assert.match(src, /const CARD = '[^']*dark:bg-gray-900/, 'cards carry their dark colours');
  assert.doesNotMatch(src, /window\.(alert|confirm|prompt)|\balert\(|\bconfirm\(/);
});
