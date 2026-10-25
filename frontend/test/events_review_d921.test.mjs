/**
 * D921 (#2704) — part 6 of the admin Events desk (#2368): Review complete, as
 * EV3 to EV5, EV15c, EV17b and EV17c draw it.
 *
 * What this file holds Review to:
 *   · the queue's sorts (Waiting longest by default), its search over title,
 *     host and venture, and its four filters;
 *   · the wait from `submitted_at`, from `created_at` when an event was queued
 *     before part 2 (and saying so), overdue past 72 hours;
 *   · the preview, the facts part 2 and part 3 make readable (Submitted,
 *     Venture, Type, Format), the Clashes card (D915 §2) and the History card;
 *   · approve's third line counted only from the free-seat preview;
 *   · D917's 409 and 400 `reason_required`, each where the canvas puts it;
 *   · J and K, and the phone's full-screen sheet with 44 px targets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AdminEventsPage from '../src/pages/admin/AdminEventsPage.jsx';
import { CHANGED, DAY_MS, REASON_NEEDED, refusalText } from '../src/pages/admin/events/eventsDeskModel.js';
import {
  CREATED_FALLBACK, DELIVERY_LINE, FIRST_TIME, NO_ROLE, SUBMITTED_UNRECORDED, approveLine3Counted, clashesFor, compPreviewOf,
  coverOf, dateBlock, formatWord, historyOf, isOverdueWait, previewOf, queueRowView, reviewFacts, reviewFlags, reviewRows,
  roleChoices, stepSelection, typeChoices, typeWord, waitingOf, waitingText,
} from '../src/pages/admin/events/reviewModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;

const NOW = Date.parse('2026-10-24T12:00:00Z');
const HOUR = 3_600_000;
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();
const ahead = (days) => new Date(NOW + days * DAY_MS).toISOString();

// D918's list row: shapeEvent(row, { includePrivate: true }) plus its counts and host line.
const ev = (id, o = {}) => ({
  id, slug: `ev-${id}`, title: `Event ${id}`, type: 'meetup', summary: null, description: null, cover_url: null,
  starts_at: ahead(10), ends_at: null, timezone: 'UTC', location_kind: 'virtual', location_text: null,
  capacity: 40, waitlist_enabled: true, approval_required: false, visibility: 'public', status: 'pending_review',
  featured: false, price_cents: 0, currency: 'usd', created_at: ago(200), submitted_at: null, review_note: null,
  admin_published: false, audience_rules: {}, project_id: null,
  host: { name: 'Dana Ruiz', role: 'founder' }, venture: null, clash: false, waiting_hours: 0,
  ...o,
});
const ready = (data) => ({ status: 'ready', data });

/* ------------------------------------------------------------------ *
 * The wait
 * ------------------------------------------------------------------ */

test('the wait counts from submitted_at, from created_at for an event queued before part 2, and is overdue past 72 hours', () => {
  const submitted = waitingOf(ev(1, { submitted_at: ago(5), created_at: ago(500) }), NOW);
  assert.equal(submitted.from, 'submitted');
  assert.equal(waitingText(submitted), 'waiting 5 hours', 'the submission, not the creation');
  assert.equal(isOverdueWait(submitted), false);

  const legacy = waitingOf(ev(2, { submitted_at: null, created_at: ago(80) }), NOW);
  assert.equal(legacy.from, 'created');
  assert.equal(waitingText(legacy), 'waiting 3 days');
  assert.equal(isOverdueWait(legacy), true, '80 hours is past 72');
  assert.equal(queueRowView(ev(2, { submitted_at: null, created_at: ago(80) }), NOW).waitNote, CREATED_FALLBACK, 'the row says where the wait counts from');
  assert.equal(queueRowView(ev(1, { submitted_at: ago(5) }), NOW).waitNote, null);

  assert.equal(isOverdueWait(waitingOf(ev(3, { submitted_at: ago(72) }), NOW)), false, 'exactly 72 hours is not past it');
  assert.equal(isOverdueWait(waitingOf(ev(3, { submitted_at: ago(72.1) }), NOW)), true);
  assert.equal(waitingText(waitingOf(ev(4, { submitted_at: ago(0.2) }), NOW)), 'waiting under an hour');
  assert.equal(waitingText(waitingOf(ev(5, { submitted_at: ago(24) }), NOW)), 'waiting 1 day');
  assert.equal(waitingText(waitingOf(ev(6, { submitted_at: null, created_at: null }), NOW)), 'Waiting time not recorded', 'no time is not zero');
  assert.equal(isOverdueWait(waitingOf(ev(6, { submitted_at: null, created_at: null }), NOW)), false);
});

