/**
 * D8733 (#8733) — the Operating Partner's firm feed: every alert names its client and opens that item, the summary
 * keeps six rows with one reserved per kind present (owner answer Q3, A), the overflow is disclosed by kind and
 * expands in place (Q1, A), a phone gets a jump link (Q2, A), and every page the feed opens says where it came from,
 * with a fallback when the item is gone. Canvas: `design/incoming/Studio Home Operating Partner Page.dc.html`, boards
 * SOP00 to SOP13. The clock is fixed: `NOW` is Thu 26 Nov 2026, the canvas's sample day.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/firm_feed_8733.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import {
  homeFeed, feedSummary, hiddenSentence, kindCounts, kindsLine, feedNote, expandedRows, feedView, returnFocus,
  unreadSubject, unreadKinds, partialNote, relativeDay, SUMMARY_ROWS,
} from '../src/pages/partner/firmFeedModel.js';
import { FirmFeed, FeedJumpLink, partnerTiles } from '../src/pages/partner/PartnerHomeP2.jsx';
import { feedReturnHref, readFeedReturn, saveFeedReturn, studioReturnHref, STUDIO_FEED } from '../src/pages/partner/feedReturn.js';
import { FromStudioBack, NotFoundNotice, feedItemName } from '../src/pages/partner/FromStudioBack.jsx';
import { PersonFocusBar, focusPeople } from '../src/pages/partner/delivery/engagementFocus.jsx';
import EngagementSheet from '../src/pages/partner/delivery/EngagementSheet.jsx';
import StudioModules from '../src/pages/studio/StudioModules.jsx';
import { studioFromReads } from '../src/pages/studio/useStudioLayout.js';

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const src = (p) => codeOnly(readFileSync(resolve(process.cwd(), p), 'utf8'));

/** A board row as `GET /partner/delivery/board` answers it. */
const eng = (id, client, o = {}) => ({
  engagement_id: id, engagement_uid: `ENG-${client.slice(0, 2).toUpperCase()}${id}`, client, status: 'in_progress', mode: 'project',
  health: 'on_track', health_reasons: [], milestones_due_7d: 0, milestones_overdue: 0, open_blockers: 0,
  next_milestone_title: null, next_milestone_due_at: null, ...o,
});
const blocked = (id, client, overdue, blockers, reasons) => eng(id, client, { health: 'blocked', milestones_overdue: overdue, open_blockers: blockers, health_reasons: reasons });

/** Scenario B, the audit's test: six blocked, one milestone due tomorrow, one renewal. */
const BOARD_B = {
  items: [
    blocked(1, 'Quillon Pay', 3, 2, ['2 open blockers', '3 milestones overdue']),
    blocked(2, 'Nordlys Health', 2, 1, ['1 open blocker, on the client side', '2 milestones overdue']),
    blocked(3, 'Kestrel Freight', 1, 2, ['2 open blockers, 1 on the client side', '1 milestone overdue']),
    blocked(4, 'Pinecrest Labs', 1, 1, ['1 open blocker', '1 milestone overdue']),
    blocked(5, 'Marlow Bio', 0, 1, ['1 open blocker, on the firm’s side']),
    blocked(6, 'Tidewater Robotics', 0, 1, ['1 open blocker, on the client side']),
    eng(7, 'Fernhill Energy', { milestones_due_7d: 1, next_milestone_title: 'Pricing workshop', next_milestone_due_at: '2026-11-27' }),
    eng(8, 'Brightwater AI'),
    eng(9, 'Closed Co', { status: 'delivered', health: 'blocked' }),
  ],
};
const RET_B = { items: [
  { engagement_id: 8, engagement_uid: 'ENG-BR8', founder_name: 'Brightwater AI', retainer: { renews_at: '2026-12-14' } },
  { engagement_id: 2, engagement_uid: 'ENG-NO2', founder_name: 'Nordlys Health', retainer: { renews_at: '2027-03-01' } },
] };
const CAP_NONE = { over_committed_count: 0, people: [] };
const READS_B = { board: BOARD_B, retainers: RET_B, capacity: CAP_NONE };

const draw = (el, url = '/studio') => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, el));
const feedHtml = (reads, url, props = {}) => draw(React.createElement(FirmFeed, { reads, onRetry: () => {}, now: NOW, ...props }), url);

