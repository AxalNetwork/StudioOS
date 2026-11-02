// D1205 (#2420) — the Calendar canvas (CAL1–CAL21): Month, Week and Agenda at
// their own addresses with Month first; a real Monday-to-Sunday week; the kinds
// as the canvas's five families; a failed source's chip a dash with its reason,
// never 0; and "Not read here yet" on what no read carries.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calendar_views_d1205.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CalendarPage from '../src/pages/CalendarPage.jsx';
import { FAMILIES, NOT_YET, VIEWS, WAITS, chipCount, familyOf, viewOf, windowFor } from '../src/pages/calendarViews.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const PAGE_KINDS = [...read('frontend/src/pages/CalendarPage.jsx').matchAll(/\{ id: '([a-z_]+)', label: '[^']+', from: '/g)].map((m) => m[1]);

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('three views at their own addresses, Month first; anything else under /calendar is Month', () => {
  assert.deepEqual(VIEWS.map((v) => [v.label, v.path]), [['Month', '/calendar'], ['Week', '/calendar/week'], ['Agenda', '/calendar/agenda']]);
  assert.equal(viewOf('/calendar'), 'month');
  assert.equal(viewOf('/calendar/week/'), 'week');
  assert.equal(viewOf('/calendar/agenda'), 'agenda');
  assert.equal(viewOf('/calendar/nope'), 'month');
});

test('the week is Monday to Sunday; the month is the calendar month; the agenda is 90 days', () => {
  const thu = new Date(2026, 10, 12, 15, 0); // Thu 12 Nov 2026
  const w = windowFor('week', thu);
  assert.deepEqual([w.from.getDate(), w.from.getDay(), w.to.getDate()], [9, 1, 16], 'Mon 9 to Mon 16 exclusive');
  const sun = windowFor('week', new Date(2026, 10, 15, 9));
  assert.equal(sun.from.getDate(), 9, 'a Sunday belongs to the week that started on Monday');
  const m = windowFor('month', thu);
  assert.deepEqual([m.from.getDate(), m.from.getMonth(), m.to.getMonth()], [1, 10, 11]);
  const a = windowFor('agenda', thu);
  assert.equal(Math.round((a.to - a.from) / 86_400_000), 90);
});

test('every kind the page reads is in exactly one family; Deadlines holds the Compliance layer (D1384)', () => {
  assert.deepEqual(FAMILIES.map((f) => f.label), ['Events', 'Meetings', 'Sessions', 'Deadlines', 'Learning', 'Grow', 'Tasks', 'From other calendars']);
  assert.deepEqual([...FAMILIES.flatMap((f) => f.kinds)].sort(), [...PAGE_KINDS].sort());
  assert.equal(familyOf('event_ticket'), 'events');
  assert.equal(familyOf('calendly_event'), 'other');
  // D1484 (#3977): the cohort dates and deal closings are deadlines too; #3982: so are a round's close and an NDA's expiry.
  assert.deepEqual(FAMILIES.find((f) => f.key === 'deadlines').kinds, ['compliance_due', 'cohort_date', 'deal_closing', 'round_close', 'nda_expiry']);
  assert.equal(PAGE_KINDS.length, 23, 'the page kind table parsed'); // #3959: Learning is the fifteenth; D1486 §b's two make seventeen; §c's two, nineteen; §d's four, twenty-three.
  assert.deepEqual(FAMILIES.find((f) => f.key === 'grow').kinds, ['publish_send', 'content_planned']);
  assert.deepEqual(FAMILIES.find((f) => f.key === 'tasks').kinds, ['workflow_task', 'mvp_task', 'contact_task', 'engagement_milestone']);
});

test('a failed source counts a dash, never 0; a read list counts; no list counts nothing', () => {
  const items = [{ kind: 'ic_meeting' }, { kind: 'ic_meeting' }];
  assert.equal(chipCount(items, 'ic_meeting', new Set()), 2);
  assert.equal(chipCount(items, 'calendly_event', new Set()), 0, 'a measured zero is fine');
  assert.equal(chipCount(items, 'calendly_event', new Set(['calendly_event'])), '—');
  assert.equal(chipCount(null, 'ic_meeting', new Set()), null);
  for (const w of Object.values(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), w);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mounted(url, events) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '');
    requests.push(path);
    if (path.startsWith('/calendar/events')) return response(events);
    return response({ configured: false, connected: false });
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify({ id: 3, role: 'founder', name: 'F', email: 'f@example.com' }));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(CalendarPage))));
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    requests, by,
    nodes: () => walk(container), pr,
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    current: () => walk(container).filter((n) => pr(n)['aria-current'] === 'page').map((n) => pr(n)['data-testid']).filter(Boolean),
    async click(id) { await act(async () => pr(by(id)).onClick?.({ preventDefault() {} })); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

const ALL_OK = (kinds) => kinds.map((kind) => ({ kind, ok: true, error: null }));

test('the address picks the view: the link is current and the read asks for that window', async () => {
  const ev = { items: [], sources: ALL_OK(PAGE_KINDS) };
  for (const [url, key] of [['/calendar', 'month'], ['/calendar/week', 'week'], ['/calendar/agenda', 'agenda']]) {
    const v = await mounted(url, ev);
    try {
      assert.deepEqual(v.current(), [`cal-view-${key}`], url);
      const q = new URLSearchParams(v.requests.find((r) => r.startsWith('/calendar/events?')).split('?')[1]);
      const want = windowFor(key);
      assert.equal(q.get('from'), want.from.toISOString(), url);
      assert.equal(q.get('to'), want.to.toISOString(), url);
    } finally { await v.close(); }
  }
});

test('a source that did not answer: its chip says a dash with why, never 0; the waits say Not read here yet', async () => {
  const sources = ALL_OK(PAGE_KINDS).map((s) => (s.kind === 'calendly_event' ? { ...s, ok: false, error: 'down' } : s));
  const v = await mounted('/calendar', { items: [{ id: 'ic_meeting:1', kind: 'ic_meeting', title: 'IC', start_at: new Date().toISOString(), end_at: null }], sources });
  try {
    // D1210: the counts live in the Kinds panel (CAL6), a dash with why beside the kind.
    await v.click('cal-kinds');
    assert.ok(v.text('cal-fam-other').includes('— · Could not be read'), 'the failed kind shows a dash with why');
    assert.ok(v.text('cal-fam-other').includes('and 1 unread'), 'its family says one is unread');
    assert.ok(!/read 0/.test(v.text()), 'the banner no longer says the chip reads 0');
    assert.equal(v.text('cal-waits').startsWith(NOT_YET), true);
    // D1212 (#3178) filled the whole-calendar subscription (Subscribe, CAL11): its wait is retired.
    assert.equal(WAITS.feed, undefined);
    assert.equal(v.by('cal-wait-feed'), undefined);
    for (const k of ['deadlines', 'interviews']) assert.ok(v.text(`cal-wait-${k}`).includes(WAITS[k].slice(0, 30)), k);
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the two view routes beside /calendar with its guard, and the canvas in incoming', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['', '/week', '/agenda']) {
    assert.ok(app.includes(`<Route path="/calendar${p}" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <CalendarPage />)} />`), p || 'base');
  }
  for (const f of ['Calendar Page.dc.html', 'Calendar · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Calendar · Boards.dc.html').includes('Calendar Page'), 'the boards import the page by name');
  assert.ok(existsSync('documentation/architecture/decisions/D1205.md'));
  assert.ok(existsSync('documentation/audits/CALENDAR_MAP_2026-10-25.md'));
});