/* ------------------------------------------------------------------ *
 * The queue
 * ------------------------------------------------------------------ */

test('the sorts: Waiting longest by default (submitted, else created), Starts soonest, Newest; a missing value last', () => {
  const list = [
    ev(1, { submitted_at: ago(10), created_at: ago(400), starts_at: ahead(2) }),
    ev(2, { submitted_at: null, created_at: ago(50), starts_at: ahead(9) }),
    ev(3, { submitted_at: ago(90), created_at: ago(91), starts_at: null }),
    ev(4, { submitted_at: null, created_at: null, starts_at: ahead(5) }),
  ];
  assert.deepEqual(reviewRows(list, {}, NOW).map((e) => e.id), [3, 2, 1, 4], 'the oldest wait first; an event created 400 hours ago but submitted 10 hours ago has waited 10');
  assert.deepEqual(reviewRows(list, { sort: 'starts' }, NOW).map((e) => e.id), [1, 4, 2, 3], 'no start last');
  assert.deepEqual(reviewRows(list, { sort: 'created' }, NOW).map((e) => e.id), [2, 3, 1, 4], 'newest created first, no creation time last');
  const tie = [ev(7, { submitted_at: ago(5), starts_at: ahead(9) }), ev(8, { submitted_at: ago(5), starts_at: ahead(1) })];
  assert.deepEqual(reviewRows(tie, {}, NOW).map((e) => e.id), [8, 7], 'an equal wait falls back to the soonest start');
});

test('the search covers title, host and venture; the filters are type, host role, Free or Paid, and starts', () => {
  const list = [
    ev(1, { title: 'LP Briefing', type: 'lp_briefing', host: { name: 'Ana Lopes', role: 'founder' }, venture: { name: 'Northwind Labs' }, project_id: 4, starts_at: ahead(3) }),
    ev(2, { title: 'Pricing Workshop', type: 'workshop', host: { name: 'Ben Ode', role: 'advisor' }, price_cents: 4000, starts_at: ahead(20) }),
    ev(3, { title: 'Open Lab', type: 'mystery_type', host: { name: 'Cleo Park', role: null }, starts_at: ahead(45) }),
    ev(4, { title: 'Late night', type: 'meetup', host: null, starts_at: ago(2) }),
  ];
  const ids = (o) => reviewRows(list, o, NOW).map((e) => e.id).sort();
  assert.deepEqual(ids({ q: 'northwind' }), [1], 'the venture');
  assert.deepEqual(ids({ q: 'ben' }), [2], 'the host');
  assert.deepEqual(ids({ q: 'lab' }), [1, 3], 'the title (and Northwind Labs)');
  assert.deepEqual(ids({ filters: { type: 'workshop' } }), [2]);
  assert.deepEqual(ids({ filters: { role: 'founder' } }), [1]);
  assert.deepEqual(ids({ filters: { role: NO_ROLE } }), [3, 4], 'a host with no role, and no host');
  assert.deepEqual(ids({ filters: { price: 'paid' } }), [2]);
  assert.deepEqual(ids({ filters: { price: 'free' } }), [1, 3, 4]);
  assert.deepEqual(ids({ filters: { starts: 'week' } }), [1]);
  assert.deepEqual(ids({ filters: { starts: 'month' } }), [1, 2]);
  assert.deepEqual(ids({ filters: { starts: 'later' } }), [3]);
  assert.deepEqual(ids({ filters: { starts: 'started' } }), [4]);
  assert.deepEqual(ids({ filters: { type: 'workshop', price: 'free' } }), [], 'filters combine');
  assert.deepEqual(typeChoices(list).map((c) => c.label), ['Any type', 'Workshop', 'LP Briefing', 'Meetup', 'Mystery Type'], 'the registry\'s order, then a stored type it does not know');
  assert.deepEqual(roleChoices(list).map((c) => c.label), ['Any host role', 'Advisor', 'Founder', 'Role not recorded']);
});

