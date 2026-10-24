import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { overviewFixture } from './_events_overview_fixture.mjs';
import EventsOverview from '../src/pages/admin/events/EventsOverview.jsx';
import AdminEventsPage from '../src/pages/admin/AdminEventsPage.jsx';
import { ChartTable, HBars, WeekLines } from '../src/ui/Charts.jsx';
import { overviewBlock, paidLines, profileParts, registrationDelta, weeklyChart, nextEvents } from '../src/pages/admin/events/overviewModel.js';

const h = React.createElement;
const ready = (data) => ({ status: 'ready', data });
const NOW = Date.parse('2026-10-24T12:00:00Z');
const list = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, title: `Synthetic next ${i + 1}`, status: i === 0 ? 'pending_review' : 'published', starts_at: `2026-11-0${i + 1}T12:00:00Z`, timezone: 'UTC', type: 'workshop', location_kind: 'physical', seats_taken: 3, capacity: i === 1 ? 0 : 40, waitlisted: 0 }));
const reads = (data = overviewFixture()) => ({ overview: ready(data), all: ready(list), reload() {} });
const markup = (r) => renderToStaticMarkup(h(MemoryRouter, null, h(EventsOverview, { reads: r, now: NOW })));
const section = (s, id) => s.split(`data-testid="${id}"`)[1]?.split('</section>')[0] || '';
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

async function mount(element, fetcher = null) {
  const restore = installDocument();
  const before = globalThis.fetch;
  if (fetcher) globalThis.fetch = fetcher;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const flush = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/events'] }, element)));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const nodeText = (n) => n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(nodeText).join(' ') : n?.textContent || '';
  return { by, props, flush, text: (id) => nodeText(id ? by(id) : container).replace(/\s+/g, ' '),
    async click(id) { assert.ok(by(id), id); await act(async () => { const p = props(by(id)); (p.onClick || p.onChange)(); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = before; restore(); },
  };
}

test('D920: recorded money stays per currency, comparisons need a base, unknown profiles stay outside Other', () => {
  const f = overviewFixture();
  assert.deepEqual(paidLines(f.paid), ['$24 USD', '€18 EUR']);
  assert.match(paidLines({ ...f.paid, by_currency: [{ currency: 'usd', amount_cents: 100, amount_not_recorded: 2 }] })[0], /amount not recorded for 2 tickets/);
  assert.equal(registrationDelta(18, 12), '+50% from the previous period');
  assert.equal(registrationDelta(2, 0), 'No registrations in the previous period');
  assert.equal(registrationDelta(0, 0), 'No change from the previous period');
  assert.equal(registrationDelta(null, 2), 'Comparison not recorded');
  assert.deepEqual(profileParts(f.by_role).map((p) => [p.label, p.value]), [['Founders', 12], ['Investors', 5], ['Advisors', 3], ['Operating Partners', 2], ['Other', 4]]);
  assert.equal(nextEvents(ready([...list, { ...list[0], id: 99, status: 'cancelled' }]), NOW).rows.length, 5);
  assert.equal(nextEvents({ status: 'error' }, NOW).state, 'unreadable');
  assert.deepEqual(weeklyChart(f.weekly).series[1].values, [0, null, 4]);
});

test('D920: every overview block distinguishes ready, loading, failed and explicitly unrecorded', () => {
  const keys = ['queue', 'upcoming_30d', 'weekly', 'show_up', 'waitlisted', 'paid', 'payment_pending', 'free_seats', 'cancelled', 'needs_attention', 'by_type', 'by_role', 'by_source', 'by_status', 'views', 'feedback'];
  const ids = ['events-tile-waiting', 'events-tile-next30', 'events-block-weekly', 'events-block-showup', 'events-tile-waitlists', 'events-tile-paid', 'events-tile-paid', 'events-tile-free', 'events-tile-cancelled', 'events-block-attention', 'events-block-types', 'events-block-who', 'events-block-who', 'events-block-status', 'events-block-views', 'events-block-feedback'];
  keys.forEach((key, i) => {
    assert.equal(overviewBlock(ready({ [key]: { available: true } }), key).state, 'ready');
    for (const [block, expected] of [[{ available: false, unreadable: true, reason: `Synthetic ${key} failure` }, 'could not be read'], [{ recorded: false, reason: `Synthetic ${key} absent` }, 'Not recorded']]) {
      const f = overviewFixture(); f[key] = block;
      const s = markup(reads(f));
      assert.match(text(section(s, ids[i])), new RegExp(expected), key);
      if (key !== 'upcoming_30d') assert.match(text(section(s, 'events-tile-next30')), /214 seats taken/, 'a failed block leaves its neighbor readable');
    }
    assert.equal(overviewBlock({ status: 'loading' }, key).state, 'loading');
    assert.equal(overviewBlock(ready({}), key).state, 'unreadable', 'missing answer is not a real zero');
  });
  const loading = markup({ ...reads(), overview: { status: 'loading' } });
  assert.match(text(section(loading, 'events-tile-registrations')), /Reading/);
  assert.doesNotMatch(text(section(loading, 'events-tile-registrations')), /\b0\b/);
  const failed = markup({ ...reads(), overview: { status: 'error' } });
  assert.match(text(section(failed, 'events-block-weekly')), /could not be read/);
});

test('D920: the canvas blocks show their recorded values, action targets, limits and empty states', async () => {
  const f = overviewFixture();
  const s = markup(reads(f));
  assert.match(text(section(s, 'events-tile-waiting')), /3.*Oldest 80 hours.*1 Overdue · past 72 hours/);
  assert.match(text(section(s, 'events-tile-registrations')), /18.*\+50%/);
  assert.match(text(section(s, 'events-tile-paid')), /\$24 USD.*€18 EUR.*5 paid.*4 payment pending/);
  assert.match(text(section(s, 'events-tile-cancelled')), /starting this period · 1 had paid tickets/);
  assert.equal((s.match(/data-testid="events-attention-\d"/g) || []).length, 6);
  assert.match(text(section(s, 'events-block-attention')), /Showing 6 of 9 items/);
  assert.ok(s.includes('/admin/events/calendar?month=2026-11'));
  assert.ok(section(s, 'events-block-attention').includes('href="/admin/events/review"'));
  assert.match(text(section(s, 'events-block-next')), /No cap/);
  assert.ok(s.includes('/admin/events/all?view=attention'));
  assert.equal((s.match(/data-testid="events-next-\d"/g) || []).length, 5);
  assert.match(text(section(s, 'events-block-next')), /Workshop.*In person.*Sign-ups open once approved/);
  assert.match(text(section(s, 'events-block-showup')), /All events 61%/);
  assert.match(text(section(s, 'events-block-who')), /Unknown profiles: 4.*Added by an admin.*Not recorded/);
  assert.ok(s.includes('chart-reference'));
  f.show_up.recent = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, title: `Ended ${i + 1}`, attended: 1, seats_taken: 2, rate: 0.5 }));
  const capped = text(section(markup(reads(f)), 'events-block-showup'));
  assert.match(capped, /Ended 8/);
  assert.doesNotMatch(capped, /Ended 9/);
  for (const key of ['queue', 'upcoming_30d', 'waitlisted', 'free_seats', 'cancelled']) for (const k of Object.keys(f[key])) if (typeof f[key][k] === 'number') f[key][k] = 0;
  f.show_up = { available: true, events: 0, seats_taken: 0, rate: null, recent: [] };
  f.by_status.counts = Object.fromEntries(Object.keys(f.by_status.counts).map((k) => [k, 0]));
  const empty = markup({ ...reads(f), all: ready([]) });
  assert.match(text(empty), /No events yet/);
  assert.match(text(section(empty, 'events-tile-waiting')), /0.*Nothing waits/);
  assert.match(text(section(empty, 'events-tile-showup')), /No event has ended yet/);
  assert.match(text(section(empty, 'events-block-next')), /No upcoming events/);
  f.by_role.counts = { founder: 0, investor: 0, advisor: 0, partner: 0, exploring: 0, guest: 0, admin: 0, not_recorded: 4 };
  const unknownOnly = markup(reads(f)).split('data-testid="events-who-profile"')[1].split('data-testid="events-who-source"')[0];
  assert.match(text(unknownOnly), /No recorded profiles this period/);
  assert.doesNotMatch(text(unknownOnly), /No seats taken/);
});