// ── The model ───────────────────────────────────────────────────────────────

test('SOP02: six blocked, a due milestone and a renewal are eight alerts, and the summary keeps all three kinds', () => {
  const all = homeFeed(READS_B, NOW);
  assert.equal(all.length, 8, 'a closed engagement is off the feed, the far renewal is not within 60 days');
  assert.deepEqual(kindCounts(all), { blk: 6, risk: 0, due: 1, cap: 0, ren: 1, seat: 0 });
  const shown = feedSummary(all);
  assert.equal(shown.length, SUMMARY_ROWS);
  assert.deepEqual(shown.map((a) => a.who), ['Quillon Pay', 'Nordlys Health', 'Kestrel Freight', 'Pinecrest Labs', 'Fernhill Energy', 'Brightwater AI']);
  assert.deepEqual(hiddenSentence(all, shown), { count: 2, lead: '2 more not shown', detail: '2 blocked: Marlow Bio, Tidewater Robotics' });
  assert.equal(kindsLine(all), '6 blocked · 1 due this week · 1 renewing');
  assert.equal(feedNote(all, shown, READS_B), '8 alerts · 6 shown');
});

test('blocked work sorts by overdue milestones, then open blockers, then name; the summary keeps feed order', () => {
  const all = homeFeed(READS_B, NOW);
  assert.deepEqual(all.filter((a) => a.kind === 'blk').map((a) => a.who),
    ['Quillon Pay', 'Nordlys Health', 'Kestrel Freight', 'Pinecrest Labs', 'Marlow Bio', 'Tidewater Robotics']);
  const tie = homeFeed({ board: { items: [blocked(1, 'Zed', 1, 1, []), blocked(2, 'Abe', 1, 1, [])] } }, NOW);
  assert.deepEqual(tie.map((a) => a.who), ['Abe', 'Zed']);
});

test('Q3 A: a row is reserved for each kind present, then the most pressing fill the rest', () => {
  const board = { items: [
    ...Array.from({ length: 7 }, (_, i) => blocked(i + 1, `Blocked ${i + 1}`, 7 - i, 1, [])),
    eng(20, 'Risky', { health: 'at_risk' }),
    eng(21, 'Duecorp', { milestones_due_7d: 2 }),
    eng(22, 'Seatco', { mode: 'embedded', grant: 'Board, KPIs' }),
  ] };
  const capacity = { people: [{ user_id: 118, name: 'Ines Moreau', total_hours_per_week: 46, cap_hours: 40, cap_source: 'person', over_committed: true }] };
  const retainers = { items: [{ engagement_id: 30, engagement_uid: 'ENG-RE30', founder_name: 'Renewco', retainer: { renews_at: '2026-12-01' } }] };
  const all = homeFeed({ board, capacity, retainers }, NOW);
  assert.equal(all.length, 12);
  const shown = feedSummary(all);
  assert.deepEqual(shown.map((a) => a.kind), ['blk', 'risk', 'due', 'cap', 'ren', 'seat'], 'six kinds present take one row each');
  assert.equal(shown[0].who, 'Blocked 1', 'the reserved row is the kind\'s most pressing');
  // Two kinds: both reserved, then the most pressing fill the rest.
  const two = feedSummary(homeFeed({ board: { items: [...board.items.slice(0, 7), eng(21, 'Duecorp', { milestones_due_7d: 2 })] } }, NOW));
  assert.deepEqual(two.map((a) => a.who), ['Blocked 1', 'Blocked 2', 'Blocked 3', 'Blocked 4', 'Blocked 5', 'Duecorp']);
  // Six or fewer: every alert, nothing hidden.
  const a = homeFeed({ board: { items: board.items.slice(6) } }, NOW);
  assert.deepEqual(feedSummary(a), a);
  assert.equal(hiddenSentence(a, feedSummary(a)), null);
});