test('a queue row: the host line, the type pill, the wait, and the Clash and Sent back flags', () => {
  const row = queueRowView(ev(1, { type: 'lp_briefing', venture: { name: 'Northwind Labs' }, project_id: 4, submitted_at: ago(80), clash: true, price_cents: 4000, review_note: 'Add the venue.' }), NOW);
  assert.equal(row.host, 'Dana Ruiz · Founder · Northwind Labs');
  assert.equal(row.type, 'LP Briefing');
  assert.equal(row.wait, 'waiting 3 days');
  assert.equal(row.overdue, true);
  assert.deepEqual(row.flags.map((f) => f.label), ['Paid $40', 'Clash', 'Sent back before'], 'a stored review_note means it was sent back; how often is the history\'s');
  assert.equal(row.flags.find((f) => f.label === 'Clash').tone, 'amber');
  assert.deepEqual(reviewFlags(ev(1, { review_note: 'x' }), 1).map((f) => f.label), ['Sent back once'], 'the selected event counts from its history');
  assert.deepEqual(reviewFlags(ev(1, { review_note: 'x' }), 2).map((f) => f.label), ['Sent back twice']);
  assert.deepEqual(reviewFlags(ev(1, { review_note: 'x' }), 0).map((f) => f.label), [], 'a history with no send-back clears the flag');
  assert.deepEqual(reviewFlags(ev(1)).map((f) => f.label), []);
  assert.equal(queueRowView(ev(2, { host: null }), NOW).host, 'Host not recorded');
  assert.equal(stepSelection([ev(1), ev(2), ev(3)], 2, 1), 3);
  assert.equal(stepSelection([ev(1), ev(2), ev(3)], 3, 1), 3, 'clamped at the end');
  assert.equal(stepSelection([ev(1), ev(2), ev(3)], 1, -1), 1, 'and at the start');
  assert.equal(stepSelection([ev(1), ev(2)], 99, 1), 1, 'an unknown selection starts at the top');
});

/* ------------------------------------------------------------------ *
 * The selected event
 * ------------------------------------------------------------------ */

test('the preview and the facts: type and format words, Submitted, Venture, and a cover only from http(s)', () => {
  assert.equal(typeWord('lp_briefing'), 'LP Briefing');
  assert.equal(typeWord('mystery_type'), 'Mystery Type');
  assert.equal(typeWord(''), null);
  assert.equal(formatWord('virtual'), 'Online');
  assert.equal(formatWord('physical'), 'In person', 'the legacy word');
  assert.equal(formatWord('in_person'), 'In person');
  assert.equal(formatWord('hybrid'), 'Hybrid');
  assert.equal(formatWord('teleport'), null);
  assert.equal(coverOf({ cover_url: 'https://cdn.example/c.png' }), 'https://cdn.example/c.png');
  assert.equal(coverOf({ cover_url: '/r2/c.png' }), '/r2/c.png');
  assert.equal(coverOf({ cover_url: 'javascript:alert(1)' }), null);
  assert.equal(coverOf({ cover_url: '//evil.example/x.png' }), null);
  assert.deepEqual(dateBlock({ starts_at: '2026-11-14T23:30:00Z', timezone: 'Asia/Tokyo' }), { m: 'NOV', d: '15', w: 'SUN' }, 'the event\'s own day');

  const p = previewOf(ev(1, { title: 'LP Briefing · Fund I', type: 'lp_briefing', location_kind: 'physical', location_text: 'Rua Exemplo 10', summary: 'How the fund invests.' }));
  assert.equal(p.place, 'In person · Rua Exemplo 10');
  assert.equal(p.lede, 'How the fund invests.');
  assert.equal(p.hostedBy, 'Hosted by Dana Ruiz.');
  assert.equal(previewOf(ev(1, { host: null })).hostedBy, 'Host not recorded.');

  const facts = (o) => Object.fromEntries(reviewFacts(ev(1, o)).map((f) => [f.label, f.value ?? f.unrecorded.text]));
  const f = facts({ type: 'workshop', location_kind: 'hybrid', location_text: 'Porto', submitted_at: '2026-10-11T09:00:00Z', venture: { name: 'Bluefern Health' }, project_id: 7 });
  assert.equal(f.Type, 'Workshop');
  assert.equal(f['Format and place'], 'Hybrid · Porto');
  assert.equal(f.Submitted, '11 Oct 2026');
  assert.equal(f.Venture, 'Bluefern Health');
  assert.equal(f.Place, undefined, 'Place is drawn with its format');
  assert.deepEqual(reviewFacts(ev(1)).map((x) => x.key).slice(-3), ['venture', 'created', 'submitted']);
  assert.equal(facts({ submitted_at: null }).Submitted, 'Not recorded', 'queued before part 2');
  assert.equal(reviewFacts(ev(1, { submitted_at: null })).find((x) => x.key === 'submitted').unrecorded, SUBMITTED_UNRECORDED);
  assert.equal(facts({ venture: null, project_id: null }).Venture, 'No venture');
  assert.equal(facts({ venture: { name: null }, project_id: 7 }).Venture, 'Not recorded', 'a venture whose name is gone is not "No venture"');
  assert.equal(facts({ type: '' }).Type, 'Not recorded');
});