test('D920: chart/table toggles preserve zero, missing values and the current week, and Show all reveals twelve types', async () => {
  const m = await mount(h(EventsOverview, { reads: reads(), now: NOW }));
  try {
    assert.match(m.text('events-weekly-sentence'), /\+50%.*61%/);
    await m.click('events-table-weekly');
    assert.match(m.text('events-block-weekly'), /5 Oct 0 0.*12 Oct 10 not recorded.*19 Oct \(so far\) 8 4/);
    await m.click('events-types-all');
    await m.click('events-table-types');
    assert.match(m.text('events-block-types'), /Office Hours 0.*LP Briefing 0.*Other 0/);
    await m.click('events-table-profile');
    assert.match(m.text('events-who-profile'), /Founders 12.*Investors 5.*Operating Partners 2.*Other 4/);
    await m.click('events-table-showup');
    assert.match(m.text('events-block-showup'), /Synthetic ended event 6 of 10 · 60%/);
  } finally { await m.close(); }
});

test('D920: the shared charts break missing weeks, keep the current point hollow, and place a reference on a fixed percentage scale', () => {
  const s = renderToStaticMarkup(h(WeekLines, { labels: ['A', 'B', 'C', 'D'], series: [{ label: 'Scans', tone: 'sky', values: [0, null, 3, 4] }] }));
  assert.equal((s.match(/<polyline/g) || []).length, 1);
  assert.equal(s.match(/<polyline[^>]+points="([^"]+)"/)[1].split(' ').length, 2, 'the line never bridges the missing week');
  assert.match(s, /r="4.5"[^>]*fill-white/);
  const bars = renderToStaticMarkup(h(HBars, { rows: [{ label: 'Ended', value: 60 }], max: 100, reference: 61 }));
  assert.match(bars, /width="310.8"/);
  assert.match(bars, /x1="465.98"[^>]*data-testid="chart-reference"/);
  const long = renderToStaticMarkup(h(HBars, { rows: [{ label: 'A very long synthetic event title that cannot fit', value: 1 }], truncateLabels: true }));
  assert.match(long, /…<\/text>/);
  assert.doesNotMatch(long, /cannot fit/);
});