test('SOP05, SOP06: each alert opens its own engagement, person or retainer, with from=studio', () => {
  const capacity = { people: [{ user_id: 118, name: 'Ines Moreau', total_hours_per_week: 46, cap_hours: 40, cap_source: 'person', over_committed: true }] };
  const board = { items: [...BOARD_B.items, eng(22, 'Seatco', { mode: 'embedded', grant: 'Board, KPIs', grant_holder: 'Rin' })] };
  const by = Object.fromEntries(homeFeed({ board, retainers: RET_B, capacity }, NOW).map((a) => [a.who + ':' + a.kind, a]));
  assert.equal(by['Kestrel Freight:blk'].to, '/delivery/board?engagement=ENG-KE3&from=studio');
  assert.equal(by['Kestrel Freight:blk'].action, 'Open engagement');
  assert.equal(by['Kestrel Freight:blk'].label, 'Open engagement: Kestrel Freight');
  assert.equal(by['Fernhill Energy:due'].to, '/delivery/health?engagement=ENG-FE7&from=studio');
  assert.equal(by['Fernhill Energy:due'].action, 'Open milestones');
  assert.equal(by['Ines Moreau:cap'].to, '/delivery/capacity?person=118&from=studio');
  assert.equal(by['Ines Moreau:cap'].body, '46 h a week against a cap of 40 h a week');
  assert.equal(by['Brightwater AI:ren'].to, '/pipeline/retainers?engagement=ENG-BR8&from=studio');
  assert.equal(by['Brightwater AI:ren'].action, 'Open retainer');
  assert.equal(by['Seatco:seat'].to, '/delivery/capacity?engagement=ENG-SE22&from=studio');
  // A row with no uid falls back to its id; a person with no id opens Capacity unfocused, never someone else.
  assert.equal(homeFeed({ board: { items: [blocked(5, 'Nouid', 0, 1, [])].map((r) => ({ ...r, engagement_uid: null })) } }, NOW)[0].to, '/delivery/board?engagement=5&from=studio');
  assert.equal(homeFeed({ capacity: { people: [{ name: 'X', over_committed: true }] } }, NOW)[0].to, '/delivery/capacity?from=studio');
});

test('the due alert names its next milestone and day once the board row carries it, and the count until then', () => {
  const due = homeFeed(READS_B, NOW).find((a) => a.kind === 'due');
  assert.equal(due.body, '1 milestone due this week');
  assert.equal(due.when, 'Pricing workshop · due Fri 27 Nov, tomorrow');
  const bare = homeFeed({ board: { items: [eng(7, 'Fernhill Energy', { milestones_due_7d: 2 })] } }, NOW)[0];
  assert.equal(bare.body, '2 milestones due this week');
  assert.equal(bare.when, null);
  const far = homeFeed({ board: { items: [eng(7, 'F', { milestones_due_7d: 1, next_milestone_title: 'Later', next_milestone_due_at: '2026-12-09' })] } }, NOW)[0];
  assert.equal(far.when, null, 'a next milestone past the week is not what this week\'s count is about');
  assert.equal(relativeDay('2026-11-26', NOW), 'today');
  assert.equal(relativeDay('2026-12-14', NOW), 'in 18 days');
});

test('the renewal says when, in words and days', () => {
  const ren = homeFeed(READS_B, NOW).find((a) => a.kind === 'ren');
  assert.equal(ren.body, 'Retainer renews Mon 14 Dec 2026 · in 18 days');
  assert.equal(ren.receipt, 'Retainer record');
});

test('SOP09: a read that failed is named once, its kinds are Unavailable, and the note says Partial', () => {
  assert.equal(unreadSubject({ board: null, retainers: {}, capacity: {} }), 'The delivery board', 'main built "The feed\'s the delivery board"');
  assert.equal(unreadSubject({ board: {}, retainers: null, capacity: {} }), 'The feed\'s retainers');
  assert.equal(unreadSubject({ board: {}, retainers: null, capacity: null }), 'The feed\'s retainers and capacity');
  assert.equal(unreadSubject({ board: null, retainers: {}, capacity: null }), 'The delivery board and capacity');
  assert.deepEqual(unreadKinds({ board: null, retainers: {}, capacity: {} }), ['blk', 'risk', 'due', 'seat']);
  assert.deepEqual(unreadKinds({ board: {}, retainers: null, capacity: {} }), ['ren']);
  assert.equal(partialNote({ board: {}, retainers: null, capacity: {} }), 'Partial · 2 of 3 reads');
  assert.equal(partialNote(READS_B), null);
});

