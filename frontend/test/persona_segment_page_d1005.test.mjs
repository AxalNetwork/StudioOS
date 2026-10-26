/**
 * D1005 (#2820, part 8 of #2378) — one segment's page at
 * /admin/persona-segments/:key (Profile, Members, Activity) and SEG4's Move
 * dialog, shared. The fixtures are made up and every expected figure is worked
 * out from them in the comments. Mounted on a stubbed fetch; every block is
 * also read failing, and says so with its own Try again.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/persona_segment_page_d1005.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  ADMIN_REFUSAL, activityRow, answersView, archetypesView, cellText, memberRow, membersParams, moveView, movedLine,
  needsView, profileTiles, rangeText, segmentHref, segmentTabOf,
} from '../src/pages/admin/segments/segmentPageModel.js';
import { SegmentPage } from '../src/pages/admin/segments/SegmentPage.jsx';
import MoveDialog from '../src/pages/admin/segments/MoveDialog.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ── The fixtures ──────────────────────────────────────────────────────────────
// Founder — New Venture: 12 members, 3 new in 30 days, 2 still Explorers, 4 with an LP sub-account.
const PROFILE = {
  key: 'founder_new', name: 'Founder — New Venture', profile: 'founder', status: 'active',
  who: 'Founders turning an idea into a company.', typical: ['First-time founder, pre-revenue'],
  needs: [
    { id: 'n1', text: 'A clear path to incorporation', answered_by: [{ kind: 'program', ref: 'Incorporation sprint' }] },
    { id: 'n2', text: 'Perks for the first hires', answered_by: [] },
  ],
};
const SEG = {
  segments: { available: true, rows: [{ id: 'founder_new', members: 12, new_30d: 3, still_explorers: 2, profile: 'founder' }, { id: 'angel_scout', members: 4, new_30d: 0, still_explorers: 0, profile: 'investor' }] },
  sub_accounts: { available: true, lp: { total: 6, by_segment: { founder_new: 4 } }, product_tester: { recorded: false, reason: 'Nothing marks a product tester yet.' } },
};
// 12 members: 7 answered every question, 5 did not.
const COMPLETION = { recorded: true, answered: { count: 7, suppressed: false }, incomplete: { count: 5, suppressed: false }, members: { count: 12, suppressed: false } };
// Stage: Idea 6, MVP hidden (<5), Not answered 3. Why now: 5 answered, 7 not.
const ANSWERS = { questions: [
  { key: 'stage', prompt: 'What stage are you at?', type: 'choice', answered: { count: null, suppressed: true }, not_recorded: { count: 3, suppressed: false },
    buckets: [{ key: 'Idea', label: 'Idea', count: 6, suppressed: false }, { key: 'MVP', label: 'MVP', count: null, suppressed: true }] },
  { key: 'why_now', prompt: 'Why now?', type: 'text', answered: { count: 5, suppressed: false }, not_recorded: { count: 7, suppressed: false }, buckets: [] },
] };
// Builder 5, Connector hidden, Analyst 0 (not drawn), no style recorded 4.
const ARCH = { profiled: { count: null, suppressed: true }, not_recorded: { count: 4, suppressed: false }, archetypes: [
  { slug: 'builder', label: 'Builder', count: 5, suppressed: false },
  { slug: 'connector', label: 'Connector', count: null, suppressed: true },
  { slug: 'analyst', label: 'Analyst', count: 0, suppressed: false },
] };
const SEGMENTS = { segments: [
  { key: 'founder_new', name: 'Founder — New Venture', profile: 'founder', status: 'active' },
  { key: 'angel_scout', name: 'Angel / Scout', profile: 'investor', status: 'active' },
  { key: 'service_provider', name: 'Service Provider', profile: 'partner', status: 'retired' },
] };
const ADA = { user_id: 11, name: 'Ada Example', email: 'ada@example.test', profile: 'founder', segment: { key: 'founder_new', name: 'Founder — New Venture' },
  how_set: 'router', confidence: 0.82, given_at: '2026-10-01 09:00:00', last_active: '2026-10-20T10:00:00Z', sub_accounts: { lp: true, tester: null }, profile_differs: false };
const BEN = { user_id: 12, name: 'Ben Example', email: 'ben@example.test', profile: 'investor', segment: { key: 'founder_new', name: 'Founder — New Venture' },
  how_set: 'admin_retag', confidence: null, given_at: '2026-10-02 09:00:00', last_active: null, sub_accounts: { lp: false, tester: false }, profile_differs: true };
const MEMBERS = { total: 27, page: 1, page_size: 25, rows: [ADA, BEN], unreadable: [] };
const ACTIVITY = { total: 2, page: 1, page_size: 25, rows: [
  { kind: 'move', at: '2026-10-21 08:00:00', actor: { name: 'Cleo Admin' }, member: { name: 'Ada Example' }, from: { key: 'angel_scout', name: 'Angel / Scout' }, to: { key: 'founder_new', name: 'Founder — New Venture' } },
  { kind: 'signup', at: '2026-10-19 08:00:00', actor: null, member: { name: 'Ben Example' }, to: { key: 'founder_new', name: 'Founder — New Venture' }, detail: { how_set: 'router' } },
] };

// ── The model ─────────────────────────────────────────────────────────────────

test('the addresses: a key and a tab, the reserved words never a segment, the hrefs back', () => {
  // Mutations checked: `unclassified` read as a segment; the members tab read as profile; a bad key accepted.
  assert.deepEqual(segmentTabOf('/admin/persona-segments/founder_new'), { key: 'founder_new', tab: 'profile' });
  assert.deepEqual(segmentTabOf('/admin/persona-segments/founder_new/members/'), { key: 'founder_new', tab: 'members' });
  assert.deepEqual(segmentTabOf('/admin/persona-segments/founder_new/activity'), { key: 'founder_new', tab: 'activity' });
  for (const p of ['/admin/persona-segments', '/admin/persona-segments/unclassified', '/admin/persona-segments/new', '/admin/persona-segments/Bad-Key', '/admin/persona-segments/a/b']) {
    assert.equal(segmentTabOf(p), null, p);
  }
  assert.equal(segmentHref('founder_new', 'members'), '/admin/persona-segments/founder_new/members');
  assert.equal(segmentHref('founder_new'), '/admin/persona-segments/founder_new');
});

test('counts: "<5" for a suppressed cell, "Not recorded" for none, never 0; the four tiles', () => {
  // Mutations checked: a suppressed cell shown as its count; a missing cell as 0; the LP count summed over segments.
  assert.deepEqual([cellText({ count: null, suppressed: true }), cellText({ count: 7 }), cellText(null), cellText({ count: null })], ['<5', '7', 'Not recorded', 'Not recorded']);
  const tiles = profileTiles({ seg: { status: 'ready', data: SEG }, completion: { status: 'ready', data: COMPLETION } }, 'founder_new');
  assert.deepEqual(tiles.map((t) => [t.key, t.value]), [['members', '12'], ['sub', 'LP 4'], ['explorers', '2'], ['answered', '7 of 12']]);
  assert.equal(tiles[0].sub, '+3 in 30 days');
  assert.match(tiles[1].sub, /Product testers: not recorded/);
  const broken = profileTiles({ seg: { status: 'error' }, completion: { status: 'error' } }, 'founder_new');
  assert.deepEqual(broken.map((t) => Boolean(t.failed)), [true, true, true, true], 'a failed read is never a 0');
  assert.equal(profileTiles({ seg: { status: 'ready', data: SEG }, completion: { status: 'ready', data: { recorded: false, reason: 'No questions.' } } }, 'founder_new')[3].value, 'Not recorded');
});

test('the answers and how they work as bars: suppressed "<5", "Not answered" and "Not recorded" hollow, a zero style left out', () => {
  // Mutations checked: the hollow flag dropped; the zero style drawn; a text question drawing buckets.
  const a = answersView({ status: 'ready', data: ANSWERS });
  assert.deepEqual(a.questions[0].bars.map((b) => [b.label, b.text, Boolean(b.hollow)]), [['Idea', '6', false], ['MVP', '<5', false], ['Not answered', '3', true]]);
  assert.deepEqual(a.questions[1].bars.map((b) => [b.label, b.text]), [['Answered', '5'], ['Not answered', '7']]);
  assert.equal(a.questions[1].open, true);
  assert.equal(answersView({ status: 'error' }).status, 'failed');
  const w = archetypesView({ status: 'ready', data: ARCH });
  assert.deepEqual(w.bars.map((b) => [b.label, b.text, Boolean(b.hollow)]), [['Builder', '5', false], ['Connector', '<5', false], ['Not recorded', '4', true]]);
  assert.equal(w.profiled, '<5');
  assert.equal(archetypesView({ status: 'ready', data: {} }).status, 'failed');
  assert.deepEqual(needsView(PROFILE).items.map((n) => n.answered), [['Program: Incorporation sprint'], []]);
  assert.equal(needsView({ needs: [] }).recorded, false);
});

test('members: the read\'s parameters, one row in words, and the range', () => {
  // Mutations checked: a one-letter search sent; confidence shown for an admin's re-tag; the range off by one.
  assert.deepEqual(membersParams('founder_new', { q: ' a ', how_set: 'router', page: 2 }),
    { segment: 'founder_new', q: undefined, profile: undefined, how_set: 'router', band: undefined, sub: undefined, answered: undefined, active: undefined, sort: 'given', page: 2 });
  const ada = memberRow(ADA);
  assert.deepEqual([ada.name, ada.email, ada.sub, ada.howSet, ada.confidence, ada.tagged], ['Ada Example', 'ada@example.test', 'LP', 'Suggested at sign-up', '82%', '1 Oct 2026']);
  const ben = memberRow(BEN);
  assert.deepEqual([ben.sub, ben.howSet, ben.confidence, ben.lastActive, ben.differs], ['—', 'Set by an admin', '—', 'Never', true]);
  assert.equal(memberRow({ ...BEN, confidence: 0.4 }).confidence, '—', 'a confidence on an admin\'s re-tag');
  assert.equal(rangeText({ total: 27, page: 2, page_size: 25 }), '26–27 of 27');
  assert.equal(activityRow(ACTIVITY.rows[0], 'founder_new').text, 'Cleo Admin moved Ada Example into Founder — New Venture from Angel / Scout.');
  assert.equal(activityRow({ ...ACTIVITY.rows[0], to: { key: 'angel_scout', name: 'Angel / Scout' } }, 'founder_new').text, 'Cleo Admin moved Ada Example out to Angel / Scout.');
  assert.equal(activityRow(ACTIVITY.rows[1], 'founder_new').text, 'Ben Example was suggested Founder — New Venture at sign-up.');
});

test('SEG4\'s words: the same segment, a retired one, an admin account, a profile the segment is not for, and the outcome', () => {
  // Mutations checked: the admin check skipped for an Admin; a retired target allowed; a partial "already in" dropped.
  const ada = { ...ADA, name: 'Ada Example', howSet: 'Suggested at sign-up', confidence: '82%' };
  const [founder, angel, retired] = SEGMENTS.segments;
  assert.equal(moveView({ members: [ada] }).now, 'Founder — New Venture · Suggested at sign-up · 82%');
  assert.equal(moveView({ members: [ada], target: founder }).same, 'Already in Founder — New Venture. Nothing to change.');
  assert.equal(moveView({ members: [ada], target: founder }).canMove, false);
  assert.equal(moveView({ members: [ada], target: retired }).refusal, 'Service Provider is retired, so it takes no new members.');
  const v = moveView({ members: [ada], target: angel });
  assert.deepEqual([v.canMove, v.differs, v.info], [true, true, 'Ada Example is a Founder. Angel / Scout is an Investor segment.']);
  assert.deepEqual(v.changes, ['Their sidebar shows Angel / Scout’s links.', 'Angel / Scout’s questions are asked next time they open their profile.', 'Logged under your name.']);
  const admin = { ...ada, profile: 'admin' };
  assert.deepEqual([moveView({ members: [admin], target: angel }).blocked, moveView({ members: [admin], target: angel }).canMove], [ADMIN_REFUSAL, false]);
  assert.equal(moveView({ members: [admin], target: angel, superAdmin: true }).blocked, undefined);
  const two = moveView({ members: [ada, { ...BEN, segment: { key: 'angel_scout', name: 'Angel / Scout' } }], target: angel });
  assert.equal(two.title, 'Move 2 members to another segment');
  assert.equal(two.changes[0], '1 already in Angel / Scout stays as they are.');
  assert.equal(movedLine({ results: [{ outcome: 'moved' }] }, 'Angel / Scout').text, 'Moved to Angel / Scout.');
  assert.equal(movedLine({ results: [{ outcome: 'moved' }, { outcome: 'unchanged' }, { outcome: 'failed' }] }, 'Angel / Scout').text,
    'Moved 1 of 3 to Angel / Scout. 1 was already in it. 1 could not be moved. Try again.');
});

// ── The page, mounted ─────────────────────────────────────────────────────────

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const OK = {
  'GET /api/personas/segments/founder_new': () => json({ segment: PROFILE, history: [] }),
  'GET /api/personas/admin/segments': () => json(SEG),
  'GET /api/personas/segments/founder_new/completion': () => json(COMPLETION),
  'GET /api/personas/segments/founder_new/answers': () => json(ANSWERS),
  'GET /api/personas/segments/founder_new/archetypes': () => json(ARCH),
  'GET /api/personas/segments': () => json(SEGMENTS),
  'GET /api/personas/admin/members': () => json(MEMBERS),
  'GET /api/personas/admin/activity': () => json(ACTIVITY),
  'POST /api/personas/admin/members/move': () => json({ results: [{ user_id: 11, outcome: 'moved' }], moved: 1 }),
};
function stub(over = {}) {
  const original = globalThis.fetch;
  const seen = [];
  const routes = { ...OK, ...over };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = (init.method || 'GET').toUpperCase();
    seen.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null });
    const r = routes[`${method} ${u.pathname}`];
    return r ? r() : json({ detail: 'not stubbed' }, 404);
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

async function mount(element, url, path = '/admin/persona-segments/*') {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path, element })))); });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const node = (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    of: (id) => textOf(node(id)),
    has: (id) => Boolean(byTestId(id)),
    props: (id) => props(node(id)),
    all: () => textOf(container),
    find: (pred) => walk(container).filter((n) => pred(n, props(n))),
    async click(id) { await act(async () => props(node(id)).onClick()); await settle(); },
    async tick(id) { await act(async () => props(node(id)).onChange()); await settle(); },
    async change(id, value) { await act(async () => props(node(id)).onChange({ target: { value } })); await settle(); },
    async clickText(within, text) {
      const n = walk(node(within)).find((x) => x.tagName === 'BUTTON' && textOf(x).trim() === text);
      assert.ok(n, `no "${text}" in ${within}`); await act(async () => props(n).onClick()); await settle();
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const page = (superAdmin = false) => h(SegmentPage, { superAdmin });

test('mounted Profile: the header, its tab doors, the four tiles, who they are, how they work, what they told us and the needs; counts only, never a name', async () => {
  // Mutations checked: the tab doors pointing at the base; the hollow bar filled; the members read made on Profile.
  const s = stub();
  const v = await mount(page(), '/admin/persona-segments/founder_new');
  try {
    assert.match(v.of('seg-page-header'), /Persona segments.*Founder — New Venture/s);
    assert.match(v.of('seg-page-profile-pill'), /Founders/);
    assert.match(v.of('seg-page-status-pill'), /Active/);
    assert.deepEqual(['profile', 'members', 'activity'].map((t) => v.props(`seg-page-tab-${t}`).href),
      ['/admin/persona-segments/founder_new', '/admin/persona-segments/founder_new/members', '/admin/persona-segments/founder_new/activity']);
    assert.match(v.of('seg-page-tile-members'), /Members.*12.*\+3 in 30 days/s);
    assert.match(v.of('seg-page-tile-sub'), /LP 4.*Product testers: not recorded/s);
    assert.match(v.of('seg-page-tile-explorers'), /Still Explorers.*2/s);
    assert.match(v.of('seg-page-tile-answered'), /7 of 12/);
    assert.match(v.of('seg-page-who'), /Founders turning an idea into a company\..*First-time founder, pre-revenue/s);
    assert.match(v.of('seg-page-work'), /Builder\s*5.*Connector\s*<5.*Not recorded\s*4/s);
    assert.ok(!/Analyst/.test(v.of('seg-page-work')), 'a working style no one has is drawn');
    assert.match(v.of('seg-page-question-stage'), /What stage are you at\?.*Idea\s*6.*MVP\s*<5.*Not answered\s*3/s);
    assert.match(v.of('seg-page-question-why_now'), /Open answers are counted, not shown\..*Answered\s*5.*Not answered\s*7/s);
    const hollow = v.find((n, p) => /\bborder-axal-muted\b/.test(p?.className || '') && /\bbg-white\b/.test(p?.className || ''));
    assert.equal(hollow.length, 3, 'Not recorded and the two Not answered bars are hollow');
    assert.match(v.of('seg-page-needs'), /A clear path to incorporation.*Answered by Program: Incorporation sprint.*Perks for the first hires.*Nothing answers it yet\./s);
    assert.ok(!/Ada Example|Ben Example/.test(v.all()), 'a name on Profile');
    assert.ok(!s.seen.some((r) => r.path === '/api/personas/admin/members'), 'Profile read the members');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Profile, each block failing alone: it says so with its own Try again, and the rest still draws', async () => {
  // Mutations checked: a failed answers read drawn as no questions; Try again not reading again; a failed tile as 0.
  let fail = true;
  const s = stub({
    'GET /api/personas/segments/founder_new/answers': () => (fail ? json({ detail: 'down' }, 503) : json(ANSWERS)),
    'GET /api/personas/segments/founder_new/archetypes': () => json({ detail: 'down' }, 503),
    'GET /api/personas/segments/founder_new/completion': () => json({ detail: 'down' }, 503),
  });
  const v = await mount(page(), '/admin/persona-segments/founder_new');
  try {
    assert.match(v.of('seg-page-answers-failed'), /Try again/);
    assert.ok(!v.has('seg-page-no-questions'), 'a failed read said there are no questions');
    assert.match(v.of('seg-page-work-failed'), /How they work.*Try again/s);
    assert.match(v.of('seg-page-tile-answered'), /Could not be read.*Try again/s);
    assert.match(v.of('seg-page-tile-members'), /12/, 'one failure blanked the others');
    fail = false;
    await v.clickText('seg-page-answers-failed', 'Try again');
    assert.match(v.of('seg-page-question-stage'), /Idea\s*6/);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, no such segment: one sentence and the way back, never an empty profile', async () => {
  const s = stub({ 'GET /api/personas/segments/gone_one': () => json({ detail: 'No segment is recorded with that key.', code: 'not_found' }, 404) });
  const v = await mount(page(), '/admin/persona-segments/gone_one');
  try {
    assert.match(v.of('seg-page-gone'), /No segment is recorded at this address\..*Open Persona segments/s);
    assert.ok(!v.has('seg-page-profile'));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Members: the rows with names, the filters reaching the read, the move bar, SEG4 and the done line', async () => {
  // Mutations checked: the segment left off the read; a filter not sent; Move writing before the dialog's Move;
  // the selection kept after a move; the list not read again.
  const s = stub();
  const v = await mount(page(), '/admin/persona-segments/founder_new/members');
  try {
    const first = s.seen.find((r) => r.path === '/api/personas/admin/members');
    assert.deepEqual([first.query.segment, first.query.sort], ['founder_new', 'given']);
    assert.match(v.of('seg-page-member-11'), /Ada Example.*ada@example\.test.*Founders.*LP.*Suggested at sign-up.*82%.*1 Oct 2026/s);
    assert.match(v.of('seg-page-differs-12'), /Profile differs/);
    assert.match(v.of('seg-page-members-range'), /1–25 of 27/);
    await v.change('seg-page-filter-how', 'admin_retag');
    assert.equal(s.seen.filter((r) => r.path === '/api/personas/admin/members').at(-1).query.how_set, 'admin_retag');
    await v.change('seg-page-filter-how', '');

    await v.tick('seg-page-pick-11');
    await v.tick('seg-page-pick-12');
    assert.match(v.of('seg-page-move-bar'), /2 selected/);
    await v.click('seg-page-move-selected');
    assert.match(v.of('seg-move-dialog'), /Move 2 members to another segment/);
    assert.match(v.of('seg-move-dialog-now'), /2 members/);
    assert.ok(!v.has('seg-move-dialog-go'), 'Move offered before a segment is chosen');
    await v.change('seg-move-dialog-target', 'angel_scout');
    assert.match(v.of('seg-move-dialog-info'), /1 of them has a profile Angel \/ Scout is not for\./);
    assert.match(v.of('seg-move-dialog-changes'), /Their sidebar shows Angel \/ Scout’s links\..*Logged under your name\./s);
    assert.ok(!s.seen.some((r) => r.method === 'POST'), 'the move was written before Move');
    const reads = s.seen.filter((r) => r.path === '/api/personas/admin/members').length;
    await v.click('seg-move-dialog-go');
    const post = s.seen.find((r) => r.method === 'POST');
    assert.deepEqual([post.path, post.body], ['/api/personas/admin/members/move', { user_ids: [11, 12], persona_id: 'angel_scout' }]);
    assert.ok(!v.has('seg-move-dialog'), 'the dialog stayed open');
    assert.match(v.of('seg-page-moved'), /Moved to Angel \/ Scout\..*View activity/s);
    assert.equal(v.props('seg-page-moved-activity').href, '/admin/persona-segments/founder_new/activity');
    assert.ok(!v.has('seg-page-move-bar'), 'the selection outlived the move');
    assert.ok(s.seen.filter((r) => r.path === '/api/personas/admin/members').length > reads, 'the list was not read again');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Members: a row\'s ⋯ opens SEG4 for one; the same segment and a retired one are refused in words; a refused move stays in the dialog', async () => {
  // Mutations checked: the retired option choosable; the same segment offering Move; a refusal closing the dialog.
  const s = stub({ 'POST /api/personas/admin/members/move': () => json({ detail: 'The move did not go through. Nothing changed. Try again.' }, 503) });
  const v = await mount(page(), '/admin/persona-segments/founder_new/members');
  try {
    await v.click('seg-page-member-menu-11');
    assert.match(v.of('seg-page-member-menu-11-list'), /Move to another segment….*Open account/s);
    assert.equal(v.props('seg-page-member-menu-11-account').href, '/admin/accounts/all?q=ada%40example.test');
    await v.click('seg-page-member-menu-11-move');
    assert.match(v.of('seg-move-dialog'), /Move Ada Example to another segment/);
    assert.match(v.of('seg-move-dialog-now'), /Founder — New Venture · Suggested at sign-up · 82%/);
    const retired = v.find((n, p) => n.tagName === 'OPTION' && p?.value === 'service_provider')[0];
    assert.equal(v.find((n, p) => n === retired && p.disabled === true).length, 1, 'a retired segment can be chosen');
    await v.change('seg-move-dialog-target', 'founder_new');
    assert.match(v.of('seg-move-dialog-same'), /Already in Founder — New Venture\. Nothing to change\./);
    assert.ok(!v.has('seg-move-dialog-go'));
    await v.change('seg-move-dialog-target', 'service_provider');
    assert.match(v.of('seg-move-dialog-retired'), /Service Provider is retired, so it takes no new members\./);
    await v.change('seg-move-dialog-target', 'angel_scout');
    assert.match(v.of('seg-move-dialog-info'), /Ada Example is a Founder\. Angel \/ Scout is an Investor segment\./);
    await v.click('seg-move-dialog-go');
    assert.match(v.of('seg-move-dialog-refusal'), /The move did not go through\. Nothing changed\. Try again\./);
    assert.ok(!v.has('seg-page-moved'), 'a refused move said it was done');
    await v.click('seg-move-dialog-cancel');
    assert.ok(!v.has('seg-move-dialog'));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Members failing: it says so, not "no member", and Try again reads again', async () => {
  let fail = true;
  const s = stub({ 'GET /api/personas/admin/members': () => (fail ? json({ detail: 'down' }, 503) : json(MEMBERS)) });
  const v = await mount(page(), '/admin/persona-segments/founder_new/members');
  try {
    assert.match(v.of('seg-page-members-failed'), /The members could not be read\. That is not the same as none\..*Try again/s);
    assert.ok(!v.has('seg-page-members-none'));
    fail = false;
    await v.clickText('seg-page-members-failed', 'Try again');
    assert.ok(v.has('seg-page-member-11'));
  } finally { await v.unmount(); s.restore(); }
});

test('the Move dialog, shared: an admin account for an Admin is refused with Close only; a Super Admin may move it; the segments failing say so', async () => {
  // Mutations checked: the admin refusal skipped; Move offered beside it; a failed segments read drawn as an empty list.
  const admin = { user_id: 5, name: 'Dee Admin', profile: 'admin', segment: null };
  let s = stub();
  let v = await mount(h(MoveDialog, { members: [admin], superAdmin: false, onClose() {}, onMoved() {} }), '/x', '/x');
  try {
    assert.match(v.of('seg-move-dialog-admin'), /Only a super admin can move an admin account\./);
    assert.ok(!v.has('seg-move-dialog-go'));
    assert.match(v.of('seg-move-dialog-cancel'), /^Close$/);
  } finally { await v.unmount(); s.restore(); }
  s = stub();
  v = await mount(h(MoveDialog, { members: [admin], superAdmin: true, onClose() {}, onMoved() {} }), '/x', '/x');
  try {
    assert.ok(!v.has('seg-move-dialog-admin'));
    assert.match(v.of('seg-move-dialog-now'), /No segment/);
  } finally { await v.unmount(); s.restore(); }
  s = stub({ 'GET /api/personas/segments': () => json({ detail: 'down' }, 503) });
  v = await mount(h(MoveDialog, { members: [ADA], superAdmin: false, onClose() {}, onMoved() {} }), '/x', '/x');
  try {
    assert.match(v.of('seg-move-dialog-segments-failed'), /The segments could not be read\. Nothing can be moved until they are\..*Try again/s);
    assert.ok(!v.has('seg-move-dialog-target'));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Activity: this segment\'s own, filtered by kind, and failing in words', async () => {
  // Mutations checked: the segment left off the read; the kind filter not sent; a failed read drawn as nothing happened.
  let s = stub();
  let v = await mount(page(), '/admin/persona-segments/founder_new/activity');
  try {
    const first = s.seen.find((r) => r.path === '/api/personas/admin/activity');
    assert.equal(first.query.segment, 'founder_new');
    assert.match(v.of('seg-page-activity-list'), /Cleo Admin moved Ada Example into Founder — New Venture from Angel \/ Scout\..*21 Oct 2026.*Ben Example was suggested Founder — New Venture at sign-up\./s);
    await v.change('seg-page-activity-kind', 'move');
    assert.equal(s.seen.filter((r) => r.path === '/api/personas/admin/activity').at(-1).query.kind, 'move');
  } finally { await v.unmount(); s.restore(); }
  s = stub({ 'GET /api/personas/admin/activity': () => json({ detail: 'down' }, 503) });
  v = await mount(page(), '/admin/persona-segments/founder_new/activity');
  try {
    assert.match(v.of('seg-page-activity-failed'), /The activity could not be read\. That is not the same as none\..*Try again/s);
    assert.ok(!v.has('seg-page-activity-none'));
  } finally { await v.unmount(); s.restore(); }
});

// ── The sources ───────────────────────────────────────────────────────────────

test('the routes, the Overview cards\' doors, PersonasPanel retired, the dialog a sheet, and no browser pop-up', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/admin/persona-segments/:key', '/admin/persona-segments/:key/members', '/admin/persona-segments/:key/activity']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], <PersonaSegmentPage />)} />`), p);
  }
  assert.ok(app.indexOf('path="/admin/persona-segments/unclassified"') < app.indexOf('path="/admin/persona-segments/:key"'));
  const overview = read('frontend/src/pages/admin/segments/PersonaSegments.jsx');
  assert.ok(overview.includes('<Link to={`/admin/persona-segments/${c.key}`}'), 'a card does not open its segment');
  assert.ok(!/PersonasPanel|PersonasConsole/.test(overview), 'the re-tag table is still on Overview');
  const dialog = read('frontend/src/pages/admin/segments/MoveDialog.jsx');
  assert.match(dialog, /<Lightbox phone="sheet"/);
  for (const f of ['SegmentPage.jsx', 'MoveDialog.jsx', 'segmentPageModel.js', 'PersonaSegments.jsx']) {
    assert.ok(!/\b(?:window\.)?(alert|confirm|prompt)\(/.test(read(`frontend/src/pages/admin/segments/${f}`)), `a browser pop-up in ${f}`);
  }
  const route = read('frontend/src/pages/admin/segments/SegmentPage.jsx');
  assert.match(route, /<AdminBoardFrame workspace="Personas"/);
  assert.match(route, /<AdminBoardFrame workspace="Persona segments"/);
});