test('D920: changing the period re-reads all blocks, hides the old period and rejects a late answer', async () => {
  const calls = [];
  const held = new Map();
  const fetcher = async (url) => {
    const u = String(url); calls.push(u);
    if (u.includes('/admin/events/overview')) {
      const n = new URL(u, 'https://example.test').searchParams.get('weeks');
      if (n === '12') return Response.json(overviewFixture());
      return new Promise((resolve) => held.set(n, resolve));
    }
    if (u.includes('/admin/events?')) return Response.json({ events: [] });
    return Response.json({});
  };
  const m = await mount(h(AdminEventsPage), fetcher);
  try {
    assert.ok(calls.some((u) => u.endsWith('/overview?weeks=12')));
    assert.ok(!calls.some((u) => u.includes('/analytics') || u.includes('/roster')));
    await m.click('events-period-4');
    assert.match(m.text('events-tile-registrations'), /Reading/);
    assert.doesNotMatch(m.text('events-tile-registrations'), /18/);
    await m.click('events-period-52');
    const year = overviewFixture(); year.weekly.registrations.this_period = 99;
    held.get('52')(Response.json(year)); await m.flush();
    held.get('4')(Response.json(overviewFixture())); await m.flush();
    assert.match(m.text('events-tile-registrations'), /99/);
    assert.equal(m.props(m.by('events-period-52')).checked, true);
    assert.ok(calls.some((u) => u.endsWith('/overview?weeks=4')));
    assert.ok(calls.some((u) => u.endsWith('/overview?weeks=52')));
  } finally { await m.close(); }
});

test('D920: even the first committed frame after a period change hides the previous period', async () => {
  const { useEventsDesk } = await import('../src/pages/admin/events/useEventsDesk.js');
  const frames = [];
  function Probe() {
    const [weeks, setWeeks] = React.useState(12);
    const r = useEventsDesk('overview', null, { weeks });
    React.useLayoutEffect(() => { frames.push({ weeks, status: r.overview.status, value: r.overview.data?.weekly?.registrations?.this_period }); });
    return h(EventsOverview, { reads: r, now: NOW, weeks, onWeeks: setWeeks });
  }
  const m = await mount(h(Probe), async (url) => {
    if (String(url).includes('/overview?weeks=4')) return new Promise(() => {});
    if (String(url).includes('/overview')) return Response.json(overviewFixture());
    return Response.json({ events: [] });
  });
  try {
    assert.ok(frames.some((r) => r.weeks === 12 && r.value === 18));
    await m.click('events-period-4');
    const changed = frames.filter((r) => r.weeks === 4);
    assert.ok(changed.length > 0);
    assert.ok(changed.every((r) => r.status === 'loading' && r.value === undefined), 'no committed frame labels old numbers as the new period');
  } finally { await m.close(); }
});


test('D920 review: a missing type count leaves known bars intact, incomplete event rows are not an empty period, and completed weeks stay complete', () => {
  const f = overviewFixture(); delete f.by_type.counts.demo_day;
  const s = markup(reads(f));
  assert.match(text(section(s, 'events-block-types')), /Not recorded/);
  assert.doesNotMatch(section(s, 'events-block-types'), /NaN/);
  assert.match(section(s, 'events-block-types'), /width="[1-9]/);
  const sparseBars = renderToStaticMarkup(h(HBars, { rows: [{ label: 'Known', value: 7 }, { label: 'Missing' }] }));
  assert.doesNotMatch(sparseBars, /NaN/);
  assert.match(sparseBars, /Not recorded/);
  assert.match(sparseBars, /width="518"/);
  f.show_up.recent = [];
  const missing = text(section(markup(reads(f)), 'events-block-showup'));
  assert.match(missing, /Per-event show-up could not be read.*ended-event rows were not returned/);
  assert.doesNotMatch(missing, /No event has ended/);
  f.weekly.weeks.forEach((r) => { delete r.to_date; });
  const chart = weeklyChart(f.weekly);
  assert.equal(chart.currentIndex, -1);
  const complete = renderToStaticMarkup(h(WeekLines, { ...chart, currentIndex: chart.currentIndex }));
  assert.doesNotMatch(complete, /r="4.5"/);
  assert.doesNotMatch(renderToStaticMarkup(h(ChartTable, { chart, caption: 'Completed weeks' })), /so far/);
  assert.match(text(section(markup(reads(f)), 'events-block-weekly')), /These weeks are complete/);
});