test('Clashes: D915 §2\'s rule over every event, with how each starts against this one; a failed list says so', () => {
  const me = ev(1, { title: 'LP Briefing', starts_at: '2026-11-14T18:30:00Z', ends_at: '2026-11-14T21:00:00Z' });
  const all = [
    me,
    ev(2, { title: 'Operators Social', status: 'published', starts_at: '2026-11-14T18:00:00Z', ends_at: '2026-11-14T19:00:00Z' }),
    ev(3, { title: 'Late supper', status: 'published', starts_at: '2026-11-14T20:30:00Z' }),
    ev(4, { title: 'Called off', status: 'cancelled', starts_at: '2026-11-14T19:00:00Z' }),
    ev(5, { title: 'Next day', status: 'published', starts_at: '2026-11-15T18:30:00Z' }),
  ];
  const c = clashesFor(me, ready(all));
  assert.equal(c.state, 'ready');
  assert.deepEqual(c.items.map((x) => x.line), ['Operators Social starts 30 minutes earlier.', 'Late supper starts 2 hours later.'], 'a cancelled event and one the next day do not clash');
  assert.match(c.items[0].sub, /Published$/);
  assert.deepEqual(clashesFor(me, ready([ev(2, { starts_at: '2026-11-14T18:00:00Z', ends_at: '2026-11-14T19:00:00Z' })])).items.map((x) => x.id), [2], 'the selected event is added when the list does not hold it yet');
  assert.equal(clashesFor(me, { status: 'error' }).state, 'unreadable', 'never "No other event overlaps it"');
  assert.equal(clashesFor(me, { status: 'loading' }).state, 'loading');
  assert.deepEqual(clashesFor(ev(9, { starts_at: null }), ready(all)).items, [], 'no start, no clash');
});

test('History: each item in words, "First time in review." with no earlier send-back, and a failed read never reads as first time', () => {
  const at = (d) => `2026-10-${d}T09:00:00Z`;
  const back = historyOf(ready({ event_id: 1, history: { available: true, items: [
    { at: at('03'), action: 'event_submitted', actor: 'host' },
    { at: at('09'), action: 'event_rejected', actor: 'admin', reason: 'Add the venue address.' },
    { at: at('10'), action: 'event_updated', actor: 'host', fields: ['location_text', 'starts_at'] },
    { at: at('11'), action: 'event_submitted', actor: 'host' },
  ] } }));
  assert.equal(back.state, 'ready');
  assert.equal(back.firstTime, false);
  assert.equal(back.sentBack, 1);
  assert.deepEqual(back.lines.map((l) => l.text), [
    'Submitted on 3 Oct 2026.',
    'Sent back on 9 Oct 2026 by an admin: ‘Add the venue address.’',
    'Edited by the host on 10 Oct 2026: place and start.',
    'Submitted again on 11 Oct 2026.',
  ]);
  const first = historyOf(ready({ event_id: 1, history: { available: true, items: [{ at: at('11'), action: 'event_submitted', actor: 'host' }] } }));
  assert.equal(first.firstTime, true);
  assert.equal(first.sentBack, 0);
  assert.equal(historyOf(ready({ event_id: 1, history: { available: false, unreadable: true, reason: 'x' } })).state, 'unreadable');
  assert.equal(historyOf(ready({})).state, 'unreadable', 'a reply with no history block');
  assert.equal(historyOf({ status: 'error' }).state, 'unreadable');
  assert.equal(historyOf({ status: 'loading' }).state, 'loading');
  assert.deepEqual(historyOf(ready({ history: { available: true, items: [{ at: at('09'), action: 'event_rejected', actor: 'admin', reason: null }] } })).lines.map((l) => l.text), ['Sent back on 9 Oct 2026 by an admin.']);
});

