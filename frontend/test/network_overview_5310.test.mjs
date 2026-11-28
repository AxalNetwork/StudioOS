/**
 * #5310 (D5310) — the founder Network overview, built to the #4799 canvas: NW1 populated, NW1.2
 * first run and NW5's states (read, loading, could not be read, stale, not recorded, empty, credits),
 * part 4's checks against the phone (NW8) and dark (NW10) boards (D5310-p4), and part 5's Recent
 * network activity from the recorded-events read (D5310-p5, D6557).
 * Every person and company here is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/network_overview_5310.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  ACTIVITY_LIMIT, READ_LOADING, acceptGate, activityView, attentionRows, introGroups, isFirstRun, matchesView, overviewTiles, settle, sharingLine, staleNotice,
} from '../src/pages/founder/networkOverviewModel.js';

const h = React.createElement;
const NOW = Date.parse('2026-11-14T12:00:00Z');
const ready = (data) => ({ status: 'ready', data, readAt: '2026-11-14T11:58:00Z' });
const fail = { status: 'unreadable', data: null, readAt: null };
const req = (over) => ({ uid: 'r1', status: 'pending', requester: { id: 2, name: 'Example Asker' }, teammate: { id: 3, name: 'Example Mate' }, person: { name: 'Example Person', company: null }, created_at: '2026-11-05 09:00:00', outcome: { label: 'Not recorded' }, ...over });
const LOG = (sent = [], received = [], totals = {}) => ready({ sent, received, totals: { sent: sent.length, received: received.length, sent_pending: 0, received_pending: 0, ...totals } });
const SUMMARY = ready({ sharing: { opted_in: true, teams_shared: 1, teams_total: 2 }, requests: { sent_pending: 2, received_pending: 3, made_90d: 4 }, recording: {} });

// Mutation checked: an unreadable book read as 0 (fails); the active count leaving out accepted (fails);
// the decide tile ignoring a recorded:false sub-read (fails).
test('NW1 tiles: each figure is its own read; a failed read is Could not be read, never 0', () => {
  const reads = {
    book: ready({ total: 142 }), followUps: ready({ total: 7, items: [] }), summary: SUMMARY,
    pending: LOG([], [], { sent_pending: 2 }), accepted: LOG([req({ status: 'accepted' })], [req({ uid: 'r2', status: 'accepted' }), req({ uid: 'r3', status: 'accepted' })]),
  };
  const t = Object.fromEntries(overviewTiles(reads).map((x) => [x.key, x]));
  assert.deepEqual([t.connections.value, t.attention.value, t.decide.value, t.active.value], [142, 7, 3, 5]);
  assert.equal(t.active.sub, '2 waiting · 3 accepted, not yet made');
  const failed = Object.fromEntries(overviewTiles({ ...reads, book: fail }).map((x) => [x.key, x]));
  assert.equal(failed.connections.state, 'unreadable');
  assert.equal(failed.connections.value, null, 'never 0');
  assert.equal(overviewTiles({ ...reads, book: READ_LOADING })[0].state, 'loading');
  const noDecide = overviewTiles({ ...reads, summary: ready({ ...SUMMARY.data, requests: { received_pending: 0 }, recording: { 'requests.received_pending': { recorded: false } } }) });
  assert.equal(noDecide[2].state, 'unreadable');
  assert.equal(overviewTiles({ ...reads, accepted: fail })[3].state, 'unreadable', 'active needs both halves');
});

// D5310-p4. Mutation checked: a zero count marked (fails); an unreadable tile marked (fails);
// the decide tile left unmarked (fails); the connections tile marked (fails).
test('NW1, NW8, NW10 tiles: only a read count above zero that asks for something is marked, with its glyph', () => {
  const reads = {
    book: ready({ total: 142 }), followUps: ready({ total: 7, items: [] }), summary: SUMMARY,
    pending: LOG([], [], { sent_pending: 2 }), accepted: LOG([req({ status: 'accepted' })], []),
  };
  const marks = (r) => overviewTiles(r).map((t) => t.mark ?? null);
  assert.deepEqual(marks(reads), [null, '◷', '!', null], 'connections and active never ask for anything');
  const zero = { ...reads, followUps: ready({ total: 0, items: [] }), summary: ready({ ...SUMMARY.data, requests: { ...SUMMARY.data.requests, received_pending: 0 } }) };
  assert.deepEqual(marks(zero), [null, null, null, null], 'zero is not marked');
  assert.deepEqual(marks({ ...reads, followUps: fail, summary: fail }), [null, null, null, null], 'an unread figure is not marked');
  assert.deepEqual(marks({ ...reads, followUps: READ_LOADING }), [null, null, '!', null], 'nor a loading one');
  const stale = { status: 'stale', data: { total: 2, items: [] }, readAt: '2026-11-14T11:00:00Z' };
  assert.equal(overviewTiles({ ...reads, followUps: stale })[1].mark, '◷', 'a stale count still asks');
});

// D5310-p5. Mutation checked: a failed source left out (fails); an empty list with a failed source read as
// nothing recorded (fails); the import count dropped (fails); a declined intro drawn as done (fails);
// more rows than the limit (fails); an unread read drawn as empty (fails).
test('NW1 recent activity: recorded events with their time, each failed source named, never an empty history', () => {
  const src = (over = {}) => ({ follow_ups: { state: 'readable' }, introductions: { state: 'readable' }, imports: { state: 'readable' }, duplicate_reviews: { state: 'readable' }, ...over });
  const ev = (kind, at, extra = {}) => ({ kind, at, label_parts: { action: kind.replace(/_/g, ' '), ...extra } });
  const full = activityView(ready({ complete: true, sources: src(), events: [
    ev('follow_up_completed', '2026-11-06 16:20:00'), ev('contacts_imported', '2026-10-30T18:47:00Z', { count: 118 }), ev('intro_declined', '2026-10-29 09:00:00'),
  ] }));
  assert.equal(full.state, 'ready');
  assert.deepEqual(full.rows.map((r) => [r.glyph, r.tone, r.action, r.detail, r.at]), [
    ['✓', 'ok', 'follow up completed', null, '2026-11-06 16:20'],
    ['⇩', 'plain', 'contacts imported', '118 added', '2026-10-30 18:47'],
    ['×', 'off', 'intro declined', null, '2026-10-29 09:00'],
  ]);
  assert.deepEqual(full.unread, []);
  const many = activityView(ready({ complete: true, sources: src(), events: Array.from({ length: 9 }, (_, i) => ev('intro_requested', `2026-11-0${i + 1} 10:00:00`)) }));
  assert.equal(many.rows.length, ACTIVITY_LIMIT);
  const partial = activityView(ready({ complete: false, sources: src({ introductions: { state: 'unreadable', reason: 'x' } }), events: [ev('follow_up_completed', '2026-11-06 16:20:00')] }));
  assert.deepEqual([partial.state, partial.unread], ['ready', ['Introductions']]);
  const hollow = activityView(ready({ complete: false, sources: src({ imports: { state: 'unreadable' }, follow_ups: { state: 'unreadable' } }), events: [] }));
  assert.deepEqual([hollow.state, hollow.unread], ['partial-empty', ['Follow-ups', 'Imports']], 'not "nothing recorded"');
  assert.equal(activityView(ready({ complete: true, sources: src(), events: [] })).state, 'empty');
  assert.equal(activityView(fail).state, 'unreadable');
  assert.equal(activityView(READ_LOADING).state, 'loading');
  assert.equal(activityView({ status: 'stale', data: { complete: true, sources: src(), events: [ev('intro_made', '2026-11-01 10:00:00')] }, readAt: 'x' }).state, 'stale');
});

// Mutation checked: settle dropping the earlier value on failure (fails); staleNotice ignoring stale (fails).
test('NW5 stale: a refresh that fails keeps the earlier read and says when it was made', () => {
  const first = settle(READ_LOADING, { ok: true, data: { total: 5 } }, '2026-11-14T14:02:00Z');
  const after = settle(first, { ok: false });
  assert.deepEqual(after, { status: 'stale', data: { total: 5 }, readAt: '2026-11-14T14:02:00Z' });
  assert.deepEqual(settle(READ_LOADING, { ok: false }), { status: 'unreadable', data: null, readAt: null }, 'nothing earlier: unreadable');
  const notice = staleNotice({ pending: after, book: first }, { pending: 'Introductions' });
  assert.deepEqual(notice, { what: ['Introductions'], readAt: '2026-11-14T14:02:00Z', keys: ['pending'] });
  assert.equal(staleNotice({ book: first }, {}), null);
  assert.equal(overviewTiles({ book: after, followUps: first, summary: SUMMARY, pending: first, accepted: first })[0].state, 'stale');
});

// Mutation checked: counts read from the page (fails); made counted from rows when the summary is unread (fails).
test('NW1 introductions in progress: four groups, counts from the whole log, Made is the delivered state (A1)', () => {
  const groups = introGroups({
    pending: LOG([req({ uid: 's1' })], [req({ uid: 'd1' })], { sent_pending: 9, received_pending: 4 }),
    accepted: LOG([req({ uid: 'a1', status: 'accepted', accepted_at: '2026-11-03 11:04:00' })], [], { sent: 6, received: 1 }),
    made: LOG([req({ uid: 'm1', status: 'made', made_at: '2026-10-22T10:00:00Z', outcome: { label: 'Meeting held' } }), req({ uid: 'm-old', status: 'made', made_at: '2025-01-01T00:00:00Z' })]),
    summary: SUMMARY,
  }, NOW);
  const by = Object.fromEntries(groups.map((g) => [g.key, g]));
  assert.deepEqual(groups.map((g) => [g.key, g.count]), [['decide', 4], ['waiting', 9], ['accepted', 7], ['made', 4]]);
  assert.equal(by.decide.rows[0].title, 'Example Asker → Example Person');
  assert.equal(by.decide.rows[0].href, '/network/introductions?intro=d1&kind=request');
  assert.equal(by.waiting.rows[0].line, 'Waiting on Example Mate · requested 2026-11-05');
  assert.equal(by.accepted.rows[0].line, 'Example Mate accepted 2026-11-03 · the introduction itself has not been made yet');
  assert.deepEqual(by.made.rows.map((r) => r.key), ['m1'], 'made in the last 90 days only');
  assert.equal(by.made.rows[0].line, 'Made 2026-10-22 · outcome: Meeting held');
  const unreadSummary = introGroups({ pending: LOG(), accepted: LOG(), made: LOG([req({ uid: 'm1', status: 'made', made_at: '2026-11-01T00:00:00Z' })]), summary: fail }, NOW);
  assert.equal(unreadSummary[3].count, null, 'no whole-log count: none is drawn, never the page length');
  assert.equal(introGroups({ pending: fail, accepted: LOG(), made: LOG(), summary: SUMMARY }, NOW)[0].state, 'unreadable');
});

// Mutation checked: attention rows dropping the due date (fails); the B1 filter widened to not-overdue (Worker test).
test('NW1 needing attention: overdue follow-ups, each with its due date and the last note', () => {
  const rows = attentionRows(ready({ total: 2, items: [
    { task_uid: 't1', task_title: 'Send the update', due_on: '2026-11-04', contact: { name: 'Example Ada', title: 'Partner', company: 'Example Seed', sources: [] }, last_note_at: '2026-10-04T12:00:00Z' },
    { task_uid: 't2', task_title: 'Coffee', due_on: '2026-11-12', contact: { name: 'Example Cleo', sources: ['linkedin_csv'] }, last_note_at: null },
  ] }), NOW);
  assert.equal(rows[0].who, 'Example Ada · Partner, Example Seed');
  assert.equal(rows[0].line, 'Last recorded: note 41 days ago · Follow-up “Send the update” due 2026-11-04');
  assert.equal(rows[0].overdue, 'Overdue 10 d');
  assert.equal(rows[1].line, 'Imported from LinkedIn · Follow-up “Coffee” due 2026-11-12');
  assert.deepEqual(attentionRows(fail), []);
});

// Mutation checked: Accept on against an unread balance (fails); on at 0 (fails).
test('NW1 and NW5 curated matches: Accept is off against an unread or empty balance', () => {
  const ok = matchesView(ready({ propositions: [{ uid: 'p1', status: 'pending', target: { name: 'Example Kim', headline: 'GP' }, expires_at: '2026-11-20 00:00:00', breakdown: { reasons: ['Invests pre-seed'] } }, { uid: 'p2', status: 'declined', target: {} }], credits: { balance: 4 } }));
  assert.deepEqual(ok.rows.map((r) => r.uid), ['p1']);
  assert.equal(ok.rows[0].why, 'Invests pre-seed');
  assert.deepEqual(acceptGate(ok.credits), { enabled: true, note: 'Accepting spends 1 credit · 3 left after' });
  assert.equal(acceptGate(matchesView(ready({ propositions: [], credits: {} })).credits).enabled, false, 'unread balance');
  assert.match(acceptGate(matchesView(ready({ propositions: [], credits: {} })).credits).note, /never accepted against an unknown balance/);
  assert.deepEqual(acceptGate(matchesView(ready({ propositions: [], credits: { balance: 0 } })).credits), { enabled: false, note: 'Accepting needs 1 credit. You have 0 spendable credits.' });
});

// Mutation checked: first run on an unread book (fails); first run with a pending match (fails).
test('NW1.2 first run: only when every read came back and each is empty; sharing reads its own setting', () => {
  const empty = { book: ready({ total: 0 }), pending: LOG(), accepted: LOG(), made: LOG(), propositions: ready({ propositions: [], credits: { balance: 2 } }) };
  assert.equal(isFirstRun(empty), true);
  assert.equal(isFirstRun({ ...empty, book: fail }), false, 'an unread book is not an empty one');
  assert.equal(isFirstRun({ ...empty, book: READ_LOADING }), false);
  for (const k of ['pending', 'accepted', 'made', 'propositions']) assert.equal(isFirstRun({ ...empty, [k]: fail }), false, `an unread ${k} is not an empty one`);
  assert.equal(isFirstRun({ ...empty, propositions: ready({ propositions: [{ uid: 'p', status: 'pending' }] }) }), false);
  assert.equal(isFirstRun({ ...empty, book: ready({ total: 1 }) }), false);
  assert.equal(sharingLine(ready({ sharing: { opted_in: false, teams_shared: 0, teams_total: 1 } })).state, 'off');
  assert.equal(sharingLine(SUMMARY).text, 'You share your book with 1 of 2 teams.');
  assert.equal(sharingLine(fail).state, 'unreadable');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function mount(handler) {
  const restore = installDocument();
  const store = new Map([['user', JSON.stringify({ id: 2, role: 'founder', name: 'Example Founder', subscription_tier: 'pro' })]]);
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, matchMedia: globalThis.matchMedia };
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const calls = [];
  globalThis.fetch = async (u, init) => { calls.push(String(u)); return handler(String(u), init); };
  const { default: Desk } = await import('../src/pages/founder/FounderNetworkDesk.jsx');
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const Where = () => h('p', { 'data-testid': 'probe-location' }, useLocation().pathname);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/network'] },
    h(Routes, null, h(Route, { path: '/network', element: h(Desk) }), h(Route, { path: '*', element: h(Where) })))));
  const settleAll = async () => { await act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); }); };
  await settleAll();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    calls, has: (id) => !!byId(id), textOf: (id) => text(byId(id)), text: () => text(container),
    async click(id) { await act(async () => { props(byId(id)).onClick?.({ preventDefault() {} }); }); await settleAll(); },
    disabled: (id) => props(byId(id)).disabled === true,
    className: (id) => props(byId(id)).className || '',
    options: (id) => walk(byId(id)).filter((n) => n.nodeName === 'OPTION').map((n) => [props(n).value, text(n)]),
    async choose(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await settleAll(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const populated = (over = {}) => (url) => {
  for (const [re, fn] of Object.entries(over)) if (new RegExp(re).test(url)) { const r = fn(url); if (r) return r; }
  if (/\/contacts\/book\/follow-ups-due/.test(url)) return json({ total: 7, items: [{ task_uid: 't1', task_title: 'Send the update', due_on: '2026-11-04', contact: { id: 1, name: 'Example Ada', company: 'Example Seed', title: 'Partner', sources: [] }, last_note_at: null }] });
  if (/\/contacts\/book/.test(url)) return json({ total: 142, page: 1, page_size: 50, contacts: [] });
  if (/\/relationships\/summary/.test(url)) return json(SUMMARY.data);
  if (/intro-requests\?status=pending/.test(url)) return json({ sent: [req({ uid: 's1' })], received: [req({ uid: 'd1' })], totals: { sent: 1, received: 1, sent_pending: 2, received_pending: 3 } });
  if (/intro-requests\?status=accepted/.test(url)) return json({ sent: [req({ uid: 'a1', status: 'accepted', accepted_at: '2026-11-03' })], received: [], totals: { sent: 3, received: 0, sent_pending: 0, received_pending: 0 } });
  if (/intro-requests\?status=made/.test(url)) return json({ sent: [], received: [], totals: { sent: 0, received: 0, sent_pending: 0, received_pending: 0 } });
  if (/\/introductions\/propositions/.test(url)) return json({ propositions: [{ uid: 'p1', status: 'pending', target: { name: 'Example Kim', headline: 'GP' }, breakdown: { reasons: ['Invests pre-seed'] } }], credits: { balance: 4 } });
  if (/\/relationships\/activity/.test(url)) return json({ complete: true, sources: { follow_ups: { state: 'readable' }, introductions: { state: 'readable' }, imports: { state: 'readable' }, duplicate_reviews: { state: 'readable' } },
    events: [{ kind: 'follow_up_completed', at: '2026-11-06 16:20:00', label_parts: { action: 'Follow-up completed' } }, { kind: 'contacts_imported', at: '2026-10-30 18:47:00', label_parts: { action: 'Contacts imported', count: 118 } }] });
  if (/\/api\/contacts(\?|$)/.test(url)) return json({ items: [] });
  return json({});
};

// Mutation checked: the tiles drawn from a stub of zeroes (fails); the attention card unlinked from the read (fails).
test('NW1 mounted: populated — the tiles, the attention list, the four groups, the matches', async () => {
  const v = await mount(populated());
  try {
    assert.match(v.textOf('tile-network-connections'), /Connections\s*142\s*people in your relationship book/);
    assert.match(v.textOf('tile-network-attention'), /Needs attention\s*7\s*◷follow-ups past their due date/);
    assert.match(v.textOf('tile-network-decide'), /Awaiting my action\s*3/);
    assert.match(v.textOf('tile-network-active'), /Active introductions\s*5\s*2 waiting · 3 accepted, not yet made/);
    assert.match(v.textOf('row-attention-t1'), /Example Ada · Partner, Example Seed[\s\S]*Follow-up “Send the update” due 2026-11-04/);
    assert.match(v.textOf('text-network-strength'), /Relationship strength: Not recorded/);
    assert.match(v.textOf('group-intro-decide'), /Awaiting my decision · 3[\s\S]*Decide/);
    assert.match(v.textOf('group-intro-accepted'), /Accepted — not yet made · 3/);
    assert.match(v.textOf('card-network-activity'), /Follow-up completed\s*2026-11-06 16:20[\s\S]*Contacts imported · 118 added\s*2026-10-30 18:47/);
    assert.ok(v.calls.some((c) => /\/relationships\/activity\?limit=5$/.test(c)), 'D6557: the activity read, five events');
    assert.match(v.textOf('text-match-gate-p1'), /Accepting spends 1 credit · 3 left after/);
    assert.equal(v.disabled('button-match-accept-p1'), false);
    assert.ok(!v.has('network-first-run'));
    assert.ok(v.calls.some((c) => /\/contacts\/book\/follow-ups-due\?limit=3/.test(c)), 'B1: the overdue read');
  } finally { await v.close(); }
});

// D5310-p4. Mutation checked: the picker's counts dropped (fails); a choice that does not navigate (fails);
// the Overview choice navigating away (fails); the marked class not drawn (fails).
test('NW8 mounted: the Section picker names each zone with its count and opens it; the asking tiles are marked', async () => {
  const v = await mount(populated());
  try {
    assert.deepEqual(v.options('select-network-section'), [
      ['', 'Overview'], ['/network/people', 'People'], ['/network/relationships', 'Relationships · 142'], ['/network/introductions', 'Introductions · 5'], ['/network/organizations', 'Organizations'],
    ]);
    assert.match(v.className('tile-network-attention'), /is-marked/);
    assert.doesNotMatch(v.className('tile-network-connections'), /is-marked/);
    await v.choose('select-network-section', '');
    assert.ok(v.has('founder-network-desk'), 'Overview stays');
    await v.choose('select-network-section', '/network/relationships');
    assert.equal(v.textOf('probe-location'), '/network/relationships');
  } finally { await v.close(); }
});

// Mutation checked: first run shown over a failed book read (fails).
test('NW1.2 mounted: an empty book with nothing in motion is the first-run board', async () => {
  const empty = { 'contacts/book\\?': () => json({ total: 0, contacts: [] }), 'intro-requests': () => json({ sent: [], received: [], totals: { sent: 0, received: 0, sent_pending: 0, received_pending: 0 } }),
    propositions: () => json({ propositions: [], credits: { balance: 2 } }), summary: () => json({ ...SUMMARY.data, sharing: { opted_in: false, teams_shared: 0, teams_total: 1 } }) };
  const v = await mount(populated(empty));
  try {
    assert.ok(v.has('network-first-run'));
    assert.match(v.text(), /Build your relationship book[\s\S]*Import LinkedIn[\s\S]*Add person[\s\S]*Request introduction/);
    assert.ok(v.disabled('button-network-add-person'), 'no writer: disabled, with the reason beside it');
    assert.match(v.text(), /Adding a person by hand is not built yet/);
    assert.match(v.textOf('text-network-sharing'), /You are not sharing your book/);
    assert.match(v.text(), /Spendable intro credits: 2/);
  } finally { await v.close(); }
  const unread = await mount(populated({ ...empty, 'contacts/book\\?': () => json({ error: 'x' }, 500) }));
  try {
    assert.ok(!unread.has('network-first-run'), 'an unread book is not a first run');
    assert.match(unread.textOf('tile-network-connections'), /Could not be read/);
  } finally { await unread.close(); }
});

// Mutation checked: a failed read drawn as 0 (fails); Accept left on against an unread balance (fails).
test('NW5 mounted: every read failing draws Could not be read and Retry, and no figure is 0', async () => {
  const v = await mount(() => json({ error: 'unavailable' }, 503));
  try {
    for (const id of ['tile-network-connections', 'tile-network-attention', 'tile-network-decide', 'tile-network-active']) {
      assert.match(v.textOf(id), /Could not be read[\s\S]*This is not zero/, id);
      assert.doesNotMatch(v.textOf(id), /\b0\b/, `${id} drew a zero`);
    }
    assert.match(v.textOf('card-network-introductions'), /Introductions could not be read[\s\S]*Nothing is shown as zero/);
    assert.match(v.textOf('card-network-matches'), /Curated matches could not be read/);
    assert.match(v.textOf('card-network-activity'), /Recent network activity could not be read[\s\S]*This is not an empty history/);
  } finally { await v.close(); }
});

// D5310-p5. Mutation checked: the partial notice dropped (fails); an empty list with a failed source drawn as
// "Nothing recorded yet" (fails); Retry not re-reading the activity (fails).
test('NW1 mounted: a failed activity source is named, and an empty list it leaves is not an empty history', async () => {
  let reads = 0;
  const v = await mount(populated({ 'relationships/activity': () => { reads += 1; return json({ complete: false,
    sources: { follow_ups: { state: 'readable' }, introductions: { state: 'unreadable', reason: 'x' }, imports: { state: 'readable' }, duplicate_reviews: { state: 'readable' } }, events: [] }); } }));
  try {
    assert.match(v.textOf('text-network-activity-partial'), /Introductions could not be read\.\s*This is not an empty history/);
    assert.doesNotMatch(v.textOf('card-network-activity'), /Nothing recorded yet/);
    const before = reads;
    await v.click('button-network-activity-retry');
    assert.equal(reads, before + 1, 'Retry re-reads the activity');
  } finally { await v.close(); }
});

// Mutation checked: the retry dropping the earlier read (fails); no stale banner (fails).
test('NW5 mounted: a refresh that fails keeps what was read and says it is out of date', async () => {
  let fails = false;
  const v = await mount(populated({ 'intro-requests\\?status=pending': () => (fails ? json({ error: 'x' }, 503) : null) }));
  try {
    assert.ok(!v.has('status-network-stale'));
    fails = true;
    await v.click('button-network-refresh-intros');
    assert.match(v.textOf('status-network-stale'), /Partly out of date\.[\s\S]*Introductions could not be refreshed/);
    assert.match(v.textOf('tile-network-active'), /5[\s\S]*out of date/, 'the earlier read stays');
  } finally { await v.close(); }
});
