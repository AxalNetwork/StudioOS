// D1484 part 2 (#3978, of #3723) — CAL4: the calendar sources panel.
//
//   · the model: a failed source counts "—" with why, never 0; a hidden one says so;
//     families group in the Worker's order, leaving out empty ones;
//   · the panel at /calendar/sources, over the page, on a stubbed fetch: each
//     source by family, a toggle that saves `{ shown }`, a colour that saves a
//     token (or null for the family's), and the page re-reads after each;
//   · the rail's dot takes the member's colour.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calendar_sources_d1484.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CalendarPage from '../src/pages/CalendarPage.jsx';
import { COLOURS, countOf, coloursOf, groupsOf, sourcesOpen } from '../src/pages/calendarSourcesModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const FAMILIES = [{ key: 'meetings', label: 'Meetings' }, { key: 'events', label: 'Events' }, { key: 'validate', label: 'Validate' }, { key: 'tasks', label: 'Tasks' }];
const SOURCES = () => ([
  { key: 'ic_meeting', family: 'meetings', module: 'Deals › Investment committee', label: 'IC meeting', shown: true, colour: null, page_only: false },
  { key: 'event_ticket', family: 'events', module: 'My events › Tickets', label: 'Event ticket', shown: true, colour: null, page_only: false },
  { key: 'interview_call', family: 'validate', module: 'Validate › Customer research', label: 'Interview call', shown: true, colour: 'amber', page_only: true },
  { key: 'manual', family: 'tasks', module: 'Calendar', label: 'Your event', shown: false, colour: null, page_only: true },
]);
const PAGE = {
  items: [{ kind: 'ic_meeting', id: 1, title: 'Synthetic IC', start_at: '2026-11-10T10:00:00Z', end_at: '2026-11-10T11:00:00Z' }],
  sources: [{ kind: 'ic_meeting', ok: true, error: null }, { kind: 'event_ticket', ok: false, error: 'unreadable' }, { kind: 'interview_call', ok: true, error: null }],
  hidden: ['manual'],
};

test('the model: "—" with why for a failed source, never 0; hidden says so; families in order, empty ones left out', () => {
  // Mutation checked: countOf mapping a failed source to 0 → the "—" assert fails.
  const page = { items: PAGE.items, sources: PAGE.sources };
  assert.deepEqual(countOf('ic_meeting', { shown: true, ...page }), { text: '1', why: null });
  assert.deepEqual(countOf('event_ticket', { shown: true, ...page }), { text: '—', why: 'Did not answer this time.' });
  assert.deepEqual(countOf('interview_call', { shown: true, ...page }), { text: '0', why: null }, 'a source that answered with nothing is 0');
  assert.deepEqual(countOf('manual', { shown: false, ...page }), { text: 'Hidden', why: 'Not read while hidden.' });
  assert.equal(countOf('ic_meeting', { shown: true, items: null, sources: [] }).text, '—', 'the page read failed: never 0');
  assert.deepEqual(countOf('ic_meeting', { shown: true, items: [], sources: [{ kind: 'ic_meeting', ok: false, error: 'not_configured' }] }).why, 'Not set up on this server.');
  const groups = groupsOf({ families: [...FAMILIES, { key: 'grow', label: 'Grow' }], sources: SOURCES() });
  assert.deepEqual(groups.map((g) => g.key), ['meetings', 'events', 'validate', 'tasks'], 'Grow has no source, so no group');
  assert.deepEqual(groupsOf({ families: FAMILIES, sources: SOURCES() }, { allowed: ['event_ticket'] }).map((g) => g.key), ['events']);
  assert.deepEqual(coloursOf({ sources: SOURCES() }), { interview_call: 'amber' });
  assert.ok(sourcesOpen('/calendar/sources') && sourcesOpen('/calendar/sources/') && !sourcesOpen('/calendar/connected'));
  // The palette is the Worker's (migration 708 CHECK), and every token has a light and a dark value.
  const migration = read('cloudflare-worker/sql/migrations/708_calendar_source_prefs.sql');
  assert.deepEqual([...migration.match(/colour IN \(([^)]*)\)/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]), COLOURS);
  const css = read('frontend/src/pages/calendarPage.css');
  const light = css.match(/\.cal \{([\s\S]*?)\n\}/)[1], dark = css.match(/\.dark \.cal \{([\s\S]*?)\n\}/)[1];
  for (const c of COLOURS) {
    const l = light.match(new RegExp(`--pal-${c}: (#[0-9a-f]{6})`))?.[1], d = dark.match(new RegExp(`--pal-${c}: (#[0-9a-f]{6})`))?.[1];
    assert.ok(l && d && l !== d, `${c} has a light and a lifted dark value`);
    assert.match(css, new RegExp(`\\.cal-dot\\[data-colour='${c}'\\] \\{ background: var\\(--pal-${c}\\); \\}`));
  }
});

