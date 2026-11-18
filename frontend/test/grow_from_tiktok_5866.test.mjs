/**
 * D5866 (#5866, part 2 of #2401) — a Grow module's "From TikTok" part on
 * Distribution and Revenue and traction (`GrowFromTiktok.jsx`, its words in
 * `growFromTiktok.js`), from the read's `parts.from_tiktok` (D5863, D5864).
 * This holds: each figure says "From TikTok, as of <date>"; a missing count is
 * Not recorded and a failed read Unreadable, never 0; Sync, Delete and
 * Accept/Dismiss only when the read allows them, so a reader sees none; the
 * audience sits in its own block, never as revenue; the four calls go to the
 * Worker's mounted routes; both modules mount the part after From Mercury.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_from_tiktok_5866.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import GrowFromTiktok from '../src/pages/cycles/GrowFromTiktok.jsx';
import { count, dayLabel, syncSentence, tiktokView } from '../src/pages/cycles/growFromTiktok.js';
import { cyclesWrite } from '../src/lib/api/cycles.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';
import { cycleRouteText } from './_cycleBands.mjs';

const h = React.createElement;
const draw = (slug, part) => renderToStaticMarkup(h(GrowFromTiktok, { slug, part, projectId: 101, reload() {} }));
const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const video = (id, posted_on, views, extra = {}) => ({ id, video_id: `v${id}`, posted_on, title: `[Video ${id}]`, duration_s: 30, views, likes: 10, comments: 2, shares: 1, as_of: '2026-11-14', reasons: {}, ...extra });
const TEAM = { can_sync: true, can_delete: true, link: { served_by: { name: '[Founder]' }, connected: true, partly_synced: false }, note: 'Your public TikTok videos only. A view is not a visit to your site.' };
const DIST = {
  state: 'ok', ...TEAM, as_of: '2026-11-14', source: 'From TikTok, as of 2026-11-14',
  videos: [video(1, '2026-11-12', 18400), video(2, '2026-11-05', 12900), video(3, '2026-11-09', 7600), video(4, '2026-11-02', 4100), video(5, '2026-10-28', 99000)],
  proposal: { id: 7, kind: 'add_channel', state: 'pending', can_decide: true, sentence: 'Add TikTok as a Distribution channel? Customers who arrive with utm_source=tiktok are then counted for it.', channel: null },
};
const AUDIENCE = {
  state: 'ok', ...TEAM, as_of: '2026-11-14', source: 'From TikTok, as of 2026-11-14', snapshot_id: 31,
  note: 'Your TikTok audience, shown beside revenue and never as revenue.',
  figures: [
    { key: 'followers', label: 'followers', count: 1610, period: '2026-11-14', change: null, reason: null },
    { key: 'likes_total', label: 'total likes', count: 0, period: '2026-11-14', change: null, reason: null },
    { key: 'video_count', label: 'videos', count: null, period: '2026-11-14', change: null, reason: 'Not recorded: TikTok has given no videos yet' },
  ],
};
const READER = { can_sync: false, can_delete: false };

test('words: counts with separators, a recorded 0 stays 0, a missing count is Not recorded; dates read as the canvas does', () => {
  assert.equal(count(18400), '18,400');
  assert.equal(count(0), '0');
  assert.equal(count(null), 'Not recorded');
  assert.equal(count(undefined), 'Not recorded');
  assert.equal(dayLabel('2026-11-14'), '14 Nov 2026');
  assert.equal(dayLabel('2026-11-04 09:12:00'), '4 Nov 2026');
  assert.equal(tiktokView(undefined, 'distribution').empty, true);
  assert.equal(tiktokView({ state: 'something else' }, 'distribution').empty, true);
});

test('distribution: reach sums the views of the videos posted in the sync month; top three by views, then Show all', () => {
  // Mutation checked: count every video in reach → 142,000 not 43,000; sort by date → video 1 is not first.
  const view = tiktokView(DIST, 'distribution');
  assert.deepEqual(view.reach, { views: '43,000', posts: 4, missing: 0 }, 'the October video is not this month');
  assert.deepEqual(view.videos.map((v) => v.id), [1, 2, 3, 4]);
  const html = draw('distribution', DIST);
  assert.match(html, /id="from-tiktok"/);
  assert.match(strip(html), /43,000 views · 4 posts/);
  assert.match(strip(html), /Reach this month · views of videos posted in Nov 2026/);
  for (const id of [1, 2, 3]) assert.match(html, new RegExp(`data-testid="tiktok-video-${id}"`));
  assert.doesNotMatch(html, /data-testid="tiktok-video-4"/, 'the fourth waits for Show all');
  assert.match(html, /Show all 4 videos/);
  assert.match(strip(html), /top 3 of 4 by views/);
  assert.ok(strip(html).split('From TikTok, as of 14 Nov 2026').length - 1 >= 4, 'the header, reach and each video carry the source and date');
});

test('a count TikTok did not give is Not recorded, never 0, and reach says what it leaves out', () => {
  // Mutation checked: draw a null as count(0) → the "0" cell assert fails.
  const part = { ...DIST, videos: [video(1, '2026-11-12', null, { reasons: { views: 'Not recorded: you did not let Axal VC read your public TikTok videos.' } }), video(2, '2026-11-05', 500)] };
  const view = tiktokView(part, 'distribution');
  assert.deepEqual(view.reach, { views: '500', posts: 2, missing: 1 });
  assert.equal(view.videos[1].views.text, 'Not recorded');
  assert.match(view.videos[1].views.reason, /did not let Axal VC read/);
  const html = draw('distribution', part);
  assert.match(html, /tiktok-cell-not-recorded/);
  assert.match(strip(html), /1 video gave no view count and is not in it/);
  const none = draw('distribution', { ...DIST, videos: [video(5, '2026-10-28', 99000)] });
  assert.match(strip(none), /None this month No videos posted in Nov 2026/);
  assert.doesNotMatch(strip(none), /0 views/, 'no month video draws no reach, not a 0');
});

test('revenue and traction: Audience on TikTok, one Delete for the snapshot, never as revenue', () => {
  // Mutation checked: draw null as 0 → the videos figure reads 0; drop the not-revenue line → its match fails.
  const html = draw('revenue-and-traction', AUDIENCE);
  const text = strip(html);
  assert.match(text, /Audience on TikTok/);
  assert.match(text, /Followers 1,610/);
  assert.match(text, /Total likes 0/, 'a recorded 0 is a value');
  assert.match(text, /Videos Not recorded Not recorded: TikTok has given no videos yet/);
  assert.match(text, /Audience, not revenue\. These figures never count toward MRR or a KPI\./);
  assert.match(html, /data-testid="tiktok-delete-account-31"/);
  assert.doesNotMatch(html, /MRR<\/|revenue ledger/i, 'no revenue figure is drawn here');
  assert.doesNotMatch(html, /tiktok-video-/, 'no video list on Revenue and traction');
  assert.doesNotMatch(draw('distribution', DIST), /Audience on TikTok/, 'no audience block on Distribution');
});

test('states: Not connected links to the connector; a scope not granted reads Not recorded with Reconnect; a failed read is Unreadable', () => {
  // Mutation checked: drop the reconnect test → the Reconnect match fails; render unreadable as an empty list → its match fails.
  const notLinked = draw('distribution', { state: 'not_linked', reason: 'Not recorded: no TikTok account serves this venture yet.', connect_href: '/account/connectors/tiktok', ...TEAM, link: null, proposal: null });
  assert.match(notLinked, /href="\/account\/connectors\/tiktok"/);
  assert.match(strip(notLinked), /Connect TikTok/);
  assert.match(notLinked, /tiktok-sync/, 'the first sync links the member’s TikTok');
  const unsafe = draw('distribution', { state: 'not_linked', reason: 'x', connect_href: 'https://evil.example/', ...TEAM, link: null });
  assert.doesNotMatch(unsafe, /evil\.example/);
  const scope = draw('revenue-and-traction', { state: 'not_recorded', reason: 'Not recorded: you did not let Axal VC read your TikTok audience counts.', ...TEAM });
  assert.match(strip(scope), /Not recorded Not recorded: you did not let Axal VC read your TikTok audience counts\./);
  assert.match(scope, /tiktok-reconnect/);
  const notSynced = draw('distribution', { state: 'not_recorded', reason: 'Not recorded: TikTok has not been synced for this venture yet.', ...TEAM, proposal: null });
  assert.doesNotMatch(notSynced, /tiktok-reconnect/, 'nothing to share again before a first sync');
  const bad = draw('distribution', { state: 'unreadable', reason: 'Unreadable: the TikTok figures could not be read' });
  assert.match(strip(bad), /Unreadable Unreadable: the TikTok figures could not be read/);
  assert.doesNotMatch(bad, /tiktok-sync|tiktok-reach|\b0 views/);
  const partly = draw('distribution', { ...DIST, link: { ...DIST.link, partly_synced: true } });
  assert.match(strip(partly), /Partly synced TikTok stopped before the end of the video list\. Sync again to finish\./);
});

test('roles: a reader sees the figures and no Sync, Delete, Accept or Dismiss; only the founder decides the proposal', () => {
  // Mutation checked: ignore can_decide → the reader still gets tiktok-accept-7; ignore can_delete → a delete button is drawn.
  const reader = draw('distribution', { ...DIST, ...READER, proposal: { ...DIST.proposal, can_decide: false } });
  assert.match(strip(reader), /43,000 views/);
  assert.doesNotMatch(reader, /tiktok-sync|tiktok-delete-|tiktok-accept-|tiktok-dismiss-/);
  assert.match(strip(reader), /The founder decides\. You read only\./);
  assert.match(reader, /tiktok-reader/);
  const teamNotFounder = draw('distribution', { ...DIST, proposal: { ...DIST.proposal, can_decide: false } });
  assert.match(teamNotFounder, /tiktok-delete-video-1/, 'a team member deletes');
  assert.doesNotMatch(teamNotFounder, /tiktok-accept-7/, 'but does not decide');
  const founder = draw('distribution', DIST);
  assert.match(founder, /tiktok-accept-7/);
  assert.match(founder, /tiktok-dismiss-7/);
  assert.doesNotMatch(draw('revenue-and-traction', { ...AUDIENCE, ...READER }), /tiktok-delete-account|tiktok-sync/);
  const accepted = draw('distribution', { ...DIST, proposal: { id: 7, state: 'accepted', can_decide: false, sentence: null, channel: { uid: 'c1', name: 'TikTok' } } });
  assert.match(strip(accepted), /TikTok is now a Distribution channel \(TikTok, source tiktok\)\./);
  assert.doesNotMatch(accepted, /tiktok-accept-7/);
});

async function mount(slug, part, reload) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(GrowFromTiktok, { slug, part, projectId: 101, reload })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  // Microtasks only (no timer): each handler awaits one mocked call, then sets state.
  const click = (id) => act(async () => { props(by(id)).onClick(); for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { by, click, text, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('Sync, Delete, Accept and Dismiss each call their route once; a refusal is said and nothing reloads', async () => {
  // Mutation checked: Dismiss calls accept → the dismiss call never comes; delete passes kind 'account' for a video → the kind assert fails.
  const saved = { ...cyclesWrite.grow };
  const calls = [];
  let reloads = 0;
  cyclesWrite.grow.syncTiktok = async (project) => { calls.push(['sync', project]); return { ok: true, counts: { snapshots: 1, videos: 4, kept_deleted: 1, scopes_missing: [], partial: false, outcome: 'Synced', proposals: 0 } }; };
  cyclesWrite.grow.deleteTiktokFact = async (project, id, kind) => { calls.push(['delete', project, id, kind]); return { ok: true }; };
  cyclesWrite.grow.acceptTiktokProposal = async (project, id) => { calls.push(['accept', project, id]); return { ok: true }; };
  cyclesWrite.grow.dismissTiktokProposal = async (project, id) => { calls.push(['dismiss', project, id]); throw new Error('That proposal was already decided.'); };
  const d = await mount('distribution', DIST, () => { reloads += 1; });
  try {
    await d.click('tiktok-sync');
    assert.deepEqual(calls, [['sync', 101]]);
    assert.equal(reloads, 1);
    assert.equal(d.text(d.by('tiktok-sync-note')), 'Synced from TikTok: 4 videos and today’s audience. 1 deleted figure stays deleted.');
    await d.click('tiktok-delete-video-2');
    assert.deepEqual(calls[1], ['delete', 101, 2, 'video']);
    assert.equal(reloads, 2);
    await d.click('tiktok-accept-7');
    assert.deepEqual(calls[2], ['accept', 101, 7]);
    assert.equal(reloads, 3);
    await d.click('tiktok-dismiss-7');
    assert.deepEqual(calls[3], ['dismiss', 101, 7]);
    assert.equal(reloads, 3, 'a refused Dismiss does not reload');
    assert.equal(d.text(d.by('tiktok-error')), 'That proposal was already decided.');
    assert.ok(!d.by('tiktok-video-4'));
    await d.click('tiktok-show-all');
    assert.ok(d.by('tiktok-video-4'), 'Show all expands in place');
  } finally { await d.unmount(); }
  const r = await mount('revenue-and-traction', AUDIENCE, () => { reloads += 1; });
  try {
    await r.click('tiktok-delete-account-31');
    assert.deepEqual(calls[4], ['delete', 101, 31, 'account']);
    assert.equal(reloads, 4);
  } finally { await r.unmount(); Object.assign(cyclesWrite.grow, saved); }
  assert.equal(syncSentence({ videos: 20, partial: true, outcome: 'Partly synced' }), 'Partly synced: 20 videos read so far. Sync again to finish.');
});

test('a failed sync says why and keeps the figures', async () => {
  const saved = { ...cyclesWrite.grow };
  let reloads = 0;
  cyclesWrite.grow.syncTiktok = async () => { throw new Error('TikTok asked us to wait. Try again in a minute.'); };
  const d = await mount('distribution', DIST, () => { reloads += 1; });
  try {
    await d.click('tiktok-sync');
    assert.equal(d.text(d.by('tiktok-sync-failed')), 'TikTok asked us to wait. Try again in a minute.');
    assert.equal(reloads, 0);
    assert.ok(d.by('tiktok-reach'), 'the figures stay');
  } finally { await d.unmount(); Object.assign(cyclesWrite.grow, saved); }
});

test('the four calls go to the Worker\'s mounted routes, and both modules mount the part after From Mercury', async () => {
  const sent = [];
  const w = makeCycleWrites(async (path, init) => { sent.push([path, init?.method, init?.body ?? null]); return {}; });
  await w.grow.syncTiktok(101);
  await w.grow.deleteTiktokFact(101, 3, 'video');
  await w.grow.deleteTiktokFact(101, 31, 'account');
  await w.grow.acceptTiktokProposal(101, 7);
  await w.grow.dismissTiktokProposal(101, 7);
  assert.deepEqual(sent, [
    ['/cycles/grow/tiktok/sync', 'POST', JSON.stringify({ project: 101 })],
    ['/cycles/grow/tiktok/facts/3?project=101&kind=video', 'DELETE', null],
    ['/cycles/grow/tiktok/facts/31?project=101&kind=account', 'DELETE', null],
    ['/cycles/grow/tiktok/proposals/7/accept', 'POST', JSON.stringify({ project: 101 })],
    ['/cycles/grow/tiktok/proposals/7/dismiss', 'POST', JSON.stringify({ project: 101 })],
  ]);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_grow.ts', import.meta.url), 'utf8');
  for (const route of ["r.post('/tiktok/sync'", "r.delete('/tiktok/facts/:id'", "r.post('/tiktok/proposals/:id/accept'", "r.post('/tiktok/proposals/:id/dismiss'"]) {
    assert.ok(worker.includes(route), route);
  }
  const route = cycleRouteText();
  for (const slug of ['distribution', 'revenue-and-traction']) {
    const m = route.indexOf(`fromMercury('${slug}', data, ctx)`);
    const t = route.indexOf(`fromTiktok('${slug}', data, ctx)`);
    assert.ok(m >= 0 && t > m, `${slug}: From TikTok after From Mercury`);
  }
  for (const slug of ['partner-network', 'team-expansion', 'durable-company-building', 'product-improvement']) {
    assert.ok(!route.includes(`fromTiktok('${slug}'`), `${slug} holds no TikTok figure`);
  }
});
