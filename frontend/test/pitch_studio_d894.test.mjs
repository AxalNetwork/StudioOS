/**
 * D894 (#2434) — the Pitch deck studio at /raise/pitch, integrated from the
 * "Pitch Deck Studio" canvas and wired to the reads that already exist.
 *
 * What this file holds the studio to:
 *   · every figure is derived from a mounted read, and a value nobody recorded
 *     is "Not recorded", never 0 (views by week, seconds per slide, readers);
 *   · the old `?mode=workspace` address opens the editor at its new address,
 *     the venture and the hash kept, with the moved notice;
 *   · the routes, the back-links, the retargeted links and the retired page agree;
 *   · the canvas is committed in the intake queue, and the decision exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANALYTICS_PATH, EDIT_PATH, LINE, MOVED_KEY, MOVED_NOTICE, NOT_RECORDED, REVIEW_PATH, STUDIO_PATH, TABS, TITLE,
  coverOf, currentVersion, dayLabel, isReadOnly, linkRows, mmss, movedTarget, newLinkHref, noViewsYet,
  readerStats, slideCaption, slideSeconds, ventureQuery, versionRows, weeklyViews,
} from '../src/pages/raise/pitch/pitchStudioModel.js';

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
const cardNoViews = { slug: 'pitch-deck', state: 'empty', series: null, reason: 'No one has opened a deck link yet.' };
const cardNoDeck = { slug: 'pitch-deck', state: 'empty', series: null, reason: 'No deck yet. Views per week appear here.' };
// … → records (raiseCycle.ts pitchRecords)
const records = {
  cols: [], total: 3, page: 1,
  rows: [
    { id: 11, cells: { link: '[Fund A]', expires: { text: '2026-11-04', tone: 'ok' }, views: 14, time: '7 min', most_read: 'Slide 5' } },
    { id: 12, cells: { link: 'Link created 2 Oct', expires: { text: 'Revoked', tone: 'muted' }, views: 0, time: '0 min', most_read: null } },
    { id: 13, cells: { link: '', expires: { text: 'Expired', tone: 'muted' }, views: 1, time: '0 min', most_read: 'Slide 1' } },
  ],
  add: { text: 'New link', href: '/raise/pitch-deck/new?project=7' },
};
// GET /api/decks/:id/engagement (decks.ts)
const engagement = {
  deck_id: 40, total_views: 5, total_read_seconds: 400, conversions: { signups: 0, nda_signed: 2, feedbacks: 0, deal_pack_opened: 0, deals_signed: 0 },
  shares: [],
  views: [
    { id: 1, ip_hash: 'a', ua_fingerprint: 'x', read_seconds: 60 },
    { id: 2, ip_hash: 'a', ua_fingerprint: 'x', read_seconds: 120 },
    { id: 3, ip_hash: 'b', ua_fingerprint: 'y', read_seconds: 30 },
    { id: 4, ip_hash: null, ua_fingerprint: null, read_seconds: 0 },
    { id: 5, ip_hash: null, ua_fingerprint: null, read_seconds: null },
  ],
};

/* ------------------------------------------------------------------ *
 * The derivations
 * ------------------------------------------------------------------ */

test('views by week and seconds per slide come from the module card, every version together', () => {
  const w = weeklyViews(cardOk);
  assert.deepEqual(w, { values: [0, 4, 9, 15, 22, 31, 0, 47], total: 128, weeks: 8 });
  assert.equal(weeklyViews(cardNoViews), null, 'no series is no chart, not eight zeros');
  assert.equal(weeklyViews({ state: 'unreadable', series: null }), null);
  const s = slideSeconds(cardOk);
  assert.deepEqual(s.map((r) => [r.index, r.seconds]), [[1, 12], [2, 34], [5, 66]]);
  assert.equal(slideCaption(s), 'Viewers spend longest on slide 5; slide 1 is read fastest.');
  assert.equal(slideCaption([]), null);
  assert.deepEqual(slideSeconds({ series: [{ kind: 'rows', items: [{ label: 'Seconds per slide', value: null }] }] }), []);
  assert.equal(noViewsYet(cardNoViews), true);
  assert.equal(noViewsYet(cardNoDeck), false, 'no deck is not "no one has opened a link"');
  assert.equal(noViewsYet(cardOk), false);
});

test('one version\'s readers: a viewer is a browser, the median skips unread views, and a missing NDA count is missing', () => {
  const r = readerStats(engagement);
  assert.equal(r.views, 5);
  assert.equal(r.viewers, 4, 'two views from one browser count once; a view with no fingerprint counts alone');
  assert.equal(r.medianSeconds, 60);
  assert.equal(r.ndaSigned, 2);
  assert.equal(readerStats({ ...engagement, conversions: {} }).ndaSigned, null);
  assert.equal(readerStats(null), null);
  assert.equal(mmss(66), '1:06', 'the canvas drew [0:66]; it is 1:06');
  assert.equal(mmss(null), null, 'a missing time is not 0:00');
  assert.equal(mmss(0), '0:00');
});

