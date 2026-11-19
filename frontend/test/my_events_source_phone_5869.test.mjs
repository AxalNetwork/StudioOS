// #5869 (D3724 §gaps 7 and 16, D5869): the Axal source badge on Discover's and
// the recommended row's cards, read from each event's `source` (ME5), and
// Upcoming's "Recommended for you" on a phone (ME11a), from the same read and
// actions as the desktop row. Fixtures and dates are fixed; nothing here reads
// the clock.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/my_events_source_phone_5869.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';
import RecommendedRow from '../src/pages/events/RecommendedRow.jsx';
import { DiscoverTabFull } from '../src/pages/events/MyEventsTabs.jsx';
import { EXTERNAL_EVENTS, SOURCE_LABELS, sourceLabel } from '../src/pages/events/myEventsTabsModel.js';
import { PHONE_NOT_ON, PHONE_ROOT, phoneRowState } from '../src/pages/events/myEventsPhoneModel.js';
import { EMPTY_LINE, ERROR_LINE, EXPLORER_REASON, FEW_LINE, NOT_ON, ROW_TITLE } from '../src/pages/events/recommendationsModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const pagePath = 'pages/events/MyEventsPage.jsx';
const page = read('frontend/src/' + pagePath);
const NOW = Date.parse('2026-11-10T12:00:00Z');
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const spaced = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(spaced).join(' ') : n.textContent || '');
const say = (n) => spaced(n).replace(/\s+/g, ' ').trim();

const EV = [
  { id: 7, slug: 'pricing', type: 'workshop', title: 'Pricing Workshop', starts_at: '2099-12-02T18:00:00Z', timezone: 'UTC', source: 'axal', registration_eligible: { eligible: true }, saved: false, reasons: [{ code: 'raise_round', text: 'You have a Seed round open.' }] },
  { id: 8, slug: 'social', type: 'networking', title: 'Operators Social', starts_at: '2099-12-09T18:00:00Z', timezone: 'UTC', registration_eligible: { eligible: true }, saved: false, reasons: [] },
];
const readyBody = (events = EV, extra = {}) => ({ enabled: true, profile: 'founder', signals: { interests: 'read', goals: 'not_recorded' }, events, ...extra });
const readyRead = (events = EV) => ({ status: 'ready', data: { available: true, value: readyBody(events) } });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('ME5: the badge is the event\'s own source; no source, or one not known, is no badge', () => {
  assert.deepEqual(SOURCE_LABELS, { axal: 'Axal' });
  assert.equal(sourceLabel({ source: 'axal' }), 'Axal');
  assert.equal(sourceLabel({}), null, 'no source: no guessed badge');
  assert.equal(sourceLabel({ source: null }), null);
  assert.equal(sourceLabel({ source: 'eventbrite' }), null, 'an external source is not drawn as Axal');
  assert.equal(sourceLabel({ source: 'toString' }), null, 'only the list\'s own keys');
  assert.equal(sourceLabel(null), null);
  assert.deepEqual({ ...EXTERNAL_EVENTS }, { label: 'External events', state: 'Not enabled', note: 'Axal’s own events only.' });
});

test('ME10 on a phone: the desktop states, with off drawing no row and no line that points at a Suggested card', () => {
  assert.equal(phoneRowState(null).kind, 'loading');
  assert.deepEqual(phoneRowState({ status: 'error' }), { kind: 'error', line: ERROR_LINE });
  const off = phoneRowState({ status: 'ready', data: { available: true, value: { enabled: false, events: [] } } });
  assert.equal(off.kind, 'off');
  assert.equal(off.hidden, true, 'recommendations turned off in Tune: no row');
  const notOn = phoneRowState({ status: 'ready', data: { available: false } });
  assert.deepEqual(notOn, { kind: 'not_on', line: PHONE_NOT_ON });
  assert.notEqual(notOn.line, NOT_ON);
  assert.doesNotMatch(PHONE_NOT_ON, /below|suggest/i);
  assert.equal(phoneRowState({ status: 'ready', data: { available: false, reason: 'Recommendations come with Validate + Build.' } }).line, 'Recommendations come with Validate + Build.', 'the Worker\'s own sentence is kept');
  assert.equal(phoneRowState({ status: 'ready', data: { available: false, unreadable: true } }).kind, 'error');
  assert.equal(phoneRowState({ status: 'ready', data: { available: true, value: readyBody([], { signals: { interests: 'not_recorded' } }) } }).line, FEW_LINE);
  assert.equal(phoneRowState({ status: 'ready', data: { available: true, value: readyBody([], { signals: { interests: 'read' } }) } }).line, EMPTY_LINE);
  const ready = phoneRowState(readyRead());
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.hidden, undefined);
});