test('approve\'s third line counts only from the free-seat preview, and says so when it cannot', () => {
  const both = ev(1, { audience_rules: { comp_official_partners: true, comp_invested_lps: true } });
  const counted = (partners, lps) => compPreviewOf(ready({ event_id: 1, sources: { available: true, official_partners: partners, invested_lps: lps }, seat_at_sign_up: [], minted: 0 }));
  const yes = (n) => ({ on: true, eligible: n + 2, already_invited: 2, would_invite: n });
  const off = { on: false, eligible: null, already_invited: null, would_invite: null };

  const line = approveLine3Counted(both, counted(yes(8), yes(4)));
  assert.equal(line.text, 'Emails 12 free-seat invitations: 8 official partners, 4 invested LPs.', 'would_invite, not eligible');
  assert.equal(line.delivery, DELIVERY_LINE);
  assert.equal(approveLine3Counted(both, counted(yes(1), off)).text, 'Emails 1 free-seat invitation: 1 official partner.');
  assert.equal(approveLine3Counted(both, counted(yes(0), yes(0))).text, 'Sends no invitations.', 'everyone eligible is invited already');
  assert.equal(approveLine3Counted(both, counted(yes(0), yes(0))).delivery, null);

  const unread = approveLine3Counted(both, compPreviewOf(ready({ sources: { available: false, unreadable: true, reason: 'x' } })));
  assert.equal(unread.text, 'Sends free-seat invitations to official partners and invested LPs not invited yet. The number could not be read.');
  assert.doesNotMatch(unread.text, /\d/, 'a failed preview states no count');
  assert.equal(approveLine3Counted(both, compPreviewOf({ status: 'error' })).state, 'unreadable');
  assert.equal(approveLine3Counted(both, compPreviewOf({ status: 'loading' })).state, 'loading');
  assert.equal(compPreviewOf(ready({ sources: { available: true, official_partners: { on: true, would_invite: 'many' }, invested_lps: off } })).state, 'unreadable', 'a count that is not a number is not read as one');

  const none = ev(2, { audience_rules: { comp_investors: true } });
  assert.equal(approveLine3Counted(none, compPreviewOf({ status: 'error' })).text, 'Sends no invitations. Investors get a free seat when they sign up; no invitation is sent to them.', 'with no inviting flag the preview is not needed');
});