test('the investor links keep every row, withdrawn and expired ones marked, and only a live one can be withdrawn', () => {
  const rows = linkRows(records);
  assert.equal(rows.length, 3, 'a withdrawn link is still listed');
  assert.deepEqual(rows.map((r) => r.live), [true, false, false]);
  assert.equal(rows[0].investor, '[Fund A]');
  assert.equal(rows[2].investor, 'Investor not recorded');
  assert.equal(rows[1].mostRead, null);
  assert.equal(newLinkHref(records), '/raise/pitch-deck/new?project=7');
  assert.equal(newLinkHref({ add: { href: 'https://elsewhere.test/x' } }), null, 'only the module\'s own form');
  assert.equal(newLinkHref({ add: { text: 'Build your deck', href: '/raise/pitch' } }), null);
});

test('versions newest first, the cover from the first slide, and a missing date says so', () => {
  const versions = [
    { id: 3, version: 2, title: '', created_at: '2026-10-02 09:00:00' },
    { id: 4, version: 4, title: 'Seed', created_at: '2026-10-20 10:00:00', is_current: 1 },
    { id: 2, version: 1, title: 'First', created_at: null },
  ];
  assert.equal(currentVersion(versions).id, 4);
  assert.deepEqual(versionRows(versions).map((r) => [r.label, r.title, r.saved, r.current]), [
    ['v4', 'Seed', '20 Oct', true], ['v2', 'Untitled deck', '2 Oct', false], ['v1', 'First', 'Date not recorded', false],
  ]);
  assert.equal(dayLabel('not a date'), 'Date not recorded');
  assert.deepEqual(coverOf({ slides: [{ title: 'Close the books in a day.', subtitle: 'Seed' }, {}] }), { headline: 'Close the books in a day.', sub: 'Seed', slides: 2 });
  assert.equal(coverOf({ slides: [{ fields: [{ key: 'title', value: 'From a field' }] }] }).headline, 'From a field');
  assert.equal(coverOf({ title: 'Deck title', slides: [] }).headline, 'Deck title');
});

test('the old ?mode=workspace address opens the editor with the moved notice, the venture and the hash kept', () => {
  assert.deepEqual(movedTarget('?mode=workspace&project_id=12', '#slide-3'), { pathname: EDIT_PATH, search: `?project_id=12&moved=${MOVED_KEY}`, hash: '#slide-3' });
  assert.equal(MOVED_NOTICE, 'Pitch deck has a new address. Update your bookmark.');
  assert.equal(ventureQuery(12), '?project_id=12');
  assert.equal(ventureQuery(null), '');
  assert.equal(isReadOnly({ role: 'founder' }), false);
  assert.equal(isReadOnly({ role: 'admin' }), true, 'an admin reads the studio (PD21)');
  // D905 (#2684) adds the Notes tab (PD21).
  assert.deepEqual(TABS.map((t) => [t.label, t.path]), [['Decks', STUDIO_PATH], ['Review', REVIEW_PATH], ['Share & analytics', ANALYTICS_PATH], ['Notes', '/raise/pitch/notes']]);
  assert.equal(TITLE, 'Pitch deck studio');
  assert.doesNotMatch(LINE, /Every figure shows its source/, 'the source chips are #2434 part 2; the line waits for them');
  assert.equal(NOT_RECORDED, 'Not recorded');
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
  assert.match(workspace, /params\.get\('moved'\) === MOVED_KEY/, 'the editor never shows the moved notice');
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
  for (const call of ['api.listProjects()', 'api.deckListVersions(', "cyclesApi.module('raise', chosen.id, 'pitch-deck')", 'api.deckGet(', 'api.deckEngagement(']) {
    assert.ok(src.includes(call), `the studio no longer calls ${call}`);
  }
  for (const sample of ['Northwind', '[$', '16,950', '0:66', '[128]']) assert.ok(!src.includes(sample), `a canvas sample reached the page: ${sample}`);
  assert.match(src, /<DeckReviewerPage embedded \/>/, 'the Review tab mounts the reviewer until #2434 part 6');
});

test('the canvas is committed in the intake queue, the rail canvas carries the deck models, and the decision exists', () => {
  for (const f of ['Pitch Deck Studio Page.dc.html', 'Pitch Deck Studio · Boards.dc.html']) {
    const html = read(`design/incoming/${f}`);
    assert.equal(/<script src="([^"]*)"/.exec(html)?.[1], './support.js', `${f}: the first script is the shared runtime`);
    for (const banned of ['@font-face', '__claude_design_branding']) assert.ok(!html.includes(banned), `${f} holds ${banned}`);
  }
  assert.match(read('design/incoming/Pitch Deck Studio · Boards.dc.html'), /dc-import name="Pitch Deck Studio Page"/);
  assert.match(read('design/canvases/integrated/AIRail.dc.html'), /'Pitch deck': 'deck'/);
  assert.match(read('documentation/architecture/decisions/D894.md'), /^## D894 — /);
});