/* ------------------------------------------------------------------ *
 * The badge on the cards
 * ------------------------------------------------------------------ */

const testIds = (ui, id) => ui.nodes().filter((n) => ui.props(n)['data-testid'] === id);
/** Whether a node with this test id is drawn. A boolean, so a failed check never prints the whole fake DOM. */
const has = (ui, id) => Boolean(ui.by(id));
const inside = (n, box) => { for (let p = n; p; p = p.parentNode) if (p === box) return true; return false; };
const badgesIn = (ui, box) => testIds(ui, 'my-events-source-badge').filter((b) => inside(b, box));

test('ME5: each recommended card shows the Axal badge from its source, beside its type; one with no source shows none', async () => {
  for (const layout of ['side', 'grid', 'swipe']) {
    const ui = await mountForm(h(RecommendedRow, { read: readyRead(), act: {}, layout }));
    try {
      const cards = testIds(ui, 'my-events-recommended-card');
      assert.equal(cards.length, 2, layout);
      const badgeIn = (card) => badgesIn(ui, card);
      assert.equal(badgeIn(cards[0]).length, 1, `${layout}: the Axal event's card`);
      assert.equal(textOf(badgeIn(cards[0])[0]), 'Axal');
      assert.equal(ui.props(badgeIn(cards[0])[0])['data-source'], 'axal');
      assert.match(say(cards[0]), /^Workshop Axal Pricing Workshop/, `${layout}: the type, then the badge, as ME5 draws it`);
      assert.equal(badgeIn(cards[1]).length, 0, `${layout}: no source, no badge`);
    } finally { await ui.unmount(); }
  }
});

test('ME10 on a phone: the row draws the state the phone gives it, not the desktop\'s words', async () => {
  const read = { status: 'ready', data: { available: false } };
  const ui = await mountForm(h(RecommendedRow, { read, act: {}, layout: 'swipe', state: phoneRowState(read) }));
  try {
    assert.equal(textOf(ui.by('my-events-recommended-note')), PHONE_NOT_ON);
    assert.equal(ui.props(ui.by('my-events-recommended'))['data-state'], 'not_on');
  } finally { await ui.unmount(); }
});

function discoverApi(events) {
  const calls = { public: [] };
  return {
    calls,
    api: {
      publicList: async (p) => { calls.public.push(p); return p.limit === 1 ? { events: [], total: events.length } : { events, total: events.length }; },
      eligibility: async () => ({ eligible: true, capacity: null, seats_taken: 0, is_full: false }),
      register: async () => ({ ok: true }),
    },
  };
}