test('SOP04: a kind filter says how many of the whole it shows; ?feed= reads back only known views', () => {
  const all = homeFeed(READS_B, NOW);
  assert.deepEqual(expandedRows(all, 'ren').rows.map((a) => a.who), ['Brightwater AI']);
  assert.equal(expandedRows(all, 'ren').line, 'Showing 1 of 8 alerts · Renewing');
  assert.equal(expandedRows(all, 'all').line, 'Showing all 8 alerts');
  assert.equal(feedView('due'), 'due');
  assert.equal(feedView('nonsense'), '');
});

test('SOP07: on return focus goes to the alert used, or to the one now in its place with the reason', () => {
  const all = homeFeed(READS_B, NOW);
  const k = all.find((a) => a.who === 'Kestrel Freight');
  assert.deepEqual(returnFocus(all, { key: k.key, who: 'Kestrel Freight', kind: 'blk', index: 2 }),
    { key: k.key, message: 'Back from Kestrel Freight. Your view of the feed was kept.' });
  const after = all.filter((a) => a !== k);
  assert.deepEqual(returnFocus(after, { key: k.key, who: 'Kestrel Freight', kind: 'blk', index: 2 }),
    { key: after[2].key, message: 'Kestrel Freight is no longer blocked, so it left the feed. Focus is on the next alert.' });
  assert.equal(returnFocus(after, { key: 'gone', index: 99 }).key, after[after.length - 1].key, 'past the end lands on the last alert');
  assert.deepEqual(returnFocus([], { key: 'gone', who: 'X', kind: 'ren' }), { key: null, message: 'X is no longer renewing, so it left the feed. Nothing else is listed.' });
  assert.equal(returnFocus(all, null), null);
});

// ── The module, rendered ────────────────────────────────────────────────────

