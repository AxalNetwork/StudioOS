/**
 * D894 (#2434) — the Pitch deck studio at /raise/pitch, integrated from the
 * "Pitch Deck Studio" canvas and wired to the reads that already exist.
 *
 * What this file holds the studio to:
 *   · every figure is derived from a mounted read, and a value nobody recorded
 *     is "Not recorded", never 0 (views by week, seconds per slide, readers);
 *   · a read that fails is drawn as failed, and only the Worker's own empty
 *     card says nobody opened a link; a figure from a capped list says so;
 *   · a link is live only when it has not expired and is not used up, and only
 *     a link known to be dead offers no Withdraw; every link is reachable, a
 *     page at a time;
 *   · an admin reads (no New deck, New link or Withdraw), Review mounts the
 *     reviewer whatever the ventures read says, and no tab drops the venture;
 *   · the old `?mode=workspace` address opens the editor at its new address,
 *     the venture and the hash kept, with the moved notice drawn;
 *   · the routes, the back-links, the retargeted links and the retired page agree;
 *   · the canvas is committed in the intake queue, and the decision exists.
 *
 * The drawn-page checks render the studio's own components, with the reads
 * given in the Worker's shapes (server-rendered), or mount the whole studio
 * on a stubbed api so its reads run (`mount` below).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { api } from '../src/lib/api.js';
import { cyclesApi } from '../src/lib/api/cycles.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PitchStudio, { StudioAnalytics, StudioDecks } from '../src/pages/raise/pitch/PitchStudio.jsx';
import PitchWorkspacePage from '../src/pages/PitchWorkspacePage.jsx';
import {
  ANALYTICS_PATH, EDIT_PATH, LINE, MOVED_KEY, MOVED_NOTICE, NOT_RECORDED, NO_VENTURE, NO_VIEWS, REVIEW_PATH, STUDIO_PATH, TABS, TITLE,
  coverOf, currentVersion, dayLabel, funnelRows, isReadOnly, linkPage, linkRows, mmss, movedTarget, newLinkHref, noViewsYet,
  readerStats, slideCaption, slideSeconds, ventureQuery, versionRows, viewsState, weeklyViews,
} from '../src/pages/raise/pitch/pitchStudioModel.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

/* ------------------------------------------------------------------ *
 * Fixtures, in the shapes the Worker sends
 * ------------------------------------------------------------------ */

// GET /api/cycles/raise/modules/pitch-deck → card (raiseCycle.ts pitchDeckCard)
const cardOk = {
  slug: 'pitch-deck', state: 'ok', reason: null,
  series: [
    { kind: 'vbars', values: [0, 4, 9, 15, 22, 31, 0, 47], labels: [{ at: 0, label: '8 wk ago' }, { at: 7, label: 'This wk' }] },
    { kind: 'hbar', items: [{ label: 'Slide 1', value: 12 }, { label: 'Slide 2', value: 34 }, { label: 'Slide 5', value: 66 }] },
  ],
};
// Views exist, all older than eight weeks: the card is 'ok', its eight weeks zero.
const cardStale = {
  slug: 'pitch-deck', state: 'ok', reason: null,
  series: [
    { kind: 'vbars', values: [0, 0, 0, 0, 0, 0, 0, 0], labels: [{ at: 0, label: '8 wk ago' }, { at: 7, label: 'This wk' }] },
    { kind: 'hbar', items: [{ label: 'Slide 3', value: 95 }] },
  ],
};
const cardNoViews = { slug: 'pitch-deck', state: 'empty', series: null, reason: 'No one has opened a deck link yet.' };
const cardNoDeck = { slug: 'pitch-deck', state: 'empty', series: null, reason: 'No deck yet. Views per week appear here.' };
// safeCard's answer when the card's store throws, inside a module read that answers 200 (cycleCards.ts).
const cardUnreadable = { slug: 'pitch-deck', state: 'unreadable', series: null, next: null, reason: 'Deck share views could not be read' };
// … → records (raiseCycle.ts pitchRecords): 11 live, 12 withdrawn, 13 expired,
// 14 used up (the records cannot say so), 15 opened on another version, 16 never opened.
const link = (id, expires, views, extra = {}) => ({ id, cells: { link: `[Fund ${id}]`, expires, views, time: `${views} min`, most_read: views ? 'Slide 5' : null, ...extra } });
const records = {
  cols: [], total: 6, page: 1, page_size: 25,
  rows: [
    link(11, { text: '2026-11-04', tone: 'ok' }, 14, { link: '[Fund A]', time: '7 min' }),
    link(12, { text: 'Revoked', tone: 'muted' }, 0, { link: 'Link created 2 Oct', time: '0 min' }),
    link(13, { text: 'Expired', tone: 'muted' }, 1, { link: '', time: '0 min', most_read: 'Slide 1' }),
    link(14, { text: '2026-10-25', tone: 'ok' }, 1),
    link(15, { text: '2026-11-30', tone: 'ok' }, 2),
    link(16, { text: 'Never', tone: 'ok' }, 0),
  ],
  add: { text: 'New link', href: '/raise/pitch-deck/new?project=7' },
};
// GET /api/decks/:id/engagement (decks.ts): the current version's links and views.
const share = (id, viewCount, viewLimit) => ({
  id, created_at: '2026-10-20 10:00:00', expires_at: '2026-11-04 00:00:00', view_limit: viewLimit, view_count: viewCount,
  last_viewed_at: null, exhausted: viewCount >= viewLimit, revoked_at: null,
});
const engagement = {
  deck_id: 40, total_views: 5, total_read_seconds: 400, conversions: { signups: 0, nda_signed: 2, feedbacks: 0, deal_pack_opened: 0, deals_signed: 0 },
  shares: [share(11, 14, 100), share(14, 1, 1)],
  views: [
    { id: 1, ip_hash: 'a', ua_fingerprint: 'x', read_seconds: 60 },
    { id: 2, ip_hash: 'a', ua_fingerprint: 'x', read_seconds: 120 },
    { id: 3, ip_hash: 'b', ua_fingerprint: 'y', read_seconds: 30 },
    { id: 4, ip_hash: null, ua_fingerprint: null, read_seconds: 0 },
    { id: 5, ip_hash: null, ua_fingerprint: null, read_seconds: null },
  ],
};
// GET /api/decks/by-project/:pid, and GET /api/decks/:id with the template's title slide (methods.ts titleSlide).
const versions = { versions: [{ id: 40, version: 4, title: 'Seed', is_current: 1, created_at: '2026-10-20 10:00:00' }] };
const titleSlide = { title: 'Title', subtitle: 'Acme', fields: [{ key: 'headline', kind: 'title', value: 'Acme' }, { key: 'tagline', kind: 'subtitle', value: 'Close the books in a day.' }] };
const deck = { id: 40, version: 4, title: 'Acme — YC', slides: [titleSlide, { title: 'Problem' }] };