test('ME5: each Discover card shows the badge from its source; External events reads "Not enabled" and does nothing', async () => {
  const listed = [
    { id: 31, slug: 'demo', title: 'Demo Day', type: 'demo_day', starts_at: '2026-11-20T18:00:00Z', timezone: 'UTC', price_cents: 0, source: 'axal' },
    { id: 32, slug: 'bare', title: 'Bare Row', type: 'workshop', starts_at: '2026-11-21T18:00:00Z', timezone: 'UTC', price_cents: 0 },
  ];
  const suggested = [
    { id: 41, slug: 's1', title: 'Suggested Axal', starts_at: '2026-11-22T18:00:00Z', timezone: 'UTC', source: 'axal' },
    { id: 42, slug: 's2', title: 'Suggested Bare', starts_at: '2026-11-23T18:00:00Z', timezone: 'UTC' },
  ];
  const { api } = discoverApi(listed);
  const ui = await mountForm(h(DiscoverTabFull, { api, held: new Map(), invitations: [], suggested, suggestionsRead: { status: 'ready' }, onRegistered: () => {}, onAccept: () => {}, now: NOW }));
  try {
    for (let i = 0; i < 4; i++) await ui.flush();
    const within = (card) => badgesIn(ui, card);
    const rows = testIds(ui, 'my-events-discover-row');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => within(r).map((b) => textOf(b))), [['Axal'], []], 'the listed rows: the badge only where the event says axal');
    const cards = testIds(ui, 'my-events-discover-suggested');
    assert.deepEqual(cards.map((c) => within(c).map((b) => textOf(b))), [['Axal'], []], 'the suggested cards too');
    const ext = ui.by('my-events-discover-external');
    assert.ok(ext, 'the External events chip');
    assert.equal(textOf(ext), 'External events · Not enabled');
    assert.equal(ext.tagName, 'SPAN', 'drawn, not a control: nothing to press');
    assert.equal(ui.props(ext).onClick, undefined);
    assert.match(ui.props(ext).className, /border-dashed/);
    assert.equal(textOf(ui.by('my-events-discover-axal-only')), 'Axal’s own events only.');
  } finally { await ui.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The phone row, on the mounted page
 * ------------------------------------------------------------------ */

const key = '__myEvents5869';
function prepare(user = { id: 2, role: 'founder' }) {
  globalThis[key] = {
    user,
    toast: { toast: null, showToast: () => {} },
    api: {
      list: async () => ({ hosting: [], attending: [], past: { places: [], total: 0 } }),
      invitations: async () => ({ invitations: [] }),
      feedStatus: async () => ({ subscribed: false, created_at: null, last_used_at: null }),
      calendarLinks: async () => ({ google: null, outlook: null, ics: null }),
      eligibility: async () => ({ eligible: true }),
      suggested: async () => ({ events: [] }),
      icsUrl: (id) => `/api/events/${id}/ics`,
    },
    publicApi: { list: async () => ({ events: [], total: 0 }) },
  };
}
function stub(source) {
  return source
    .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
    .replace(/import \{ eventsPublic \} from [^;]+;/, `const eventsPublic = globalThis.${key}.publicApi;`)
    .replace(/import \{ useAuth \} from [^;]+;/, `const useAuth = () => ({ user: globalThis.${key}.user });`)
    .replace(/import \{ useToast \} from [^;]+;/, `const useToast = () => globalThis.${key}.toast;`)
    .replace(/import PageExplainer[^;]+;/, 'const PageExplainer = () => null;');
}
/** The recommendation routes, through the real adapter and client, answered by `reply`. */
function serve(reply) {
  const seen = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^.*?\/api\//, '/api/');
    const call = { method: init.method || 'GET', path, body: init.body ? JSON.parse(init.body) : null };
    seen.push(call);
    return (await reply(call, seen)) || json({ detail: 'Not found' }, 404);
  };
  return { seen, restore: () => { globalThis.fetch = previous; } };
}
async function mount({ reply, phone = true, user } = {}) {
  prepare(user);
  const net = serve(reply);
  const Page = (await sourceModule(stub(page), pagePath)).default;
  const ui = await mountForm(h(Routes, { location: '/my/events' }, h(Route, { path: '/my/events/*', element: h(Page) }), h(Route, { path: '/my/events', element: h(Page) })), { phone, modal: true });
  for (let i = 0; i < 5; i += 1) await ui.flush();
  const press = async (n) => { assert.ok(n, 'no such node'); await act(async () => { await ui.props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); for (let i = 0; i < 4; i += 1) await ui.flush(); };
  const button = (label, under = null) => ui.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label && (!under || inside(n, under)));
  return { ...ui, seen: net.seen, press, button, all: (id) => testIds(ui, id), async unmount() { await ui.unmount(); net.restore(); } };
}
const recommended = (body, status = 200) => (c) => (c.method === 'GET' && c.path.startsWith('/api/events/recommended') ? json(body, status) : null);

test('ME11a at 390: Upcoming shows Recommended for you as a sideways row of cards, under Needs you and above the week', async () => {
  const ui = await mount({ reply: recommended(readyBody()) });
  try {
    const root = ui.by('my-events-phone');
    assert.ok(root && String(ui.props(root).className).split(/\s+/).includes(PHONE_ROOT), 'the phone page');
    const upcoming = ui.by('my-events-phone-upcoming');
    const row = ui.by('my-events-recommended');
    assert.ok(row, 'the row is drawn on the phone');
    assert.equal(ui.props(row)['data-state'], 'ready');
    const order = ui.nodes().map((n) => ui.props(n)['data-testid']).filter((id) => ['my-events-recommended', 'my-events-week'].includes(id));
    assert.deepEqual(order, ['my-events-recommended', 'my-events-week'], 'the row comes before the week strip');
    assert.ok(inside(row, upcoming), 'inside Upcoming');
    assert.match(say(row), new RegExp(`^${ROW_TITLE} Tune recommendations`));
    const swipe = ui.by('my-events-recommended-swipe');
    assert.ok(swipe, 'one sideways row');
    const cls = String(ui.props(swipe).className).split(/\s+/);
    for (const c of ['flex', 'overflow-x-auto', 'snap-x']) assert.ok(cls.includes(c), `the row scrolls inside itself: ${c}`);
    const cards = ui.all('my-events-recommended-card');
    assert.equal(cards.length, 2);
    for (const c of cards) {
      const k = String(ui.props(c).className).split(/\s+/);
      assert.ok(k.includes('w-[290px]') && k.includes('max-w-[85%]') && k.includes('flex-none'), 'a card is narrower than the screen, so the next one peeks');
      assert.ok(k.includes('bg-white') && k.includes('dark:bg-gray-900'), 'with its dark pair');
    }
    assert.deepEqual(ui.seen.filter((c) => c.path.startsWith('/api/events/recommended')).map((c) => c.path), ['/api/events/recommended?limit=8'], 'the desktop row\'s read, once');
  } finally { await ui.unmount(); }
});