test('refusals: D917\'s 409 says the event changed, and its 400 asks for the reason', () => {
  assert.equal(refusalText({ status: 409, code: 'not_waiting' }), CHANGED);
  assert.equal(CHANGED, 'This event changed while you were reading it. Reload to see the latest.');
  assert.equal(refusalText({ status: 400, code: 'reason_required' }), REASON_NEEDED);
  assert.equal(refusalText({ status: 400, data: { error: 'reason_required' } }), REASON_NEEDED, 'the code from the body\'s error word');
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

function worker({ queue = [], list = null, history = {}, comp = {}, writes = {} } = {}) {
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const post = url.match(/\/api\/admin\/events\/(\d+)\/([\w-]+)$/);
    if (method === 'POST' && post) return writes[post[2]] ? writes[post[2]](options) : response({ event: { id: Number(post[1]) } });
    if (post && post[2] === 'history') return history[post[1]] ? response(history[post[1]]) : response({ event_id: Number(post[1]), history: { available: true, items: [] } });
    if (post && post[2] === 'comp-preview') return comp[post[1]] ? response(comp[post[1]]) : response({ event_id: Number(post[1]), sources: { available: true, official_partners: { on: false }, invested_lps: { on: false } }, seat_at_sign_up: [], minted: 0 });
    if (/\/api\/admin\/events\?/.test(url)) {
      const q = new URLSearchParams(url.split('?')[1]);
      const source = q.get('status') === 'pending_review' ? queue : (list || queue);
      const offset = Number(q.get('offset'));
      return response({ events: source.slice(offset, offset + Number(q.get('limit'))) });
    }
    return response({});
  };
}

async function mounted(url, handle) {
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = make(tag);
    n.focus = function focus() { document.activeElement = this; };
    n.contains = function contains(other) { for (let x = other; x; x = x.parentNode) if (x === this) return true; return false; };
    return n;
  };
  const listeners = new Map();
  document.addEventListener = (type, fn) => { listeners.set(type, [...(listeners.get(type) || []), fn]); };
  document.removeEventListener = (type, fn) => { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); };
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, h(AdminEventsPage))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, flush, text: () => text(container),
    textOf: (id) => text(byId(id)),
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    props: (id) => props(byId(id)),
    queueOrder: () => nodes().map((n) => props(n)['data-testid']).filter((id) => /^events-queue-row-\d+$/.test(id || '')).map((id) => Number(id.split('-').pop())),
    selected: () => nodes().filter((n) => /^events-queue-row-\d+$/.test(props(n)['data-testid'] || '') && props(n)['aria-current'] === 'true').map((n) => Number(props(n)['data-testid'].split('-').pop())),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { p.onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); await flush(); },
    async key(key, target = { tagName: 'BODY' }) { await act(async () => { for (const fn of listeners.get('keydown') || []) fn({ key, target, preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const LIVE = Date.now();
const liveAgo = (hours) => new Date(LIVE - hours * HOUR).toISOString();
const liveAhead = (days) => new Date(LIVE + days * DAY_MS).toISOString();
const QUEUE = [
  ev(31, { title: 'Pricing Workshop', type: 'workshop', host: { name: 'Ben Ode', role: 'advisor' }, submitted_at: liveAgo(20), starts_at: liveAhead(25), price_cents: 4000 }),
  ev(32, { title: 'LP Briefing', type: 'lp_briefing', location_kind: 'physical', location_text: 'Rua Exemplo 10', host: { name: 'Ana Lopes', role: 'founder' },
    venture: { name: 'Northwind Labs' }, project_id: 4, submitted_at: liveAgo(80), created_at: liveAgo(300), starts_at: liveAhead(21), clash: true, review_note: 'Add the venue.',
    audience_rules: { comp_official_partners: true, comp_invested_lps: true } }),
  ev(33, { title: 'Open Lab', type: 'meetup', submitted_at: null, created_at: liveAgo(5), starts_at: liveAhead(30) }),
];

test('Review: the queue waits longest first, with each host line, wait and flag; the selected event draws its preview, facts, counts, clashes and history', async () => {
  const other = ev(40, { title: 'Operators Social', status: 'published', starts_at: new Date(Date.parse(QUEUE[1].starts_at) - 30 * 60_000).toISOString(), ends_at: new Date(Date.parse(QUEUE[1].starts_at) + HOUR).toISOString() });
  const view = await mounted('/admin/events/review', worker({
    queue: QUEUE,
    list: [...QUEUE, other],
    history: { 32: { event_id: 32, history: { available: true, items: [
      { at: '2026-10-03T09:00:00Z', action: 'event_submitted', actor: 'host' },
      { at: '2026-10-09T09:00:00Z', action: 'event_rejected', actor: 'admin', reason: 'Add the venue address.' },
      { at: '2026-10-11T09:00:00Z', action: 'event_submitted', actor: 'host' },
    ] } } },
    comp: { 32: { event_id: 32, sources: { available: true, official_partners: { on: true, eligible: 9, already_invited: 1, would_invite: 8 }, invested_lps: { on: true, eligible: 4, already_invited: 0, would_invite: 4 } }, seat_at_sign_up: [], minted: 0 } },
  }));
  try {
    assert.deepEqual(view.queueOrder(), [32, 31, 33], 'Waiting longest: 80 hours, 20 hours, then 5 hours counted from creation');
    assert.deepEqual(view.selected(), [32]);
    assert.equal(view.textOf('events-queue-host-32'), 'Ana Lopes · Founder · Northwind Labs');
    assert.match(view.textOf('events-queue-wait-32'), /^● waiting 3 days$/, 'the amber dot past 72 hours');
    assert.equal(view.textOf('events-queue-wait-31'), 'waiting 20 hours');
    assert.equal(view.props('events-queue-wait-33').title, CREATED_FALLBACK);
    assert.match(view.textOf('events-queue-row-32'), /LP Briefing.*Free seats.*Clash.*Sent back once/, 'the history counts the selected event\'s send-backs');
    assert.match(view.textOf('events-queue-row-31'), /Workshop.*Paid \$40/);
    assert.ok(view.requests.some((r) => r.url === '/api/admin/events/32/history'));
    assert.ok(view.requests.some((r) => r.url === '/api/admin/events/32/comp-preview'));
    assert.ok(!view.requests.some((r) => r.url.includes('/analytics') || r.url.includes('/roster') || r.url.includes('/summary')), 'Review reads no counts, names or summary');

    assert.match(view.textOf('events-review-preview'), /Preview on the public calendar.*LP Briefing.*In person · Rua Exemplo 10.*Hosted by Ana Lopes\..*This is how it will look once approved\./);
    assert.equal(view.textOf('events-fact-venture'), 'VentureNorthwind Labs');
    assert.match(view.textOf('events-fact-submitted'), /^Submitted\d+ \w+ \d{4}$/);
    assert.match(view.textOf('events-approving-does'), /Emails 12 free-seat invitations: 8 official partners, 4 invested LPs\./);
    assert.match(view.textOf('events-approving-does'), /StudioOS inbox, and by email where Gmail is set up/);
    assert.match(view.textOf('events-review-clashes'), /Operators Social starts 30 minutes earlier\./);
    assert.match(view.textOf('events-review-history'), /Sent back on 9 Oct 2026 by an admin: ‘Add the venue address\.’.*Submitted again on 11 Oct 2026\./);
    assert.ok(!view.testIds().includes('events-history-first'));

    await view.click('events-approve');
    assert.match(view.textOf('events-approve-lines'), /Emails 12 free-seat invitations: 8 official partners, 4 invested LPs\./, 'the dialog states the same counts');
    assert.equal(view.textOf('events-approve-delivery'), DELIVERY_LINE);
  } finally { await view.close(); }
});

test('Review: J and K move the selection, a filter and the sort reorder it, and a first submission reads "First time in review."', async () => {
  const view = await mounted('/admin/events/review', worker({ queue: QUEUE }));
  try {
    assert.deepEqual(view.selected(), [32]);
    await view.key('j');
    assert.deepEqual(view.selected(), [31]);
    await view.key('j');
    await view.key('j');
    assert.deepEqual(view.selected(), [33], 'clamped at the last row');
    await view.key('k');
    assert.deepEqual(view.selected(), [31]);
    await view.key('j', { tagName: 'INPUT' });
    assert.deepEqual(view.selected(), [31], 'not while typing in the search');
    await view.key('ArrowDown');
    assert.deepEqual(view.selected(), [31], 'the arrow keys move it only from inside the queue');
    assert.equal(view.textOf('events-history-first'), FIRST_TIME);

    await view.change('events-queue-sort', { value: 'starts' });
    assert.deepEqual(view.queueOrder(), [32, 31, 33], 'starts soonest');
    await view.change('events-queue-sort', { value: 'created' });
    assert.deepEqual(view.queueOrder()[0], 33, 'newest created');
    await view.change('events-queue-price', { value: 'paid' });
    assert.deepEqual(view.queueOrder(), [31]);
    await view.change('events-queue-price', { value: '' });
    await view.change('events-queue-search', { value: 'northwind' });
    assert.deepEqual(view.queueOrder(), [32], 'the venture is searched');
    await view.change('events-queue-search', { value: 'zzz' });
    assert.match(view.textOf('events-queue'), /Nothing in the queue matches\./);
  } finally { await view.close(); }
});

test('Review: a 409 closes the dialog and says the event changed, with a reload; a 400 reason_required is under the field', async () => {
  const view = await mounted('/admin/events/review', worker({
    queue: QUEUE,
    writes: {
      approve: () => response({ error: 'not_waiting' }, 409),
      reject: () => response({ error: 'reason_required' }, 400),
    },
  }));
  try {
    await view.click('events-approve');
    await view.click('events-approve-go');
    assert.ok(!view.testIds().includes('events-approve-dialog'), 'the dialog closes');
    assert.equal(view.textOf('events-review-changed'), CHANGED, 'under the action bar, as EV15c draws it');
    const before = view.requests.filter((r) => r.url.includes('status=pending_review')).length;
    await view.click('events-review-reload');
    assert.ok(view.requests.filter((r) => r.url.includes('status=pending_review')).length > before, 'Reload reads the queue again');
    assert.ok(!view.testIds().includes('events-review-changed'));

    await view.click('events-sendback');
    await view.change('events-sendback-reason', { value: 'Add the venue address.' });
    await view.click('events-sendback-go');
    assert.ok(view.testIds().includes('events-sendback-dialog'), 'the dialog stays open');
    assert.equal(view.textOf('events-sendback-field-error'), REASON_NEEDED);
    assert.equal(view.props('events-sendback-reason')['aria-invalid'], 'true');
    assert.ok(!view.testIds().includes('events-refusal'), 'not as a generic refusal under the buttons');
  } finally { await view.close(); }
});

test('Review on a phone: a tapped row opens a full-screen sheet with both actions at 44 px; ‹ Review and Escape close it', async () => {
  const view = await mounted('/admin/events/review', worker({ queue: QUEUE }));
  try {
    assert.match(view.props('events-review-event').className, /\bhidden lg:flex\b/, 'under lg, nothing until a row is tapped');
    await view.click('events-queue-row-31');
    const cls = view.props('events-review-event').className;
    assert.match(cls, /max-lg:fixed/);
    assert.match(cls, /max-lg:inset-0/);
    assert.equal(view.props('events-review-event').role, 'dialog');
    assert.match(view.textOf('events-review-sheet-head'), /‹ Review.*Pricing Workshop.*Waiting for review.*Workshop/);
    for (const id of ['events-sendback', 'events-approve', 'events-review-back']) assert.match(view.props(id).className, /min-h-\[44px\]/, `${id} is a 44 px target`);
    assert.match(view.props('events-queue-row-31').className, /min-h-\[44px\]/);
    await view.click('events-review-back');
    assert.match(view.props('events-review-event').className, /\bhidden lg:flex\b/);
    await view.click('events-queue-row-33');
    await view.key('Escape');
    assert.match(view.props('events-review-event').className, /\bhidden lg:flex\b/, 'Escape closes it');
  } finally { await view.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the source: the two new reads are the selected event\'s, no canvas sample reached the page, and D921 is recorded', () => {
  const page = read('frontend/src/pages/admin/events/EventsReview.jsx');
  const hook = read('frontend/src/pages/admin/events/useEventsDesk.js');
  assert.match(hook, /adminEvents\.history\(id\)/);
  assert.match(hook, /adminEvents\.compPreview\(id\)/);
  assert.match(page, /useReviewReads\(ev \? ev\.id : null, reads\.tick\)/, 'read for the selected event only');
  for (const sample of ['Northwind', 'Bluefern', 'Rua Exemplo', 'Fund I', 'Pricing Workshop', '[12]', '[$']) assert.ok(!page.includes(sample) && !read('frontend/src/pages/admin/events/reviewModel.js').includes(sample), sample);
  assert.doesNotMatch(page, /window\.confirm|useToast|dangerouslySetInnerHTML/);
  const decision = read('documentation/architecture/decisions/D921.md');
  assert.match(decision, /^## D921 /);
  assert.match(read('frontend/src/pages/admin/events/README.md'), /reviewModel\.js/);
});