/* ------------------------------------------------------------------ *
 * Drawing the tabs from given reads, and mounting the studio
 * ------------------------------------------------------------------ */

const ok = (data) => ({ status: 'ok', data });
const idle = { status: 'idle', data: null };
const reads = (over = {}) => ({
  projects: ok([{ id: 7, name: 'Acme' }]), project: { id: 7, name: 'Acme' }, requested: '7',
  versions: ok(versions), module: ok({ card: cardOk, records }), deck: ok(deck), engagement: ok(engagement),
  setPage() {}, reload() {}, ...over,
});
const draw = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const analytics = (r, readOnly = false) => draw(h(StudioAnalytics, { reads: r, readOnly }));
const decks = (r, readOnly = false) => draw(h(StudioDecks, { reads: r, readOnly, q: '?project_id=7' }));
/** The markup from the tag that holds `from` up to the tag that holds `to`. */
const between = (html, from, to) => html.slice(html.lastIndexOf('<', html.indexOf(from)), to ? html.lastIndexOf('<', html.indexOf(to)) : undefined);

/** A promise the test settles by hand. */
const deferred = () => { let res; let rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, resolve: res, reject: rej }; };
const ORIGINAL = { api: { ...api }, deckReviewer: { ...api.deckReviewer }, cycles: { ...cyclesApi } };

/**
 * Mount the whole studio at `url` with the reads stubbed. `answers` maps a
 * read to a function of its arguments; each call is logged. A node's `focus()`
 * makes it `document.activeElement`, so a test can say where focus went.
 */