test('ME11a: Save, Not for me (with Undo) and Why this? work on the phone as on desktop, through the same routes', async () => {
  const ui = await mount({ reply: (c) => {
    if (c.method === 'GET' && c.path.startsWith('/api/events/recommended')) return json(readyBody());
    if (c.method === 'POST' && /\/recommendation-feedback$/.test(c.path)) return json({ verdict: c.body.verdict });
    if (c.method === 'POST' && /\/recommendation\/explain\/quote$/.test(c.path)) return json({ microusd: 40000, quote_uid: 'q-5869' });
    return null;
  } });
  try {
    const first = () => ui.all('my-events-recommended-card')[0];
    await ui.press(ui.button('Save', first()));
    assert.deepEqual(ui.seen.at(-1), { method: 'POST', path: '/api/events/7/recommendation-feedback', body: { verdict: 'saved' } });
    assert.equal(ui.props(ui.button('Saved', first()))['aria-pressed'], true);

    // Why this? opens as a bottom sheet with the stored reasons; nothing runs until the cost is asked for.
    const before = ui.seen.length;
    await ui.press(ui.all('my-events-recommended-why')[0]);
    const why = ui.nodes().find((n) => ui.props(n)['data-testid'] === 'my-events-why-layer');
    assert.ok(why, 'the Why this? sheet');
    assert.equal(ui.props(why)['data-phone'], 'sheet', 'ME11b: a bottom sheet');
    assert.match(textOf(ui.by('my-events-why-reasons')), /You have a Seed round open\./);
    assert.equal(ui.seen.length, before, 'opening it is free');
    await ui.press(ui.by('my-events-why-ask'));
    assert.equal(ui.seen.at(-1).path, '/api/events/7/recommendation/explain/quote');
    assert.equal(textOf(ui.by('my-events-why-cost')), 'Costs $0.04 from your AI tokens');
    await ui.press(ui.by('my-events-why-close'));

    // Not for me: a sheet with the reason chips; Hide it sends the verdict, the card goes, Undo brings it back.
    await ui.press(ui.all('my-events-recommended-not-for-me')[1]);
    const sheet = ui.nodes().find((n) => ui.props(n)['data-testid'] === 'my-events-not-for-me-layer');
    assert.equal(ui.props(sheet)['data-phone'], 'sheet');
    await ui.press(ui.button('Timing'));
    await ui.press(ui.by('my-events-not-for-me-hide'));
    assert.deepEqual(ui.seen.at(-1), { method: 'POST', path: '/api/events/8/recommendation-feedback', body: { verdict: 'not_for_me', reason: 'timing' } });
    assert.equal(ui.all('my-events-recommended-card').length, 1, 'the hidden pick leaves the row');
    await ui.press(ui.by('my-events-recommended-undo'));
    assert.deepEqual(ui.seen.at(-1), { method: 'POST', path: '/api/events/8/recommendation-feedback', body: { verdict: null } });
    assert.equal(ui.all('my-events-recommended-card').length, 2);
  } finally { await ui.unmount(); }
});

