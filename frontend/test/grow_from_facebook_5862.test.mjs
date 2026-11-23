/**
 * #5862 (D5862, part 2 of #2399) — a Grow module's "From Facebook" part on Distribution and Revenue and
 * traction (`GrowFromFacebook.jsx`, its words in `growFromFacebook.js`), from the read's
 * `parts.from_facebook` (D5859, D5860), built to the From Facebook canvas (D5861, GR-21 to GR-26).
 *
 * This holds:
 *   - the section is `id="from-facebook"`, and each figure says "From Facebook, as of <date>";
 *   - a missing figure is Not recorded, a failed read Unreadable, a refused token Reconnect with Facebook,
 *     none of them 0;
 *   - Sync, Delete, Accept and Dismiss only when the read allows them, so a reader sees none;
 *   - Delete asks first, then calls its route; a dismissed proposal is not drawn again;
 *   - the loading, empty, not connected and partly synced states are each drawn;
 *   - the four calls go to the Worker's mounted routes, and both modules mount the part after From TikTok.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_from_facebook_5862.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import GrowFromFacebook from '../src/pages/cycles/GrowFromFacebook.jsx';
import { facebookView, fromFacebook, syncFailure, syncSentence } from '../src/pages/cycles/growFromFacebook.js';
import { cyclesWrite } from '../src/lib/api/cycles.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';
import { cycleRouteText } from './_cycleBands.mjs';

const h = React.createElement;
const draw = (slug, part, extra = {}) => renderToStaticMarkup(h(GrowFromFacebook, { slug, part, projectId: 101, reload() {}, ...extra }));
const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const LINK = { page_name: '[Example Page]', served_by: { name: '[Founder]' }, connected: true, partly_synced: false };
const TEAM = { can_sync: true, can_link: true, can_delete: true, link: LINK };
const READER = { can_sync: false, can_link: false, can_delete: false };
const day = (d, views, viewers, engagements) => ({
  day: d,
  views: views == null ? { count: null, reason: 'Not recorded: Facebook gave no figure for this day.' } : { id: 1000 + Number(d.slice(-2)), count: views },
  viewers: viewers == null ? { count: null, reason: 'Not recorded: Facebook gave no figure for this day.' } : { id: 2000 + Number(d.slice(-2)), count: viewers },
  engagements: engagements == null ? { count: null, reason: 'Not recorded: Facebook gave no figure for this day.' } : { id: 3000 + Number(d.slice(-2)), count: engagements },
});
const DIST = {
  state: 'ok', ...TEAM, as_of: '2026-10-21 08:00:00', source: 'From Facebook, as of 2026-10-21',
  note: 'Views of your Facebook Page and its posts. A view is not a visit to your site.',
  totals: { views: { count: 31904, days_recorded: 2, of_days: 28 }, engagements: { count: 0, days_recorded: 2, of_days: 28 }, viewers: { count: null, reason: 'Unique viewers are counted per day, so days do not add up.' } },
  days: [day('2026-10-20', 1200, 400, 0), day('2026-10-21', 30704, 12377, 0), day('2026-10-19', null, null, null)],
  proposal: { id: 9, kind: 'channel_link', state: 'pending', sentence: 'Link your Facebook Page to a Distribution channel?', can_decide: true, channel: null },
};
const AUDIENCE = {
  state: 'ok', ...TEAM, as_of: '2026-10-21 08:00:00', source: 'From Facebook, as of 2026-10-21',
  note: 'Your Facebook Page audience, shown beside revenue and never as revenue.',
  followers: { id: 77, count: 4218, period: '2026-10-21', change: { since: '2026-10-14', delta: 12 } },
};

// ------------------------------------------------------------------ the words

test('words: each figure is From Facebook, as of its date; a missing figure is Not recorded, never 0; a recorded 0 stays 0', () => {
  assert.equal(fromFacebook('2026-10-21 08:00:00'), 'From Facebook, as of 21 Oct 2026');
  assert.equal(fromFacebook(null), null);
  const v = facebookView(DIST, 'distribution');
  assert.equal(v.state, 'ok');
  assert.equal(v.source, 'From Facebook, as of 21 Oct 2026');
  assert.deepEqual(v.figures.map((f) => [f.key, f.text]), [['views', '31,904'], ['viewers', '12,377'], ['engagements', '0']]);
  assert.match(v.figures[0].sub, /3 days, 19 Oct 2026 to 21 Oct 2026 · 2 of 28 days recorded/);
  assert.match(v.figures[1].sub, /^On 21 Oct 2026 · counted per day/, 'unique viewers: the newest day, never a sum');
  assert.deepEqual(v.days.map((d) => d.day), ['2026-10-21', '2026-10-20', '2026-10-19'], 'newest first');
  assert.equal(v.days[2].views.text, 'Not recorded');
  assert.match(v.days[2].views.reason, /Facebook gave no figure/);
  const none = facebookView({ ...DIST, totals: { views: { count: null, reason: 'x' }, engagements: {} }, days: [] }, 'distribution');
  assert.deepEqual(none.figures.map((f) => f.text), ['Not recorded', 'Not recorded', 'Not recorded']);
  const rev = facebookView(AUDIENCE, 'revenue-and-traction');
  assert.equal(rev.followers.text, '4,218');
  assert.equal(rev.followers.change, '+12 since 14 Oct 2026');
  assert.equal(facebookView({ ...AUDIENCE, proposal: DIST.proposal }, 'revenue-and-traction').proposal, null, 'a proposal belongs to Distribution');
  assert.equal(facebookView({ ...AUDIENCE, followers: { id: 77, count: 4200, period: '2026-10-21', change: { since: '2026-10-14', delta: -6 } } }, 'revenue-and-traction').followers.change, '−6 since 14 Oct 2026');
  assert.equal(facebookView({ ...AUDIENCE, followers: { count: null, reason: 'Not recorded: Facebook has given no follower count yet.' } }, 'revenue-and-traction').followers.text, 'Not recorded');
  assert.equal(facebookView(undefined, 'distribution').empty, true);
  assert.equal(facebookView({ state: 'something else' }, 'distribution').empty, true);
});

test('a sync says what it did; a refused token is Reconnect, a rate limit says wait, anything else a failed read', () => {
  assert.equal(syncSentence({ followers: 1, daily: 810, kept_deleted: 0, partial: false }), 'Synced from Facebook: 1 follower snapshot and 810 daily figures.');
  assert.equal(syncSentence({ followers: 1, daily: 270, kept_deleted: 2, partial: true }), 'Partly synced: 1 follower snapshot and 270 daily figures so far. Some months were not read; sync again to finish. 2 deleted figures stay deleted.');
  assert.equal(syncFailure({ code: 'sign_in_again' }).kind, 'reconnect');
  assert.match(syncFailure({ code: 'sign_in_again' }).sentence, /Reconnect with Facebook/);
  assert.equal(syncFailure({ code: 'facebook_page_not_granted' }).kind, 'reconnect');
  assert.equal(syncFailure({ code: 'rate_limited' }).kind, 'rate_limited');
  assert.equal(syncFailure({ code: 'facebook_unreadable', message: 'Facebook could not be read. Nothing changed; try again.' }).sentence, 'Facebook could not be read. Nothing changed; try again.');
  assert.equal(syncFailure(null).kind, 'failed');
});

// ------------------------------------------------------------------ drawn

test('Distribution: id="from-facebook", the Page, the figures and the daily rows; Sync and Delete for the team', () => {
  const html = draw('distribution', DIST);
  assert.match(html, /<section id="from-facebook"/);
  const t = strip(html);
  assert.match(t, /From Facebook/);
  assert.match(t, /Page · \[Example Page\] · served by \[Founder\] · From Facebook, as of 21 Oct 2026/);
  assert.match(t, /Views 31,904 .*Unique viewers 12,377 .*Post engagements 0 /);
  assert.match(html, /data-testid="facebook-sync"/);
  assert.match(html, /data-testid="facebook-delete-1021"/);
  assert.doesNotMatch(html, /facebook-delete-1019/, 'Not recorded has nothing to delete');
  assert.match(t, /Link your Facebook Page to a Distribution channel\?/);
  assert.match(html, /data-testid="facebook-accept-9"/);
  // One primary: Accept is violet while the proposal waits, so Sync is drawn plain.
  assert.match(html, /data-testid="facebook-sync"[^>]*class="rounded-md border/);
  assert.match(draw('distribution', { ...DIST, proposal: null }), /data-testid="facebook-sync"[^>]*class="rounded-md bg-axal-violet/);
  assert.doesNotMatch(t, /Followers/, 'followers sit on Revenue and traction');
});

test('Revenue and traction: Audience, not revenue, followers with its change and Delete', () => {
  const t = strip(draw('revenue-and-traction', AUDIENCE));
  assert.match(t, /Audience, not revenue Followers · 21 Oct 2026 4,218 \+12 since 14 Oct 2026/);
  assert.match(t, /never revenue, never a KPI/);
  assert.match(draw('revenue-and-traction', AUDIENCE), /data-testid="facebook-delete-77"/);
  assert.doesNotMatch(strip(draw('revenue-and-traction', { ...AUDIENCE, proposal: DIST.proposal })), /Link your Facebook Page/, 'the proposal is Distribution’s');
});

test('a reader sees the figures alone: no Sync, Delete, Accept or Dismiss', () => {
  // Who may act is the read's to say: a part that does not say so offers nothing.
  const { can_sync: _s, can_delete: _d, ...unsaid } = DIST;
  assert.doesNotMatch(draw('distribution', { ...unsaid, proposal: null }), /facebook-sync|facebook-delete-/);
  for (const [slug, part] of [['distribution', { ...DIST, ...READER, proposal: { ...DIST.proposal, can_decide: false } }], ['revenue-and-traction', { ...AUDIENCE, ...READER }]]) {
    const html = draw(slug, part);
    for (const id of ['facebook-sync', 'facebook-delete-', 'facebook-accept-', 'facebook-dismiss-']) assert.ok(!html.includes(`data-testid="${id}`), `${slug}: ${id}`);
    assert.match(html, /data-testid="facebook-reader"/);
    assert.match(strip(html), /From Facebook, as of 21 Oct 2026/);
  }
});

test('the states: loading, empty, not connected, not recorded, partly synced, unreadable, disconnected', () => {
  assert.match(draw('distribution', undefined, { loading: true }), /data-testid="facebook-loading"/);
  assert.equal(draw('distribution', undefined), '', 'nothing to draw once the read has no part');
  const nc = draw('distribution', { state: 'not_linked', reason: 'Not recorded: no Facebook Page is linked to this venture.', connect_href: '/account/connectors/facebook', ...READER, can_link: true, link: null });
  assert.match(nc, /data-testid="facebook-not-linked"/);
  assert.match(nc, /href="\/account\/connectors\/facebook"/);
  assert.match(strip(nc), /Connect Facebook and choose a Page/);
  assert.doesNotMatch(draw('distribution', { state: 'not_linked', connect_href: 'https://evil.example/', ...READER }), /evil\.example|facebook-connect/, 'no link off the app, and none for a reader');
  assert.match(draw('distribution', { state: 'not_linked', connect_href: '/admin/somewhere', ...TEAM, link: null }), /href="\/account\/connectors\/facebook"/, 'only a connector page');
  assert.match(strip(draw('distribution', { state: 'not_recorded', reason: 'Not recorded: the linked Facebook Page has not been synced yet.', ...TEAM })), /has not been synced yet\. Nothing has been read from Facebook yet\./);
  assert.match(draw('distribution', { ...DIST, link: { ...LINK, partly_synced: true } }), /data-testid="facebook-partly-synced"/);
  const un = draw('revenue-and-traction', { state: 'unreadable', reason: 'Unreadable: the Facebook figures could not be read', ...TEAM });
  assert.match(un, /data-testid="facebook-unreadable"/);
  assert.doesNotMatch(un, /facebook-sync|facebook-delete/, 'nothing to act on when the part could not be read');
  assert.match(draw('distribution', { ...DIST, link: { ...LINK, connected: false } }), /data-testid="facebook-disconnected"/);
  assert.doesNotMatch(draw('distribution', { ...DIST, proposal: { id: 9, state: 'dismissed' } }), /facebook-proposal-9/, 'a dismissed proposal is not drawn');
});

// ------------------------------------------------------------------ mounted

async function mount(slug, part, reload) {
  const restore = installDocument('', { focus: true });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(GrowFromFacebook, { slug, part, projectId: 101, reload })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const click = (id) => act(async () => { props(by(id)).onClick(); for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { by, click, text, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('Sync, Delete (asked first), Accept and Dismiss each call their route once', async () => {
  const saved = { ...cyclesWrite.grow };
  const calls = [];
  let reloads = 0;
  cyclesWrite.grow.syncFacebook = async (project) => { calls.push(['sync', project]); return { ok: true, counts: { followers: 1, daily: 810, kept_deleted: 1, partial: false } }; };
  cyclesWrite.grow.deleteFacebookFact = async (project, id) => { calls.push(['delete', project, id]); return { ok: true, id }; };
  cyclesWrite.grow.acceptFacebookProposal = async (project, id) => { calls.push(['accept', project, id]); return { ok: true }; };
  cyclesWrite.grow.dismissFacebookProposal = async (project, id) => { calls.push(['dismiss', project, id]); return { ok: true }; };
  const d = await mount('distribution', DIST, () => { reloads += 1; });
  try {
    await d.click('facebook-sync');
    assert.deepEqual(calls, [['sync', 101]]);
    assert.equal(d.text(d.by('facebook-sync-note')), 'Synced from Facebook: 1 follower snapshot and 810 daily figures. 1 deleted figure stays deleted.');
    // Delete asks first; Cancel deletes nothing.
    await d.click('facebook-delete-1021');
    assert.ok(Boolean(d.by('facebook-delete-dialog')), 'Delete asks first');
    assert.match(d.text(d.by('facebook-delete-dialog')), /Delete this figure.*Views · 21 Oct 2026 · 30,704\. It stays deleted after the next sync\./s);
    // A boolean: comparing DOM nodes with assert.equal would print React's internals on failure.
    assert.ok(document.activeElement === d.by('facebook-delete-cancel'), 'focus starts on Cancel');
    await d.click('facebook-delete-cancel');
    assert.ok(!d.by('facebook-delete-dialog'), 'Cancel closes the dialog');
    assert.equal(calls.length, 1);
    await d.click('facebook-delete-1021');
    await d.click('facebook-delete-confirm');
    assert.deepEqual(calls[1], ['delete', 101, 1021]);
    assert.ok(!d.by('facebook-delete-dialog'), 'the dialog closes');
    await d.click('facebook-accept-9');
    assert.deepEqual(calls[2], ['accept', 101, 9]);
    await d.click('facebook-dismiss-9');
    assert.deepEqual(calls[3], ['dismiss', 101, 9]);
    assert.equal(d.text(d.by('facebook-toast')), 'Dismissed. It will not be proposed again.');
    assert.equal(reloads, 4);
  } finally { await d.unmount(); Object.assign(cyclesWrite.grow, saved); }
});

test('a refused token offers Reconnect with Facebook; Sync then reads Try again; nothing reloads', async () => {
  const saved = { ...cyclesWrite.grow };
  let reloads = 0;
  cyclesWrite.grow.syncFacebook = async () => { const e = new Error('Facebook asked you to sign in again.'); e.code = 'sign_in_again'; throw e; };
  const d = await mount('revenue-and-traction', AUDIENCE, () => { reloads += 1; });
  try {
    await d.click('facebook-sync');
    assert.match(d.text(d.by('facebook-sync-reconnect')), /Facebook needs to be reconnected\. Reconnect with Facebook to continue\./);
    assert.ok(d.by('facebook-reconnect'));
    assert.equal(d.text(d.by('facebook-sync')), 'Try again');
    assert.equal(d.text(d.by('facebook-figure-followers')).includes('4,218'), true, 'the last good figures stay');
    assert.equal(reloads, 0);
  } finally { await d.unmount(); Object.assign(cyclesWrite.grow, saved); }
});

// ------------------------------------------------------------------ wiring

test('the four calls go to the Worker’s mounted routes, and both modules mount the part after From TikTok', async () => {
  const sent = [];
  const w = makeCycleWrites(async (path, init) => { sent.push([path, init?.method, init?.body ?? null]); return {}; });
  await w.grow.syncFacebook(101);
  await w.grow.deleteFacebookFact(101, 1021);
  await w.grow.acceptFacebookProposal(101, 9);
  await w.grow.dismissFacebookProposal(101, 9);
  assert.deepEqual(sent, [
    ['/cycles/grow/facebook/sync', 'POST', JSON.stringify({ project: 101 })],
    ['/cycles/grow/facebook/facts/1021?project=101', 'DELETE', null],
    ['/cycles/grow/facebook/proposals/9/accept', 'POST', JSON.stringify({ project: 101 })],
    ['/cycles/grow/facebook/proposals/9/dismiss', 'POST', JSON.stringify({ project: 101 })],
  ]);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_grow.ts', import.meta.url), 'utf8');
  for (const route of ["r.post('/facebook/sync'", "r.delete('/facebook/facts/:id'", "r.post('/facebook/proposals/:id/accept'", "r.post('/facebook/proposals/:id/dismiss'"]) {
    assert.ok(worker.includes(route), route);
  }
  const route = cycleRouteText();
  assert.match(route, /<GrowFromFacebook slug=\{slug\} part=\{data\?\.parts\?\.from_facebook\} loading=\{!data\}/, 'loading until the module read arrives');
  for (const slug of ['distribution', 'revenue-and-traction']) {
    const t = route.indexOf(`fromTiktok('${slug}', data, ctx)`);
    const f = route.indexOf(`fromFacebook('${slug}', data, ctx)`);
    assert.ok(t >= 0 && f > t, `${slug}: From Facebook after From TikTok`);
  }
  for (const slug of ['partner-network', 'team-expansion', 'durable-company-building', 'product-improvement']) {
    assert.ok(!route.includes(`fromFacebook('${slug}'`), `${slug} holds no Facebook figure`);
  }
});

test('the decision file names the canvas, the states and the departures', () => {
  const f = 'documentation/architecture/decisions/D5862.md';
  assert.ok(existsSync(new URL(`../../${f}`, import.meta.url)));
  const d = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  assert.match(d, /^## D5862 — .*\(#5862\)$/m);
  for (const s of ['GR-21', 'from-facebook', 'Reconnect with Facebook', 'Not recorded', 'Unreadable', 'Departures']) assert.ok(d.includes(s), s);
});