async function mount(element, url, answers, user = null) {
  const calls = [];
  const stub = (name, fn) => (...a) => { calls.push([name, ...a]); return fn(...a); };
  for (const [name, fn] of Object.entries(answers)) {
    if (name.startsWith('cycles.')) cyclesApi[name.slice(7)] = stub(name, fn);
    else api[name] = stub(name, fn);
  }
  api.deckReviewer = { ...api.deckReviewer, list: async () => ({ reviews: [] }) };
  if (!answers.getMe) api.getMe = async () => user;
  const restore = installDocument();
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { rootEl.render(h(MemoryRouter, { initialEntries: [url] }, user ? h(AuthProvider, null, element) : element)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, settle, pr,
    text: () => text(container).replace(/\s+/g, ' '),
    all: () => walk(container),
    async press(node) { await act(async () => { await pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() {
      await act(async () => rootEl.unmount()); restore();
      Object.assign(api, ORIGINAL.api); api.deckReviewer = ORIGINAL.deckReviewer; Object.assign(cyclesApi, ORIGINAL.cycles);
    },
  };
}

/* ------------------------------------------------------------------ *
 * The derivations
 * ------------------------------------------------------------------ */

test('views by week and seconds per slide come from the module card, every version together', () => {
  const w = weeklyViews(cardOk);
  assert.deepEqual(w, { values: [0, 4, 9, 15, 22, 31, 0, 47], total: 128, weeks: 8 });
  assert.equal(weeklyViews(cardNoViews), null, 'no series is no chart, not eight zeros');
  assert.equal(weeklyViews({ state: 'unreadable', series: null }), null);
  assert.deepEqual(weeklyViews(cardStale), { values: [0, 0, 0, 0, 0, 0, 0, 0], total: 0, weeks: 8 }, 'eight zero weeks is a count');
  const s = slideSeconds(cardOk);
  assert.deepEqual(s.map((r) => [r.index, r.seconds]), [[1, 12], [2, 34], [5, 66]]);
  assert.equal(slideCaption(s), 'Viewers spend longest on slide 5; slide 1 is read fastest.');
  assert.equal(slideCaption([]), null);
  assert.deepEqual(slideSeconds({ series: [{ kind: 'rows', items: [{ label: 'Seconds per slide', value: null }] }] }), []);
  assert.equal(noViewsYet(cardNoViews), true);
  assert.equal(noViewsYet(cardNoDeck), false, 'no deck is not "no one has opened a link"');
  assert.equal(noViewsYet(cardOk), false);
  assert.equal(noViewsYet(cardStale), false, 'views older than eight weeks are views');
});

test('only the Worker\'s own empty card says nobody opened a link; a card that could not be read is a failed read', () => {
  assert.equal(viewsState(cardOk, 'ok'), 'ok');
  assert.equal(viewsState(cardStale, 'ok'), 'ok');
  assert.equal(viewsState(cardNoViews, 'ok'), 'unopened');
  assert.equal(viewsState(cardNoDeck, 'ok'), 'no-deck');
  assert.equal(viewsState(cardUnreadable, 'ok'), 'failed', 'an unreadable card inside a 200 is not "no views"');
  assert.equal(viewsState(undefined, 'error'), 'failed');
  assert.equal(viewsState(undefined, 'ok'), 'failed', 'a module read with no card');
});

test('one version\'s readers: a viewer is a browser, the median skips unread views, and a missing NDA count is missing', () => {
  const r = readerStats(engagement);
  assert.equal(r.views, 5);
  assert.equal(r.viewers, 4, 'two views from one browser count once; a view with no fingerprint counts alone');
  assert.equal(r.medianSeconds, 60);
  assert.equal(r.ndaSigned, 2);
  assert.equal(r.capped, false);
  assert.equal(readerStats({ ...engagement, conversions: {} }).ndaSigned, null);
  assert.equal(readerStats(null), null);
  assert.equal(mmss(66), '1:06', 'the canvas drew [0:66]; it is 1:06');
  assert.equal(mmss(null), null, 'a missing time is not 0:00');
  assert.equal(mmss(0), '0:00');
});

test('figures from the capped view list say so: 200 views is "200+", and viewers and median cover the latest 200', () => {
  // decks.ts reads `deck_share_views … LIMIT 200` and counts total_views from that list.
  const many = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, ip_hash: `h${i % 150}`, ua_fingerprint: 'u', read_seconds: 30 }));
  const capped = { ...engagement, total_views: 200, conversions: { ...engagement.conversions, nda_signed: 250 }, views: many };
  assert.equal(readerStats(capped).capped, true);
  assert.equal(readerStats({ ...capped, total_views: 199, views: many.slice(1) }).capped, false);
  const t = renderedText(analytics(reads({ engagement: ok(capped) })));
  assert.match(t, /Views\s*200\+/, 'the views tile reads an exact 200');
  assert.match(t, /Unique viewers\s*150\s*one per browser, in the latest 200 views/);
  assert.match(t, /Median time\s*0:30\s*per view, over the latest 200/);
  assert.match(t, /NDA signed\s*250\s*signatures/, 'the NDA count is every signature, and is not capped');
  assert.match(t, /Opened\s*200\+/);
  assert.match(t, /as a share of its latest 200 views; the NDA count is every signature\./);
  assert.doesNotMatch(renderedText(analytics(reads())), /\+|latest 200/, 'under the cap nothing says "at least"');
});

test('NDA signed is a count of signatures, never "N of" browsers, and the funnel has one denominator from the same read', () => {
  // Two partners on one office network and browser: one viewer, two signatures.
  const twoSigners = {
    ...engagement, total_views: 2, conversions: { ...engagement.conversions, nda_signed: 2 },
    views: [{ id: 11, share_token_id: 1, ip_hash: 'h', ua_fingerprint: 'u', read_seconds: 60 }, { id: 12, share_token_id: 2, ip_hash: 'h', ua_fingerprint: 'u', read_seconds: 30 }],
  };
  const s = readerStats(twoSigners);
  assert.deepEqual([s.viewers, s.ndaSigned], [1, 2]);
  // The denominator is the version's views; a bar never passes its track.
  assert.deepEqual(funnelRows(s).map((r) => [r.label, r.n, r.width]), [['Opened', 2, 100], ['Accepted the NDA', 2, 100]]);
  assert.deepEqual(funnelRows({ views: 4, ndaSigned: 1 }).map((r) => r.width), [100, 25]);
  assert.deepEqual(funnelRows({ views: 4, ndaSigned: 9 }).map((r) => r.width), [100, 100]);
  assert.deepEqual(funnelRows(null).map((r) => [r.n, r.width]), [[null, 0], [null, 0]]);

  const a = analytics(reads({ engagement: ok(twoSigners) }));
  const t = renderedText(a);
  assert.doesNotMatch(t, /2 of 1/, 'a signature count is divided by browsers');
  assert.match(t, /NDA signed\s*2\s*signatures on this version's links/);
  assert.match(t, /Opened\s*2\s*Accepted the NDA\s*2\s*On the current version, as a share of its views\./);
  const widths = [...a.matchAll(/width:(\d+)%/g)].map((m) => Number(m[1]));
  assert.deepEqual(widths, [100, 100]);
  assert.match(between(a, 'pitch-studio-funnel'), /class="h-2\.5 overflow-hidden rounded-full/, 'the track clips its bar');
  const d = renderedText(decks(reads({ engagement: ok(twoSigners) })));
  assert.doesNotMatch(d, /2 of 1/);
  assert.match(d, /NDA signed\s*2\s*signatures on links to the current version/);
});

test('a link is live only when it has not expired and is not used up, and only a dead one offers no Withdraw', () => {
  const rows = linkRows(records, engagement);
  assert.equal(rows.length, 6, 'a withdrawn, expired or used-up link is still listed');
  assert.deepEqual(rows.map((r) => [r.id, r.live, r.expires]), [
    [11, true, '2026-11-04'],
    [12, false, 'Revoked'],
    [13, false, 'Expired'],
    [14, false, 'Used up'],
    [15, null, '2026-11-30'],
    [16, true, 'Never'],
  ]);
  assert.equal(rows[0].investor, '[Fund A]');
  assert.equal(rows[2].investor, 'Investor not recorded');
  assert.equal(rows[1].mostRead, null);
  assert.equal(linkRows(records)[0].live, null, 'with no engagement read, an opened link\'s views left are not known');
  assert.equal(newLinkHref(records), '/raise/pitch-deck/new?project=7');
  assert.equal(newLinkHref({ add: { href: 'https://elsewhere.test/x' } }), null, 'only the module\'s own form');
  assert.equal(newLinkHref({ add: { text: 'Build your deck', href: '/raise/pitch' } }), null);

  const a = analytics(reads());
  // 2026-10-24 (D894 review, R1): a link whose views left are not known (15)
  // keeps Withdraw, as before the fix: only a link known to be dead loses it.
  for (const id of [11, 15, 16]) assert.match(a, new RegExp(`data-testid="pitch-studio-withdraw-${id}"`), `link ${id}, live or not known, has no Withdraw`);
  for (const id of [12, 13, 14]) assert.doesNotMatch(a, new RegExp(`data-testid="pitch-studio-withdraw-${id}"`), `dead link ${id} offers Withdraw`);
  assert.match(renderedText(between(a, 'pitch-studio-link-14', 'pitch-studio-link-15')), /\[Fund 14\]\s*Used up/);
  assert.match(renderedText(between(a, 'pitch-studio-link-15', 'pitch-studio-link-16')), /Views left not read/);
  assert.doesNotMatch(between(a, 'pitch-studio-link-15', 'pitch-studio-link-16'), /emerald/, 'a link not known to be live is drawn live');
  // While the engagement read runs, and after it fails, the row says so instead.
  const running = analytics(reads({ engagement: { status: 'loading', data: null } }));
  assert.match(renderedText(between(running, 'pitch-studio-link-11', 'pitch-studio-link-12')), /Reading views left…/);
  assert.match(running, /data-testid="pitch-studio-withdraw-11"/, 'an opened link loses Withdraw while the engagement read runs');
  const failedEng = analytics(reads({ engagement: { status: 'error', data: null } }));
  assert.match(renderedText(between(failedEng, 'pitch-studio-link-11', 'pitch-studio-link-12')), /Views left could not be read/);
  assert.doesNotMatch(renderedText(failedEng), /Views left not read/, 'a failed engagement read is drawn as views left not read');
  assert.doesNotMatch(between(a, 'pitch-studio-link-14', 'pitch-studio-link-15'), /emerald/, 'a used-up link is drawn live');
});

test('every investor link is reachable: the links read a page at a time, under a pager with the read\'s own total', () => {
  const rowsOf = (n, from = 1) => Array.from({ length: n }, (_, i) => link(from + i, { text: '2026-11-04', tone: 'ok' }, 0));
  assert.deepEqual(linkPage({ rows: rowsOf(25), total: 30, page: 1, page_size: 25 }), { page: 1, pages: 2, total: 30, from: 1, to: 25 });
  assert.deepEqual(linkPage({ rows: rowsOf(5, 26), total: 30, page: 2, page_size: 25 }), { page: 2, pages: 2, total: 30, from: 26, to: 30 });
  assert.equal(linkPage({ state: 'unreadable', rows: [], total: null, page: 1, page_size: null }), null);
  const page1 = analytics(reads({ module: ok({ card: cardOk, records: { ...records, rows: rowsOf(25), total: 30 } }) }));
  assert.match(renderedText(between(page1, 'pitch-studio-links-pager')), /Links 1–25 of 30\s*Previous\s*Next/);
  assert.match(page1, /disabled=""[^>]*data-testid="pitch-studio-links-prev"/);
  assert.doesNotMatch(page1, /disabled=""[^>]*data-testid="pitch-studio-links-next"/);
  assert.match(renderedText(between(analytics(reads()), 'pitch-studio-links-pager')), /^Links 1–6 of 6$/, 'one page: the total, and no pager buttons');
});

test('the cover reads the title slide\'s headline and tagline, never its section name', () => {
  assert.deepEqual(coverOf(deck), { headline: 'Acme', sub: 'Close the books in a day.', slides: 2 });
  // POST /generate: slide 1 is a section ("Problem") with the venture's name as subtitle, and no fields.
  const generated = coverOf({ title: 'Acme — Pitch deck', slides: [{ title: 'Problem', subtitle: 'Acme' }] });
  assert.equal(generated.headline, 'Acme — Pitch deck');
  assert.equal(generated.sub, '', 'the venture\'s name is already the eyebrow');
  assert.equal(coverOf({ title: 'Deck title', slides: [] }).headline, 'Deck title');
  assert.equal(coverOf({ slides: [{ title: 'Title' }] }).headline, 'Title', 'the section name only when nothing else is there');
  // The drawn cover: the eyebrow, the headline and the tagline, then the deck's own line.
  const cover = renderedText(between(decks(reads()), 'pitch-studio-cover', 'pitch-studio-open'));
  assert.match(cover, /^AcmeAcmeClose the books in a day\.Acme · v4/);
  assert.doesNotMatch(cover, /Title/, 'the cover reads the slide\'s section name');
});

test('versions newest first, and a missing date says so', () => {
  const list = [
    { id: 3, version: 2, title: '', created_at: '2026-10-02 09:00:00' },
    { id: 4, version: 4, title: 'Seed', created_at: '2026-10-20 10:00:00', is_current: 1 },
    { id: 2, version: 1, title: 'First', created_at: null },
  ];
  assert.equal(currentVersion(list).id, 4);
  assert.deepEqual(versionRows(list).map((r) => [r.label, r.title, r.saved, r.current]), [
    ['v4', 'Seed', '20 Oct', true], ['v2', 'Untitled deck', '2 Oct', false], ['v1', 'First', 'Date not recorded', false],
  ]);
  assert.equal(dayLabel('not a date'), 'Date not recorded');
  // D898: Audience, Round and By. A version saved before migration 539 reads each as Not recorded.
  const withMeta = [
    { id: 5, version: 5, audience: 'seed_fund', round: { uid: 'r1', name: 'Seed' }, by: { id: 2, name: 'Fay Founder' }, created_at: '2026-10-21T09:00:00Z' },
    { id: 1, version: 1, audience: null, round: null, by: null, created_at: '2026-08-14T09:00:00Z' },
    { id: 3, version: 3, audience: 'family_office', round: { uid: 'r2', name: ' ' }, by: { id: 4, name: '' }, created_at: '2026-09-01T09:00:00Z' },
  ];
  assert.deepEqual(versionRows(withMeta).map((r) => [r.label, r.audience, r.round, r.by]), [
    ['v5', 'Seed fund', 'Seed', 'Fay Founder'],
    ['v3', 'Not recorded', 'Not recorded', 'Not recorded'],
    ['v1', 'Not recorded', 'Not recorded', 'Not recorded'],
  ]);
});

test('an admin reads; everyone else the route admits works here', () => {
  assert.equal(isReadOnly({ role: 'admin' }), true, 'an admin reads the studio (PD21)');
  assert.equal(isReadOnly({ role: 'founder' }), false);
  assert.equal(isReadOnly({ role: 'exploring', spinout_lab_active: 1, founder_id: 9 }), false, 'a Lab member on their own venture is read-only');
  // The drawn page: no New link and no Withdraw for a reader, no New deck on an empty Decks tab.
  const a = analytics(reads(), true);
  assert.doesNotMatch(a, /pitch-studio-withdraw-|pitch-studio-new-link/);
  assert.match(analytics(reads()), /pitch-studio-new-link/);
  const empty = reads({ versions: ok({ versions: [] }), module: ok({ card: cardNoDeck, records: { rows: [], total: 0, page: 1, page_size: 25 } }) });
  assert.doesNotMatch(decks(empty, true), /pitch-studio-empty-new/);
  assert.match(decks(empty), /pitch-studio-empty-new/);
  const src = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  assert.match(src, /showNew=\{tab === 'decks' && !readOnly && Boolean\(projectId\)\}/, 'an admin is offered New deck in the header (PD21)');
});

test('the old ?mode=workspace address opens the editor with the moved notice drawn, the venture and the hash kept', () => {
  assert.deepEqual(movedTarget('?mode=workspace&project_id=12', '#slide-3'), { pathname: EDIT_PATH, search: `?project_id=12&moved=${MOVED_KEY}`, hash: '#slide-3' });
  assert.equal(MOVED_NOTICE, 'Pitch deck has a new address. Update your bookmark.');
  const editor = (url) => renderedText(renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, h(PitchWorkspacePage))));
  assert.ok(editor(`/raise/pitch/edit?moved=${MOVED_KEY}&project_id=12`).includes(MOVED_NOTICE), 'the editor never draws the moved notice');
  assert.ok(!editor('/raise/pitch/edit?project_id=12').includes(MOVED_NOTICE), 'the notice shows without the moved key');
  assert.equal(ventureQuery(12), '?project_id=12');
  assert.equal(ventureQuery(null), '');
  // D905 (#2684) adds the Notes tab (PD21).
  assert.deepEqual(TABS.map((t) => [t.label, t.path]), [['Decks', STUDIO_PATH], ['Review', REVIEW_PATH], ['Share & analytics', ANALYTICS_PATH], ['Notes', '/raise/pitch/notes']]);
  assert.equal(TITLE, 'Pitch deck studio');
  assert.doesNotMatch(LINE, /Every figure shows its source/, 'the source chips are #2434 part 2; the line waits for them');
  assert.equal(NOT_RECORDED, 'Not recorded');
});

/* ------------------------------------------------------------------ *
 * The drawn tabs
 * ------------------------------------------------------------------ */

test('a views card that could not be read is drawn as a failed read on both tabs, never as "nobody opened a link"', () => {
  const failedCard = reads({ module: ok({ card: cardUnreadable, records }) });
  const a = analytics(failedCard);
  assert.match(a, /data-testid="pitch-studio-views-error"/);
  assert.match(renderedText(between(a, 'pitch-studio-views-error', 'pitch-studio-links')), /Views on your links could not be read\.\s*Try again/);
  assert.ok(!renderedText(a).includes(NO_VIEWS), 'a failed read reads as no views');
  assert.match(a, /data-testid="pitch-studio-link-11"/, 'the links read on their own');
  const d = decks(failedCard);
  assert.match(d, /data-testid="pitch-studio-views-error"/);
  assert.ok(!renderedText(d).includes(NO_VIEWS));
  const failedRead = analytics(reads({ module: { status: 'error', data: null } }));
  assert.match(renderedText(failedRead), /Your investor links and the views on them could not be read\.\s*Try again/);
  assert.ok(!renderedText(failedRead).includes(NO_VIEWS));
  // The Worker's own empty card still says it, on both tabs; no deck does not.
  assert.ok(renderedText(analytics(reads({ module: ok({ card: cardNoViews, records }) }))).includes(NO_VIEWS));
  assert.ok(renderedText(decks(reads({ module: ok({ card: cardNoViews, records }) }))).includes(NO_VIEWS));
  assert.ok(!renderedText(analytics(reads({ module: ok({ card: cardNoDeck, records: { rows: [] } }) }))).includes(NO_VIEWS));
});

test('views older than eight weeks are drawn as a count, and every other figure still shows', () => {
  const stale = reads({ module: ok({ card: cardStale, records }) });
  const d = renderedText(decks(stale));
  assert.match(d, /Views by week\s*0 views in the last 8 weeks, every version/);
  assert.match(d, /Most read slide\s*Slide 3\s*1:35/);
  assert.match(d, /NDA signed\s*2/);
  assert.ok(!d.includes(NO_VIEWS));
  const a = analytics(stale);
  assert.match(a, /data-testid="pitch-studio-tiles"/);
  assert.match(a, /data-testid="pitch-studio-seconds"/);
  assert.match(a, /data-testid="pitch-studio-funnel"/);
  assert.ok(!renderedText(a).includes(NO_VIEWS));
});

test('a failed versions read says so on the tiles and the funnel, and leaves no skeleton waiting', () => {
  const a = analytics(reads({ versions: { status: 'error', data: null }, deck: idle, engagement: idle }));
  const tiles = between(a, 'pitch-studio-tiles', 'pitch-studio-seconds');
  assert.doesNotMatch(tiles, /animate-pulse/, 'the tiles wait for an engagement read that is never made');
  assert.equal((renderedText(tiles).match(/Could not be read/g) || []).length, 4);
  assert.match(renderedText(between(a, 'pitch-studio-funnel', 'pitch-studio-links')), /Funnel\s*Could not be read\./);
});

test('the seconds-per-slide chart scrolls inside its card at phone width instead of widening the page', () => {
  const many = { ...cardOk, series: [cardOk.series[0], { kind: 'hbar', items: Array.from({ length: 20 }, (_, i) => ({ label: `Slide ${i + 1}`, value: 300 + i })) }] };
  const a = analytics(reads({ module: ok({ card: many, records }) }));
  assert.match(a, /<section class="[^"]*\bmin-w-0\b[^"]*" data-testid="pitch-studio-seconds"/, 'the grid item grows to the chart\'s width');
  assert.match(a, /<div class="[^"]*\boverflow-x-auto\b[^"]*" role="img" aria-label="Slide 1: 300 seconds/, 'the bars do not scroll inside the card');
});

/* ------------------------------------------------------------------ *
 * The mounted studio: its reads run
 * ------------------------------------------------------------------ */

const reviewer = /Drop your deck here or click to browse/;

test('Review mounts the reviewer whatever the ventures read says, and draws no "Read only." banner', async () => {
  for (const listProjects of [async () => [], async () => { throw new Error('read failed'); }]) {
    const m = await mount(h(PitchStudio, { tab: 'review' }), '/raise/pitch/review', { listProjects });
    try {
      assert.match(m.text(), reviewer, 'a founder with no venture, or a failed read, cannot reach the reviewer');
      assert.match(m.text(), /You can still upload a deck below without a startup\./);
      assert.ok(!m.text().includes(NO_VENTURE));
      assert.doesNotMatch(m.text(), /Your ventures could not be read/);
    } finally { await m.unmount(); }
  }
  const admin = { id: 1, role: 'admin' };
  const answers = { listProjects: async () => [{ id: 7, name: 'Acme' }], deckListVersions: async () => versions, deckGet: async () => deck, deckEngagement: async () => engagement, 'cycles.module': async () => ({ card: cardOk, records }) };
  const review = await mount(h(PitchStudio, { tab: 'review' }), '/raise/pitch/review?project_id=7', answers, admin);
  try {
    assert.ok(!review.by('pitch-studio-readonly'), 'Review tells an admin it is read only, above a reviewer that writes');
    assert.match(review.text(), reviewer);
  } finally { await review.unmount(); }
  const home = await mount(h(PitchStudio, { tab: 'decks' }), '/raise/pitch?project_id=7', answers, admin);
  try {
    assert.ok(home.by('pitch-studio-readonly'), 'an admin is not told the studio is read only');
    assert.ok(!home.by('pitch-studio-new'), 'an admin is offered New deck');
  } finally { await home.unmount(); }
});

test('the tabs keep the venture in the address while the ventures read is loading, and after it fails', async () => {
  const hrefs = (html) => [...html.matchAll(/data-testid="pitch-studio-tab-\w+" href="([^"]*)"/g)].map((x) => x[1]);
  const loading = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/raise/pitch?project_id=12'] }, h(PitchStudio, { tab: 'decks' })));
  assert.deepEqual(hrefs(loading), ['/raise/pitch?project_id=12', '/raise/pitch/review?project_id=12', '/raise/pitch/analytics?project_id=12', '/raise/pitch/notes?project_id=12']);
  const m = await mount(h(PitchStudio, { tab: 'analytics' }), '/raise/pitch/analytics?project_id=12', { listProjects: async () => { throw new Error('read failed'); } });
  try {
    assert.match(m.text(), /Your ventures could not be read/);
    assert.equal(m.pr(m.by('pitch-studio-tab-decks')).href, '/raise/pitch?project_id=12', 'a tab drops the venture after a failed read');
  } finally { await m.unmount(); }
});

test('a read run that has been superseded writes nothing: a late answer never puts the tiles back to loading', async () => {
  const late = deferred();
  let versionsCall = 0;
  let moduleCall = 0;
  const m = await mount(h(PitchStudio, { tab: 'analytics' }), '/raise/pitch/analytics?project_id=7', {
    listProjects: async () => [{ id: 7, name: 'Acme' }],
    // The first versions read answers last, naming an older current version.
    deckListVersions: () => (++versionsCall === 1 ? late.p : Promise.resolve({ versions: [{ id: 41, version: 5, is_current: 1 }] })),
    deckGet: async (id) => ({ id, slides: [] }),
    deckEngagement: async (id) => ({ ...engagement, deck_id: id }),
    'cycles.module': async () => { if (++moduleCall === 1) throw new Error('read failed'); return { card: cardOk, records }; },
  });
  try {
    assert.match(m.text(), /could not be read\. Try again/);
    await m.press(m.all().find((n) => n.tagName === 'BUTTON' && /Try again/.test((n.childNodes || []).map((c) => c.textContent || '').join(''))));
    assert.ok(m.by('pitch-studio-tiles'));
    await act(async () => { late.resolve({ versions: [{ id: 40, version: 4, is_current: 1 }] }); });
    await m.settle();
    assert.deepEqual(m.calls.filter(([n]) => n === 'deckEngagement').map(([, id]) => id), [41], 'the superseded run read on');
    assert.ok(!m.all().some((n) => /animate-pulse/.test(m.pr(n).className || '') && n !== m.by('pitch-studio-loading')), 'a tile went back to loading');
  } finally { await m.unmount(); }
});

test('after Withdraw the tab stays on screen through the re-read, focus goes to the result, and the row changes', async () => {
  const reread = deferred();
  let moduleCall = 0;
  const revoked = { ...records, rows: records.rows.map((r) => (r.id === 11 ? { ...r, cells: { ...r.cells, expires: { text: 'Revoked', tone: 'muted' } } } : r)) };
  const m = await mount(h(PitchStudio, { tab: 'analytics' }), '/raise/pitch/analytics?project_id=7', {
    listProjects: async () => [{ id: 7, name: 'Acme' }],
    deckListVersions: async () => versions,
    deckGet: async () => deck,
    deckEngagement: async () => engagement,
    'cycles.module': () => (++moduleCall === 1 ? Promise.resolve({ card: cardOk, records }) : reread.p),
    'cycles.recordAction': async () => ({ ok: true }),
  });
  try {
    await m.press(m.by('pitch-studio-withdraw-11'));
    assert.ok(m.by('pitch-studio-withdraw-dialog'));
    await m.press(m.by('pitch-studio-withdraw-confirm'));
    assert.deepEqual(m.calls.find(([n]) => n === 'cycles.recordAction').slice(1), ['raise', 7, 'pitch-deck', 11, 'revoke']);
    assert.ok(m.by('pitch-studio-link-11'), 'the re-read blanked the tab');
    assert.ok(!m.by('pitch-studio-loading'));
    assert.match(m.text(), /\[Fund A\]: the link no longer opens\./);
    assert.equal(m.pr(document.activeElement)['aria-label'], 'Dismiss', 'focus was left on a control the re-read removes');
    await act(async () => { reread.resolve({ card: cardOk, records: revoked }); });
    await m.settle();
    assert.ok(!m.by('pitch-studio-withdraw-11'), 'the withdrawn link still offers Withdraw');
    assert.match(m.text(), /\[Fund A\]: the link no longer opens\./);
    assert.equal(m.pr(document.activeElement)['aria-label'], 'Dismiss');
  } finally { await m.unmount(); }
});

test('the pager reads the next page of links through the module read\'s own page', async () => {
  const rowsOf = (n, from) => Array.from({ length: n }, (_, i) => link(from + i, { text: '2026-11-04', tone: 'ok' }, 0));
  const m = await mount(h(PitchStudio, { tab: 'analytics' }), '/raise/pitch/analytics?project_id=7', {
    listProjects: async () => [{ id: 7, name: 'Acme' }],
    deckListVersions: async () => versions,
    deckGet: async () => deck,
    deckEngagement: async () => engagement,
    'cycles.module': async (_c, _p, _s, q) => ({ card: cardOk, records: { ...records, rows: q?.page === 2 ? rowsOf(5, 26) : rowsOf(25, 1), total: 30, page: q?.page || 1 } }),
  });
  try {
    assert.match(m.text(), /Links 1\s*–\s*25 of 30/);
    await m.press(m.by('pitch-studio-links-next'));
    assert.deepEqual(m.calls.filter(([n]) => n === 'cycles.module').map(([, ...a]) => a), [['raise', 7, 'pitch-deck', { page: 1 }], ['raise', 7, 'pitch-deck', { page: 2 }]]);
    assert.match(m.text(), /Links 26\s*–\s*30 of 30/);
    assert.ok(m.by('pitch-studio-withdraw-30'), 'a link past the first page cannot be withdrawn');
  } finally { await m.unmount(); }
});

test('a page of links the read no longer has is drawn as reading, then goes back to the last page', async () => {
  // 2026-10-24 (D894 review, R2): a defensive guard. The records list every
  // link whatever its state, so the total shrinks only if links or versions
  // are removed underneath an open page; the stub shrinks it to reach page > pages.
  const rowsOf = (n, from) => Array.from({ length: n }, (_, i) => link(from + i, { text: '2026-11-04', tone: 'ok' }, 0));
  let total = 30;
  let held = null;
  const m = await mount(h(PitchStudio, { tab: 'analytics' }), '/raise/pitch/analytics?project_id=7', {
    listProjects: async () => [{ id: 7, name: 'Acme' }],
    deckListVersions: async () => versions,
    deckGet: async () => deck,
    deckEngagement: async () => engagement,
    'cycles.module': (_c, _p, _s, q) => {
      const page = q?.page || 1;
      const answer = { card: cardOk, records: { ...records, rows: page === 1 ? rowsOf(Math.min(25, total), 1) : rowsOf(Math.max(0, total - 25), 26), total, page } };
      if (total === 20 && page === 1) { held = deferred(); return held.p.then(() => answer); }
      return Promise.resolve(answer);
    },
    'cycles.recordAction': async () => { total = 20; return { ok: true }; },
  });
  try {
    await m.press(m.by('pitch-studio-links-next'));
    assert.match(m.text(), /Links 26\s*–\s*30 of 30/);
    await m.press(m.by('pitch-studio-withdraw-30'));
    await m.press(m.by('pitch-studio-withdraw-confirm'));
    await m.settle();
    // Page 2 answered empty with a total of 20; page 1 is still being read.
    assert.ok(held, 'the last page was not asked for');
    assert.ok(m.by('pitch-studio-links-reading'), 'a page past the end is not drawn as reading');
    assert.doesNotMatch(m.text(), /Links 0\s*–\s*0/, '"Links 0–0 of N" is drawn while the last page is read');
    assert.doesNotMatch(m.text(), /No investor link yet/, 'a venture with 20 links is drawn as having none');
    await act(async () => { held.resolve(); });
    await m.settle();
    assert.match(m.text(), /Links 1\s*–\s*20 of 20/);
    const pages = m.calls.filter(([n]) => n === 'cycles.module').map(([, , , , q]) => q.page);
    assert.deepEqual(pages.slice(-2), [2, 1], 'the empty page 2 is not followed by page 1');
  } finally { await m.unmount(); }
});

test('the cover and the links table never draw a bare dash for a value nobody wrote', () => {
  // 2026-10-24 (D894 review, R3): the Worker writes "—" into a field nobody filled.
  assert.deepEqual(coverOf({ title: 'Acme', slides: [{ fields: [{ key: 'title', value: 'Acme' }, { key: 'subtitle', value: '—' }] }] }), { headline: 'Acme', sub: '', slides: 1 });
  assert.equal(coverOf({ title: '—', slides: [{ title: 'Title', fields: [{ key: 'title', value: '—' }] }] }).headline, 'Title');
  // A dash anywhere in a cell or a tile, read from the markup (the flattened
  // text runs cells together, so a dash there would never stand alone).
  const noDash = (html, what) => assert.doesNotMatch(html, />\s*—\s*</, `a bare dash in ${what}`);
  const a = analytics(reads());
  noDash(a, 'the links table');
  assert.match(renderedText(between(a, 'pitch-studio-link-12', 'pitch-studio-link-13')), /Revoked\s*0\s*Not opened\s*Not opened/);
  // An opened link whose time reads "0 min" was never measured, or under half a minute.
  assert.match(renderedText(between(a, 'pitch-studio-link-13', 'pitch-studio-link-14')), /Expired\s*1\s*Not recorded\s*Slide 1/);
  // The tiles and the funnel with nothing recorded, and while the read runs.
  const bare = analytics(reads({ engagement: ok({ ...engagement, conversions: {}, views: [{ id: 1, read_seconds: 0 }] }) }));
  noDash(bare, 'a tile or the funnel');
  assert.match(renderedText(between(bare, 'pitch-studio-tiles')), /Median time\s*Not recorded/);
  assert.match(renderedText(between(bare, 'pitch-studio-tiles')), /NDA signed\s*Not recorded/);
  assert.match(renderedText(between(bare, 'pitch-studio-funnel')), /Accepted the NDA\s*Not recorded/);
  const running = analytics(reads({ engagement: { status: 'loading', data: null } }));
  noDash(running, 'the funnel while it reads');
  assert.match(renderedText(between(running, 'pitch-studio-funnel')), /Opened\s*Reading…/);
});

test('Withdraw on a link whose views left are unknown says it may already be closed', async () => {
  // 2026-10-24 (D894 review, R1): link 15 is another version's, opened; link 11 is live.
  const m = await mount(h(PitchStudio, { tab: 'analytics' }), '/raise/pitch/analytics?project_id=7', {
    listProjects: async () => [{ id: 7, name: 'Acme' }],
    deckListVersions: async () => versions,
    deckGet: async () => deck,
    deckEngagement: async () => engagement,
    'cycles.module': async () => ({ card: cardOk, records }),
  });
  try {
    await m.press(m.by('pitch-studio-withdraw-15'));
    assert.match(m.text(), /If \[Fund 15\]\s*'s link still opens, it stops at once\. Its views stay listed, and the link then reads Revoked\./);
    await m.press(m.all().find((n) => n.nodeName === 'BUTTON' && /^Cancel$/.test((n.textContent || '').trim())));
    await m.press(m.by('pitch-studio-withdraw-11'));
    assert.match(m.text(), /\[Fund A\]\s*'s link stops opening at once\. Its views stay listed\./);
    assert.doesNotMatch(m.text(), /If \[Fund A\]\s*'s link still opens/);
  } finally { await m.unmount(); }
});

test('after a Withdraw whose re-read fails, Dismiss hands focus to the tab, not the page body', async () => {
  // 2026-10-24 (D894 review, R5): the failed read takes the "By investor" heading away.
  let moduleCall = 0;
  const m = await mount(h(PitchStudio, { tab: 'analytics' }), '/raise/pitch/analytics?project_id=7', {
    listProjects: async () => [{ id: 7, name: 'Acme' }],
    deckListVersions: async () => versions,
    deckGet: async () => deck,
    deckEngagement: async () => engagement,
    'cycles.module': () => (++moduleCall === 1 ? Promise.resolve({ card: cardOk, records }) : Promise.reject(new Error('read failed'))),
    'cycles.recordAction': async () => ({ ok: true }),
  });
  try {
    await m.press(m.by('pitch-studio-withdraw-11'));
    await m.press(m.by('pitch-studio-withdraw-confirm'));
    await m.settle();
    assert.ok(m.by('pitch-studio-links-error'), 'the failed re-read is not drawn as failed');
    assert.ok(!m.all().some((n) => n.nodeName === 'H2' && /By investor/.test(n.textContent || '')), 'the heading is still there');
    const dismiss = m.all().find((n) => m.pr(n)['aria-label'] === 'Dismiss');
    await m.press(dismiss);
    assert.equal(m.pr(document.activeElement)['data-testid'], 'pitch-studio-analytics', 'focus fell to the page body');
  } finally { await m.unmount(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the routes: the studio\'s three tabs, the editor at its new address, and the old address redirecting', () => {
  const app = read('frontend/src/App.jsx');
  // A literal search, not a RegExp built from the path: nothing here needs a pattern.
  const route = (path) => `<Route path="${path}" element={guard(labRoles(['admin', 'founder'])`;
  for (const p of ['/raise/pitch/edit', '/raise/pitch/analytics', '/raise/pitch/review', '/raise/pitch/positioning', '/raise/pitch/notes']) assert.ok(app.includes(route(p)), p);
  // D905 (#2684), PD22: the studio's home also admits the roles it is not for, to tell them so.
  assert.ok(app.includes(`<Route path="/raise/pitch" element={guard(labRoles(['admin', 'founder', 'advisor', 'partner', 'exploring'])`), '/raise/pitch');
  assert.match(app, /get\('mode'\) === 'workspace'\s*\?\s*<PitchWorkspaceMoved \/>\s*:\s*founderEditor\(<PitchStudio tab="decks" \/>\)/);
  assert.match(app, /<Route path="\/raise\/pitch\/edit" element=\{guard\(labRoles\(\['admin', 'founder'\]\), founderWorkspace\('raise', founderEditor\(<PitchWorkspacePage \/>\)\)\)\} \/>/);
  assert.match(app, /<Route path="\/raise\/pitch\/analytics" element=\{guard\(labRoles\(\['admin', 'founder'\]\), founderEditor\(<PitchStudio tab="analytics" \/>\)\)\} \/>/);
  assert.match(app, /<Route path="\/raise\/pitch\/review" element=\{guard\(labRoles\(\['admin', 'founder'\]\), founderEditor\(<PitchStudio tab="review" \/>\)\)\} \/>/);
  assert.ok(!existsSync(resolve(root, 'frontend/src/pages/founder/FounderRaisePitch.jsx')), 'the read-only Pitch page is still on disk');
  assert.doesNotMatch(app, /FounderRaisePitch/);
  const moved = read('frontend/src/pages/raise/pitch/PitchWorkspaceMoved.jsx');
  assert.match(moved, /<Navigate to=\{movedTarget\(loc\.search, loc\.hash\)\} replace \/>/);
  const workspace = read('frontend/src/pages/PitchWorkspacePage.jsx');
  assert.match(workspace, /navigate\(`\$\{t\.to\}\$\{keep\}`\)/, 'a tab drops the venture again');
  assert.match(workspace, /\{ id: 'deck', to: EDIT_PATH,/, 'the Deck Builder tab lands on the studio home again (bug 3)');
});

test('every link that carried the old address carries the new one', () => {
  assert.match(read('frontend/src/pages/cycles/ValidateSections.jsx'), /<Link to="\/raise\/pitch\/edit" title=\{PROBLEM_SLIDE_NOTE\}/);
  const rail = read('frontend/src/lib/railOptions/founder.js');
  assert.doesNotMatch(rail, /\/raise\/pitch\?mode=workspace/);
  assert.equal((rail.match(/route: '\/raise\/pitch\/edit'/g) || []).length, 2);
  for (const f of ['frontend/src/workspaces/founderZoneActions.js', 'frontend/src/workspaces/founderZoneFilters.js']) {
    assert.doesNotMatch(read(f), /'raise\/pitch'/, `${f} still holds the retired Pitch zone`);
  }
  const src = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  assert.doesNotMatch(src, /mode=workspace/);
});

test('the studio reads only mounted routes, and no figure it draws is a sample', () => {
  const src = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  for (const call of ['api.listProjects()', 'api.deckListVersions(', "cyclesApi.module('raise', projectId, 'pitch-deck', { page })", 'api.deckGet(', 'api.deckEngagement(']) {
    assert.ok(src.includes(call), `the studio no longer calls ${call}`);
  }
  for (const sample of ['Northwind', '[$', '16,950', '0:66', '[128]']) assert.ok(!src.includes(sample), `a canvas sample reached the page: ${sample}`);
  assert.match(src, /<DeckReviewerPage embedded \/>/, 'the Review tab mounts the reviewer until #2434 part 6');
});

test('the canvas is committed in the intake queue, the rail canvas carries the deck models, and the decision exists', () => {
  const boards = read('design/incoming/Pitch Deck Studio · Boards.dc.html');
  for (const f of ['Pitch Deck Studio Page.dc.html', 'Pitch Deck Studio · Boards.dc.html']) {
    const html = read(`design/incoming/${f}`);
    assert.equal(/<script src="([^"]*)"/.exec(html)?.[1], './support.js', `${f}: the first script is the shared runtime`);
    for (const banned of ['@font-face', '__claude_design_branding']) assert.ok(!html.includes(banned), `${f} holds ${banned}`);
  }
  assert.match(boards, /dc-import name="Pitch Deck Studio Page"/);
  assert.match(read('design/canvases/integrated/AIRail.dc.html'), /'Pitch deck': 'deck'/);
  const decision = read('documentation/architecture/decisions/D894.md');
  assert.match(decision, /^## D894 — /);
  // The board count the documents state is the grid's own.
  const count = new Set(boards.match(/\{ id: 'PD\w+'/g)).size;
  assert.match(decision, new RegExp(`The canvas draws ${count} boards`));
  assert.match(read('design/incoming/README.md'), new RegExp(`lettered boards: ${count} in all`));
});