async function mounted(url) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const sent = [];
  let sources = SOURCES();
  globalThis.fetch = async (u, o = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const line = `${o.method || 'GET'} ${path}`;
    sent.push(o.body ? `${line} ${o.body}` : line);
    if (path.startsWith('/calendar/events')) return response(PAGE);
    if (path === '/calendar/sources') return response({ families: FAMILIES, sources, copy_target: 'all' });
    const m = path.match(/^\/calendar\/sources\/(\w+)$/);
    if (m && o.method === 'PUT') {
      const patch = JSON.parse(o.body);
      sources = sources.map((s) => (s.key === m[1] ? { ...s, ...patch } : s));
      return response({ source: sources.find((s) => s.key === m[1]) });
    }
    if (path.startsWith('/calendar/google/status') || path.startsWith('/calendar/microsoft/status')) return response({ configured: true, connected: false });
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify({ id: 3, role: 'founder', name: 'F', email: 'f@example.com' }));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const paths = ['/calendar', '/calendar/sources'];
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, ...paths.map((path) => h(Route, { key: path, path, element: h(CalendarPage) }))))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    sent, by, pr,
    text: (id) => { assert.ok(by(id), `no ${id}`); return txt(by(id)).replace(/\s+/g, ' ').trim(); },
    async change(id, target) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => pr(n).onChange?.({ target })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('CAL4 at /calendar/sources: by family, counts or "—" with why, a toggle and a colour that save, and the page re-reads', async () => {
  // Mutations checked: the toggle sending `colour` instead of `shown` → the PUT body assert fails;
  // the page not re-read after a change → the events count assert fails.
  const v = await mounted('/calendar/sources');
  try {
    assert.ok(v.by('cal-sources'), 'an in-page panel, over the calendar');
    for (const f of ['meetings', 'events', 'validate', 'tasks']) assert.ok(v.by(`cal-sources-family-${f}`), f);
    assert.equal(v.text('cal-source-ic_meeting-count'), '1');
    assert.equal(v.text('cal-source-event_ticket-count'), '—', 'a failed source is never 0');
    assert.equal(v.text('cal-source-event_ticket-why'), 'Did not answer this time.');
    assert.equal(v.text('cal-source-manual-count'), 'Hidden');
    assert.equal(v.pr(v.by('cal-source-manual-shown')).checked, false);
    assert.equal(v.pr(v.by('cal-source-interview_call-colour')).value, 'amber');
    assert.doesNotMatch(v.text('cal-sources-body'), /ic_meetings|calendar_events|interview_channel_refs/, 'no table name');
    const reads = () => v.sent.filter((l) => l.startsWith('GET /calendar/events')).length;
    const before = reads();
    await v.change('cal-source-ic_meeting-shown', { checked: false });
    assert.ok(v.sent.includes('PUT /calendar/sources/ic_meeting {"shown":false}'), v.sent.join('\n'));
    assert.equal(v.pr(v.by('cal-source-ic_meeting-shown')).checked, false);
    assert.equal(v.text('cal-source-ic_meeting-count'), 'Hidden');
    assert.ok(reads() > before, 'the page re-reads after a change');
    await v.change('cal-source-event_ticket-colour', { value: 'teal' });
    assert.ok(v.sent.includes('PUT /calendar/sources/event_ticket {"colour":"teal"}'));
    await v.change('cal-source-interview_call-colour', { value: '' });
    assert.ok(v.sent.includes('PUT /calendar/sources/interview_call {"colour":null}'), 'Family colour clears the token');
  } finally { await v.close(); }
});

test('the rail: each source\'s dot takes the member\'s colour, and links to the panel', async () => {
  const v = await mounted('/calendar');
  try {
    assert.equal(v.pr(v.by('cal-rail-dot-interview_call'))['data-colour'], 'amber');
    assert.equal(v.pr(v.by('cal-rail-dot-ic_meeting'))['data-colour'], undefined, 'no colour set: the family\'s hue');
    assert.equal(v.pr(v.by('cal-sources-open')).href, '/calendar/sources');
    assert.equal(v.by('cal-sources'), undefined, 'the panel opens only at its address');
  } finally { await v.close(); }
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/calendar\/sources" element=\{guard\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\], <CalendarPage \/>\)\} \/>/, 'the same guard as /calendar/connected');
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/calendarSources\.js';/);
});