test('ME10 on the phone: loading, Unreadable with Retry, too few signals and empty, each under the row\'s title', async () => {
  // Loading: the read has not answered.
  let ui = await mount({ reply: (c) => (c.path.startsWith('/api/events/recommended') ? new Promise(() => {}) : null) });
  try {
    assert.ok(ui.by('my-events-recommended-loading'), 'a skeleton while the read is out');
    assert.equal(has(ui, 'my-events-recommended'), false);
  } finally { await ui.unmount(); }

  // Unreadable, with Retry, which reads again and draws the row.
  let fail = true;
  ui = await mount({ reply: (c) => (c.path.startsWith('/api/events/recommended') ? (fail ? json({ error: 'unreadable' }, 503) : json(readyBody())) : null) });
  try {
    const row = ui.by('my-events-recommended');
    assert.equal(ui.props(row)['data-state'], 'error');
    assert.match(say(row), new RegExp(`^${ROW_TITLE} `));
    assert.match(say(row), /Recommendations could not be read\. That is not the same as having none\./);
    assert.equal(ui.all('my-events-recommended-card').length, 0, 'never an empty row in its place');
    fail = false;
    await ui.press(ui.button('Retry', row));
    assert.equal(ui.seen.filter((c) => c.path.startsWith('/api/events/recommended')).length, 2, 'Retry reads again');
    assert.equal(ui.props(ui.by('my-events-recommended'))['data-state'], 'ready');
  } finally { await ui.unmount(); }

  for (const [signals, kind, line] of [[{ interests: 'not_recorded', goals: 'not_recorded' }, 'few', FEW_LINE], [{ interests: 'read' }, 'empty', EMPTY_LINE]]) {
    ui = await mount({ reply: recommended(readyBody([], { signals })) });
    try {
      const row = ui.by('my-events-recommended');
      assert.equal(ui.props(row)['data-state'], kind);
      assert.equal(textOf(ui.by('my-events-recommended-note')), line);
      assert.match(say(row), new RegExp(`^${ROW_TITLE} `));
    } finally { await ui.unmount(); }
  }

  // Not available: the phone's own words, which point at no Suggested card.
  ui = await mount({ reply: recommended({ error: 'forbidden' }, 403) });
  try {
    assert.equal(ui.props(ui.by('my-events-recommended'))['data-state'], 'not_on');
    assert.doesNotMatch(textOf(ui.by('my-events-recommended-note')), /below/);
  } finally { await ui.unmount(); }
});

test('ME10 on the phone: recommendations turned off in Tune draw no row at all', async () => {
  const ui = await mount({ reply: recommended({ enabled: false, events: [] }) });
  try {
    assert.ok(ui.by('my-events-phone-upcoming'));
    assert.ok(ui.seen.some((c) => c.path.startsWith('/api/events/recommended')), 'the read ran');
    assert.equal(has(ui, 'my-events-recommended'), false, 'no row');
    assert.equal(has(ui, 'my-events-recommended-note'), false, 'and no line about suggestions the phone does not draw');
    assert.equal(has(ui, 'my-events-recommended-loading'), false);
  } finally { await ui.unmount(); }
});

test('ME2 on the phone: an Explorer sees "Popular with new members" on a pick with no reason of their own', async () => {
  const ui = await mount({ user: { id: 6, role: 'exploring' }, reply: recommended(readyBody([EV[1]], { profile: 'explorer' })) });
  try {
    const card = ui.all('my-events-recommended-card')[0];
    assert.ok(card);
    assert.match(say(card), new RegExp(EXPLORER_REASON));
  } finally { await ui.unmount(); }
});

test('desktop is unchanged: the row is the side column, not the phone\'s sideways row', async () => {
  const ui = await mount({ phone: false, reply: recommended(readyBody()) });
  try {
    assert.ok(ui.by('my-events'), 'the desktop page');
    assert.equal(has(ui, 'my-events-phone-upcoming'), false);
    assert.equal(ui.all('my-events-recommended').length, 1);
    assert.equal(has(ui, 'my-events-recommended-swipe'), false);
    assert.equal(ui.all('my-events-recommended-card').length, 2);
  } finally { await ui.unmount(); }
});

test('the page passes the phone the desktop row\'s read and actions; no new client', () => {
  assert.match(page, /<PhoneUpcoming [^>]*\n\s+recommended=\{recommended\} recommendAct=\{RECOMMEND_ACT\}/);
  const phone = read('frontend/src/pages/events/MyEventsPhone.jsx');
  assert.doesNotMatch(phone, /recommendationsAdapter|lib\/api/, 'the phone file reads nothing itself');
  assert.match(phone, /<RecommendedRow read=\{read\} act=\{act\} explorer=\{explorer\} layout="swipe" state=\{state\} \/>/);
});
