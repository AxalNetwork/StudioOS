/**
 * #4712 (D4712, Practice audit 3/6): a new advisor can complete the core
 * Practice workflow from an empty account without leaving a mounted page or
 * meeting a trap. Every record below is made up.
 *
 *   · "Record an engagement" and "Record a work product" show their forms in a
 *     true empty state;
 *   · the post-session review section has its own loading, error and empty
 *     state, and an unread review is "not read", never "No review";
 *   · "Add a version" is a real revision form: a change note and a web link are
 *     required, and Send says exactly which version it sends or why it cannot;
 *   · Sessions publishes slots and runs held / no-show / cancel itself;
 *   · none of those flows needs a retired or unmounted page.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/practice_first_use_4712.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import EngagementsZone from '../src/pages/advisor/practice/EngagementsZone.jsx';
import DeliveryZone from '../src/pages/advisor/practice/DeliveryZone.jsx';
import SessionsZone from '../src/pages/advisor/practice/SessionsZone.jsx';
import { outcomeBody, sendPreview, slotBody } from '../src/pages/advisor/practice/practiceTools.js';
import { reviewCoverage } from '../src/pages/advisor/practice/deliveryTrail.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// ---------------------------------------------------------------- pure rules

test('a slot needs a future start, an end after it, 1 to 20 seats and an https meeting link', () => {
  const now = new Date('2026-11-07T10:00:00Z');
  const ok = slotBody({ starts_at: '2026-11-10T09:00', ends_at: '2026-11-10T10:00', capacity: '2', meeting_url: ' https://meet.example/x ' }, now);
  assert.equal(ok.body.capacity, 2);
  assert.equal(ok.body.meeting_url, 'https://meet.example/x');
  assert.match(slotBody({ starts_at: '', ends_at: '' }, now).error, /starts and when it ends/);
  assert.match(slotBody({ starts_at: '2026-11-10T10:00', ends_at: '2026-11-10T09:00' }, now).error, /end after it starts/);
  assert.match(slotBody({ starts_at: '2026-11-01T10:00', ends_at: '2026-11-01T11:00' }, now).error, /future/);
  for (const bad of ['0', '21', '1.5', 'x']) assert.match(slotBody({ starts_at: '2026-11-10T09:00', ends_at: '2026-11-10T10:00', capacity: bad }, now).error, /Seats/);
  assert.match(slotBody({ starts_at: '2026-11-10T09:00', ends_at: '2026-11-10T10:00', meeting_url: 'javascript:alert(1)' }, now).error, /https/);
  assert.equal(slotBody({ starts_at: '2026-11-10T09:00', ends_at: '2026-11-10T10:00', capacity: '' }, now).body.capacity, 1, 'blank seats is one');
});

test('a cancel needs a reason the client will read; held takes none; a no-show may carry one', () => {
  assert.match(outcomeBody('cancel', '  ').error, /Say why/);
  assert.deepEqual(outcomeBody('cancel', ' Travel '), { note: 'Travel' });
  assert.deepEqual(outcomeBody('complete', 'ignored'), { note: null });
  assert.deepEqual(outcomeBody('no_show', ''), { note: null });
  assert.deepEqual(outcomeBody('no_show', 'Did not join'), { note: 'Did not join' });
  assert.match(outcomeBody('teleport', '').error, /Choose/);
});

test('Send names the version it sends, or says why there is nothing to send', () => {
  const item = (v) => ({ latest_version: v });
  assert.deepEqual(sendPreview(item({ version: 2, summary: 'Added the table', link_url: 'https://docs.example/q4' })),
    { sendable: true, line: 'Sends v2 — “Added the table” · opens docs.example' });
  assert.equal(sendPreview(item({ version: 1, summary: null, link_url: null })).sendable, false);
  assert.match(sendPreview(item({ version: 1, summary: 'x', link_url: 'http://insecure.example' })).line, /no content to send/);
  assert.equal(sendPreview({}).sendable, false);
});

test('review coverage: an unread session is unknown, never "no review"', () => {
  const sessions = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  assert.deepEqual(reviewCoverage(sessions, { 1: [{ rating: 5 }], 2: [], 3: null }), { reviewed: 1, awaiting: 1, unknown: 2 });
  assert.deepEqual(reviewCoverage([], {}), { reviewed: 0, awaiting: 0, unknown: 0 });
});

// ---------------------------------------------------------------- mounted

async function mount(Page, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const call = { method: (init.method || 'GET').toUpperCase(), path: url.pathname, query: url.search, body: init.body ? JSON.parse(init.body) : null };
    seen.push(call);
    return handle(call);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(Page))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const buttonWith = (re) => walk(document.body).find((n) => typeof props(n)?.onClick === 'function' && re.test(textOf(n)));
  return {
    seen, settle, text: () => textOf(document.body), byTestId, props, buttonWith,
    writes: () => seen.filter((c) => c.method !== 'GET'),
    async press(re) { const b = buttonWith(re); assert.ok(b, `no button ${re}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async pressId(id) { const b = byTestId(id); assert.ok(b, `no ${id}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await settle(); },
    async submit(id) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n).onSubmit({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const EMPTY_TOTALS = { active: 0, renewal_due: 0, renewal_rate: null, decided: 0, renewed: 0, ended_lane: 0, by_shape: {} };
const base = (c) => {
  if (c.path === '/api/advisors/me/engagements') return json({ items: [], totals: EMPTY_TOTALS });
  if (c.path === '/api/advisors/me/deliverables') return json({ items: [], totals: {} });
  if (c.path === '/api/advisors/me/bookings') return json({ items: [] });
  if (c.path === '/api/advisors/me/slots') return json({ items: [] });
  if (c.path === '/api/advisors/me/availability') return json({ weekly_paid_cap: null, buffer_minutes: null, min_notice_hours: null, blackouts: [], timezone: null, configured: false, revision: '' });
  if (c.path === '/api/advisors/me/session-types' || c.path === '/api/advisors/me/booking-links') return json({ items: [] });
  return json({});
};

test('mounted Engagements, empty: "Record an engagement" shows the form, and the first engagement is created', async () => {
  // Mutation checked: the form left inside the Board (not drawn when empty) → no client field after the press.
  const m = await mount(EngagementsZone, base);
  try {
    assert.match(m.text(), /No engagement is on file/);
    assert.equal(m.buttonWith(/^Add to Drafting$/), undefined, 'the form is closed first');
    await m.press(/Record an engagement/);
    assert.ok(m.buttonWith(/^Add to Drafting$/), 'the form is open in the empty state');
    const client = [...m.text().matchAll(/Client/g)].length;
    assert.ok(client > 0);
    await m.press(/^Close$/);
    assert.equal(m.buttonWith(/^Add to Drafting$/), undefined, 'and it closes');
  } finally { await m.close(); }
});

test('mounted Delivery, empty: the work-product form shows, and held sessions are reviewable with zero deliverables', async () => {
  // Mutation checked: the review section moved back inside ZoneBody → it is not drawn when there are no deliverables.
  const session = { id: 7, topic: 'First session', founder_name: 'Fran', slot_starts_at: '2026-11-01T10:00:00Z' };
  const m = await mount(DeliveryZone, (c) => {
    if (c.path === '/api/advisors/me/bookings') return json({ items: [session] });
    if (c.path === '/api/advisors/bookings/7/reviews') return json({ items: [] });
    return base(c);
  });
  try {
    assert.match(m.text(), /No work product is on file/);
    assert.match(m.text(), /Sessions you have held/, 'the review section is drawn with no deliverable');
    assert.ok(m.byTestId('row-pr3-session-7'));
    assert.ok(m.buttonWith(/Review this session/), 'and can be reviewed');
    assert.match(m.text(), /1 without a review/);
    await m.press(/Record a work product/);
    assert.ok(m.buttonWith(/^Add as v1$/), 'the work-product form is open in the empty state');
  } finally { await m.close(); }
});

test('mounted Delivery: unreadable reviews read as "not read", not "No review"; an unreadable session list says so', async () => {
  // Mutation checked: a failed review read stored as [] → "No review" and a form over reviews that were not read.
  const session = { id: 7, topic: 'First session', founder_name: 'Fran' };
  const unread = await mount(DeliveryZone, (c) => {
    if (c.path === '/api/advisors/me/bookings') return json({ items: [session] });
    if (c.path === '/api/advisors/bookings/7/reviews') return json({ detail: 'down' }, 500);
    return base(c);
  });
  try {
    assert.match(unread.text(), /Reviews not read/);
    assert.doesNotMatch(unread.text(), /No review/);
    assert.equal(unread.buttonWith(/Review this session/), undefined, 'no form over reviews that were not read');
    assert.match(unread.text(), /1 not read/);
  } finally { await unread.close(); }
  const down = await mount(DeliveryZone, (c) => (c.path === '/api/advisors/me/bookings' ? json({ detail: 'down' }, 500) : base(c)));
  try {
    assert.match(down.text(), /could not be read\. That is not a claim that you have none/);
    assert.ok(down.buttonWith(/Try again/));
  } finally { await down.close(); }
});

const DELIVERABLE = (v) => ({
  id: 1, title: 'Q4 review', client_name: 'Meridian Labs', state: 'not_started', version_count: 1, client_user_email: 'm@example.test',
  latest_version: { version: 1, summary: null, link_url: null, sent_at: null, opened_at: null, ...v },
});

test('mounted Delivery: "Add a version" is a real revision form: a note and a link are required, nothing empty is posted', async () => {
  // Mutation checked: the old handler (POST {} on click) → a write happens on the first press.
  const m = await mount(DeliveryZone, (c) => {
    if (c.path === '/api/advisors/me/deliverables' && c.method === 'GET') return json({ items: [DELIVERABLE({})], totals: {} });
    if (c.path === '/api/advisors/me/deliverables/1/versions') return json({ uid: 'v2', version: 2, ...c.body }, 201);
    return base(c);
  });
  try {
    await m.pressId('version-pr3-1');
    assert.equal(m.writes().length, 0, 'opening the form writes nothing');
    assert.ok(m.byTestId('attach-form-a1-1'), 'the revision form is open');
    assert.match(m.text(), /v2, not sent/);
    assert.match(m.text(), /v1 stays exactly as recorded/);
    await m.submit('attach-form-a1-1');
    assert.equal(m.writes().length, 0, 'an empty revision is refused before it is sent');
    assert.match(m.text(), /Say what changed/);
    assert.match(m.text(), /v1 has no content to send/, 'and the empty v1 cannot be sent');
    assert.equal(m.props(m.byTestId('send-pr3-1')).disabled, true);
  } finally { await m.close(); }
});

test('mounted Delivery: Send says which version goes out; a version with content is sendable', async () => {
  const m = await mount(DeliveryZone, (c) => {
    if (c.path === '/api/advisors/me/deliverables' && c.method === 'GET') {
      return json({ items: [DELIVERABLE({ version: 2, summary: 'Added the cohort table', link_url: 'https://docs.example/q4-v2' })], totals: {} });
    }
    if (c.path.endsWith('/send')) return json({ version: 2, sent_at: '2026-11-07T10:00:00Z' });
    return base(c);
  });
  try {
    assert.match(m.text(), /Sends v2 — “Added the cohort table” · opens docs\.example/);
    assert.notEqual(m.props(m.byTestId('send-pr3-1')).disabled, true);
    await m.pressId('send-pr3-1');
    assert.deepEqual(m.writes().map((c) => [c.method, c.path]), [['POST', '/api/advisors/me/deliverables/1/versions/2/send']]);
  } finally { await m.close(); }
});

test('mounted Sessions, empty: availability is published here, and a confirmed session is closed here', async () => {
  // Mutation checked: SlotPublisher not mounted → no publish control on the page.
  const confirmed = { id: 5, status: 'confirmed', topic: 'First session', founder_name: 'Fran', slot_starts_at: '2026-11-20T10:00:00Z', slot_ends_at: '2026-11-20T11:00:00Z', billing_state: 'unpriced', amount_cents: null };
  const m = await mount(SessionsZone, (c) => {
    if (c.path === '/api/advisors/me/bookings') return json({ items: [confirmed] });
    if (c.path === '/api/advisors/me/slots' && c.method === 'POST') return json({ id: 1, ...c.body });
    if (/\/api\/advisors\/bookings\/5\/(complete|no-show|cancel)$/.test(c.path)) return json({ id: 5, ok: true });
    return base(c);
  });
  try {
    assert.match(m.text(), /No slots in this window/);
    assert.ok(m.byTestId('slot-publisher-toggle'), 'the publisher is on the page with an empty calendar');
    await m.press(/^Publish a slot$/);
    assert.ok(m.byTestId('slot-publisher-form'));
    await m.submit('slot-publisher-form');
    assert.equal(m.writes().length, 0, 'an empty slot is refused before it is sent');
    const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 16);
    await m.type('slot-starts', day(3)); await m.type('slot-ends', `${day(3).slice(0, 11)}${String((Number(day(3).slice(11, 13)) + 1) % 24).padStart(2, '0')}${day(3).slice(13)}`);
    await m.type('slot-seats', '1');
    await m.submit('slot-publisher-form');
    const slotPost = m.writes().find((c) => c.path === '/api/advisors/me/slots');
    assert.ok(slotPost, JSON.stringify(m.writes()));
    assert.equal(slotPost.body.capacity, 1);

    // the confirmed session: cancel needs a reason, then held / no-show work
    await m.pressId('lifecycle-open-5');
    await m.pressId('lifecycle-cancel-5');
    await m.submit('lifecycle-form-5');
    assert.equal(m.writes().filter((c) => c.path.includes('/bookings/5/')).length, 0, 'a cancel with no reason is refused');
    assert.match(m.text(), /Say why you are cancelling/);
    await m.type('lifecycle-note-5', 'Travel');
    await m.submit('lifecycle-form-5');
    assert.deepEqual(m.writes().filter((c) => c.path.includes('/bookings/5/')).map((c) => [c.path, c.body]),
      [['/api/advisors/bookings/5/cancel', { reason: 'Travel' }]]);
  } finally { await m.close(); }
  for (const [outcome, path] of [['complete', 'complete'], ['no_show', 'no-show']]) {
    const k = await mount(SessionsZone, (c) => {
      if (c.path === '/api/advisors/me/bookings') return json({ items: [confirmed] });
      if (/\/bookings\/5\//.test(c.path)) return json({ ok: true });
      return base(c);
    });
    try {
      await k.pressId('lifecycle-open-5');
      await k.pressId(`lifecycle-${outcome}-5`);
      await k.submit('lifecycle-form-5');
      assert.deepEqual(k.writes().filter((c) => c.path.includes('/bookings/5/')).map((c) => c.path), [`/api/advisors/bookings/5/${path}`]);
    } finally { await k.close(); }
  }
});

test('a session already closed offers no lifecycle form; no mounted page sends the advisor to a retired one', () => {
  const lifecycle = read('pages/advisor/practice/SessionLifecycle.jsx');
  assert.match(lifecycle, /if \(booking\.status !== 'confirmed'\) return null;/);
  for (const f of ['SessionsZone', 'DeliveryZone', 'EngagementsZone', 'SlotPublisher', 'SessionLifecycle']) {
    const src = read(`pages/advisor/practice/${f}.jsx`);
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), /advisor\/advisory\/(opportunities|engagements|delivery)/, `${f} links to a retired tab`);
  }
  const sessions = read('pages/advisor/practice/SessionsZone.jsx');
  assert.doesNotMatch(sessions, /run from Engagements|Run the lifecycle|\/practice\/opportunities" className="text-emerald-700 underline">Publish availability/);
});