test('SOP02 rendered: six rows, chips counting all eight, the hidden two named, Show all controlling the list', () => {
  const html = feedHtml(READS_B);
  const text = renderedText(html);
  assert.equal((html.match(/data-testid="feed-row-/g) || []).length, 6);
  assert.match(text, /2 more not shown · 2 blocked: Marlow Bio, Tidewater Robotics/);
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*aria-controls="firm-feed-list"[^>]*>Show all 8 alerts/);
  assert.match(html, /id="firm-feed-list"/);
  assert.match(text, /Blocked 6/);
  assert.match(text, /Due this week 1/);
  assert.match(text, /Renewing 1/);
  assert.match(text, /At risk 0 · Over cap 0/, 'a kind with none says 0 in words');
  assert.doesNotMatch(text, /All 8/, 'the All chip belongs to the expanded list');
  assert.match(html, /aria-label="Open engagement: Kestrel Freight"/);
  assert.match(html, /href="\/delivery\/board\?engagement=ENG-KE3&amp;from=studio"/);
  assert.match(html, /href="\/delivery\/health\?engagement=ENG-FE7&amp;from=studio"/);
  assert.match(html, /href="\/pipeline\/retainers\?engagement=ENG-BR8&amp;from=studio"/);
  assert.match(text, /Pricing workshop · due Fri 27 Nov, tomorrow/);
  assert.match(html, /id="firm-feed"/, 'the module is the phone jump target');
  assert.match(html, /role="group" aria-label="Show alerts by kind"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(text, /Not on this page: messages from a client/);
  // Phone targets are 44 px, desktop 36.
  assert.match(html, /class="inline-flex min-h-\[44px\][^"]*sm:min-h-\[36px\]/);
});

test('SOP03 rendered: ?feed=all expands in place, grouped by kind under h4, with Show fewer', () => {
  const html = feedHtml(READS_B, '/studio?feed=all');
  const text = renderedText(html);
  assert.equal((html.match(/data-testid="feed-row-/g) || []).length, 8);
  assert.deepEqual([...html.matchAll(/<h4[^>]*>([^<]+)<\/h4>/g)].map((m) => m[1]), ['Blocked', 'Due this week', 'Renewing within 60 days']);
  assert.match(html, /<button[^>]*aria-expanded="true"[^>]*aria-controls="firm-feed-list"[^>]*>Show fewer/);
  assert.match(text, /Showing all 8 alerts/);
  assert.match(html, /aria-pressed="true"[^>]*>All <b[^>]*>8<\/b>/);
  assert.doesNotMatch(text, /more not shown/);
});

test('SOP04 rendered: ?feed=ren shows the renewal alone and says it is 1 of 8', () => {
  const html = feedHtml(READS_B, '/studio?feed=ren');
  assert.equal((html.match(/data-testid="feed-row-/g) || []).length, 1);
  assert.match(renderedText(html), /Showing 1 of 8 alerts · Renewing/);
  assert.match(html, /aria-pressed="true" data-testid="feed-chip-ren"/);
  assert.match(html, /aria-live="polite"/);
});

test('SOP09 rendered: a failed read draws its kinds Unavailable, never 0, with the fixed sentence and retry', () => {
  const ret = renderedText(feedHtml({ ...READS_B, retainers: null }));
  assert.match(ret, /Renewing · Unavailable/);
  assert.doesNotMatch(ret, /Renewing 0/);
  assert.match(ret, /The feed's retainers could not be read/);
  assert.match(ret, /Retry|Try again/);
  const brd = feedHtml({ ...READS_B, board: null });
  const t = renderedText(brd);
  for (const k of ['Blocked', 'At risk', 'Due this week']) {
    assert.match(t, new RegExp(`${k} · Unavailable`));
    assert.doesNotMatch(t, new RegExp(`${k} 0`));
  }
  assert.match(t, /Over cap 0/, 'capacity answered, so its zero is a measured one');
  assert.match(t, /The delivery board could not be read/);
  assert.doesNotMatch(t, /The feed's the delivery board/);
  assert.match(brd, /aria-disabled="true" title="Could not be read"/);
});

test('SOP10 C rendered: a confirmed empty feed says so with the read time and every zero in words', () => {
  const t = renderedText(feedHtml({ board: { items: [] }, retainers: { items: [] }, capacity: { people: [] } }, '/studio', { readAt: new Date(2026, 10, 26, 9, 12) }));
  assert.match(t, /Nothing is at risk, due this week, over a stated cap or renewing soon\./);
  assert.match(t, /All three reads answered at 09:12 today\. Blocked 0 · At risk 0 · Due this week 0 · Over cap 0 · Renewing 0\./);
});

const PARTNER = { profile: 'partner', groups: [{ key: 'partner', label: 'Operating partner' }], modules: ['firm_tiles', 'operating_brief', 'firm_feed'].map((key) => (
  { key, title: { firm_tiles: 'Firm tiles', operating_brief: 'Operating brief', firm_feed: 'Firm feed' }[key], group: 'partner', purpose: 'p', href: null, default_size: 'full', in_default: true, locked_by_plan: false, plan: null })) };
const STUDIO = studioFromReads({ profile: 'partner', viewer: { role: 'partner' }, modules: PARTNER, layout: { profile: 'partner', source: 'default', layout: PARTNER.modules.map((m) => ({ key: m.key, size: 'full' })), revision: null, updated_at: null, dropped: [] } });

test('"Open the feed" is gone; the module note counts every alert and says when a read was partial', () => {
  const spec = partnerTiles({ status: 'ready', reads: READS_B }, () => {}).firm_feed;
  assert.equal(spec.href, undefined);
  assert.equal(spec.openLabel, undefined);
  const html = draw(React.createElement(StudioModules, { studio: STUDIO, tiles: partnerTiles({ status: 'ready', reads: { ...READS_B, retainers: null } }, () => {}) }));
  assert.doesNotMatch(renderedText(html), /Open the feed/);
  assert.doesNotMatch(html, /data-testid="studio-tile-open-firm_feed"/);
  assert.match(renderedText(html), /alerts? · .*Partial · 2 of 3 reads/);
  assert.match(html, /data-testid="studio-tile-open-firm_tiles"/, 'the tiles keep Open Delivery');
});

test('SOP11A: the phone jump link counts the feed by kind and jumps to the module, phone only', () => {
  const html = draw(React.createElement(FeedJumpLink, { reads: READS_B, now: NOW }));
  assert.match(html, /^<a href="#firm-feed"/);
  assert.match(html, /aria-label="Firm feed: 8 alerts\. 6 blocked, 1 due this week, 1 renewing\. Jump to the feed"/);
  assert.match(renderedText(html), /Firm feed · 8 alerts6 blocked · 1 due this week · 1 renewing/);
  assert.match(html, /md:hidden/);
  assert.match(html, /min-h-\[44px\]/);
  assert.match(renderedText(draw(React.createElement(FeedJumpLink, { reads: { ...READS_B, retainers: null }, now: NOW }))), /Partial · 2 of 3 reads/);
  assert.match(renderedText(draw(React.createElement(FeedJumpLink, { reads: { board: { items: [] }, retainers: { items: [] }, capacity: {} }, now: NOW }))), /Firm feed · no alerts/);
  const frame = src('frontend/src/pages/partner/PartnerStudioHome.jsx');
  assert.match(frame, /\{feedJump && <FeedJumpLink reads=\{reads\} \/>\}/);
  assert.ok(frame.indexOf('link-partner-settings') < frame.indexOf('<FeedJumpLink') && frame.indexOf('<FeedJumpLink') < frame.indexOf('module-eadwyn'),
    'the jump link sits under the firm line, before Eadwyn');
  assert.match(frame, /\(studio\.placed \|\| \[\]\)\.some\(\(entry\) => entry\.key === 'firm_feed'\)/, 'no link to a module the member removed');
});

// ── The way back, and the destinations ──────────────────────────────────────

test('the return record keeps the view and the alert used; a reader without storage falls back to the module', () => {
  assert.equal(studioReturnHref('all', 'blk-3'), '/studio?feed=all&alert=blk-3#firm-feed');
  assert.equal(studioReturnHref('', 'blk-3'), '/studio?alert=blk-3#firm-feed');
  const had = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { value: undefined, configurable: true });
    assert.equal(readFeedReturn(), null);
    assert.equal(feedReturnHref(), STUDIO_FEED);
    const store = new Map();
    Object.defineProperty(globalThis, 'sessionStorage', { value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, configurable: true });
    saveFeedReturn({ href: '/studio?feed=all&alert=blk-3#firm-feed', to: '/delivery/board?engagement=ENG-KE3&from=studio', who: 'Kestrel Freight' });
    assert.equal(feedReturnHref(), '/studio?feed=all&alert=blk-3#firm-feed');
    assert.equal(feedItemName('engagement', 'ENG-KE3'), 'Kestrel Freight');
    assert.equal(feedItemName('engagement', 'ENG-OTHER'), null, 'never another item\'s name');
    assert.equal(feedReturnHref({ href: 'https://example.invalid/' }), STUDIO_FEED, 'only a Studio address');
    Object.defineProperty(globalThis, 'sessionStorage', { value: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } }, configurable: true });
    saveFeedReturn({ href: '/studio' });
    assert.equal(readFeedReturn(), null);
  } finally {
    if (had) Object.defineProperty(globalThis, 'sessionStorage', had); else delete globalThis.sessionStorage;
  }
});

test('Back to Studio · Firm feed shows only on a page opened from the feed, on every partner zone', () => {
  assert.match(renderedText(draw(React.createElement(FromStudioBack), '/delivery/health?engagement=ENG-FE7&from=studio')),
    /Back to Studio · Firm feedYou opened this from an alert on your Studio\./);
  assert.equal(draw(React.createElement(FromStudioBack), '/delivery/health?engagement=ENG-FE7'), '');
  assert.match(draw(React.createElement(FromStudioBack), '/delivery/board?from=studio'), /href="\/studio#firm-feed"/);
  const routes = src('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');
  assert.match(routes, /\{!isRoot && <FromStudioBack \/>\}\s*\{body\}/);
});

test('SOP05: the Engagement Sheet opened from the feed carries the way back, after Close', () => {
  const row = { engagement_id: 3, engagement_uid: 'ENG-KE3', client: 'Kestrel Freight', mode: 'project', health: 'blocked', health_reasons: [] };
  const html = draw(React.createElement(EngagementSheet, { row, onClose: () => {}, backToStudio: true }));
  assert.ok(html.indexOf('aria-label="Close engagement" class="grid') < html.indexOf('Back to Studio · Firm feed'), 'Close comes first');
  assert.ok(html.indexOf('Back to Studio · Firm feed') < html.indexOf('Kestrel Freight</h2>'));
  assert.doesNotMatch(draw(React.createElement(EngagementSheet, { row, onClose: () => {} })), /Back to Studio/);
});

test('SOP08: a missing engagement opens nothing and says so, without saying whether it was removed or another firm’s', () => {
  const t = renderedText(draw(React.createElement(NotFoundNotice, { name: 'Tidewater Robotics', where: 'board', checked: true, onShowAll: () => {}, showAllLabel: 'Show all engagements' }), '/delivery/board?engagement=ENG-TI6&from=studio'));
  assert.match(t, /Tidewater Robotics is not on your firm’s board/);
  assert.match(t, /Nothing was opened\. It may have been removed since your Studio loaded, or it is not one of this firm’s engagements\. Every page was checked\./);
  assert.match(t, /Back to Studio · Firm feed/);
  assert.match(t, /Show all engagements/);
  const plain = renderedText(draw(React.createElement(NotFoundNotice, { name: null, where: 'retainer list' }), '/pipeline/retainers?engagement=x'));
  assert.match(plain, /This engagement is not on your firm’s retainer list/);
  assert.doesNotMatch(plain, /Back to Studio/, 'not opened from the feed');
});

test('Board reads on through the book before deciding a key is unknown, then says so', () => {
  const board = src('frontend/src/pages/partner/delivery/BoardZone.jsx');
  assert.match(board, /const seeking = Boolean\(selectedKey && !selected && settled && more\.page\?\.next_cursor && !more\.loadingMore && !more\.moreError\);/);
  assert.match(board, /useEffect\(\(\) => \{ if \(seeking\) loadMore\(\); \}, \[seeking, more\.page\?\.next_cursor\]\);/);
  assert.match(board, /const notFound = Boolean\(selectedKey && !selected && settled && !more\.page\?\.next_cursor && !more\.loadingMore && !more\.moreError\);/);
  assert.match(board, /\{notFound && \(\s*<NotFoundNotice name=\{feedItemName\('engagement', selectedKey\)\} where="board"/);
  assert.match(board, /<EngagementSheet row=\{selected\} onClose=\{close\} backToStudio=\{fromStudio\} \/>/);
});

test('SOP06 B, SOP08 B: Capacity narrows to ?person=, and an unknown person narrows to nothing and says so', () => {
  const people = [{ user_id: 118, name: 'Ines Moreau' }, { user_id: 9, name: 'Rin' }];
  assert.deepEqual(focusPeople(people, '118').map((p) => p.name), ['Ines Moreau']);
  assert.deepEqual(focusPeople(people, '404'), []);
  assert.equal(focusPeople(people, ''), people);
  const one = renderedText(draw(React.createElement(PersonFocusBar, { focusKey: '118', people, onClear: () => {} })));
  assert.match(one, /Showing Ines Moreau · 1 of 2 peopleShow all/);
  assert.match(renderedText(draw(React.createElement(PersonFocusBar, { focusKey: '404', people, onClear: () => {} }))), /Showing a person this roster has no record for · 0 of 2 people/);
  assert.equal(draw(React.createElement(PersonFocusBar, { focusKey: '', people, onClear: () => {} })), '');
  const cap = src('frontend/src/pages/partner/delivery/CapacityZone.jsx');
  assert.match(cap, /const focusedPeople = focusPeople\(people, personFocus\.key\);/);
  assert.match(cap, /if \(view === 'seats'\) return focusedPeople\.filter/);
  assert.match(cap, /<PersonFocusBar focusKey=\{personFocus\.key\} people=\{people\} onClear=\{personFocus\.clear\} \/>/);
});

test('SOP06 C: Retainers opens the sheet for ?engagement=, and says so when the engagement is not there', () => {
  const ret = src('frontend/src/pages/partner/pipeline/RetainersZone.jsx');
  assert.match(ret, /const focusRow = focusKey \? items\.find\(\(r\) => matchesFocus\(r, focusKey\)\) \|\| null : null;/);
  assert.match(ret, /const sheetRow = sheet \? \(items\.find\(\(r\) => r\.engagement_id === sheet\?\.id\) \|\| null\) : focusRow;/);
  assert.match(ret, /const closeSheet = useCallback\(\(\) => \{ setSheet\(null\); if \(focusKey\) clearFocus\(\); \}, \[focusKey, clearFocus\]\);/);
  assert.match(ret, /const focusMissing = Boolean\(focusKey && !focusRow && !state\.loading && !state\.error && d\);/);
  assert.match(ret, /backToStudio=\{fromStudio\}/);
});
