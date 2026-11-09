/**
 * D4820 (#4820) part 6 — the overview's participation insight (CM01, CM03):
 * total registrations, applications and bookings against the weeks before,
 * withheld (and saying why) when a series could not be read; and the Recent
 * activity card's chips carrying the read's own counts (`by_kind`). Every
 * record is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_insight_4820.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { at, full } from './_community_overview_fixture.mjs';
import { COMMUNITY_PATH, buildActivity, participationInsight } from '../src/pages/admin/community/communityModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';

const h = React.createElement;
const ok = (data) => ({ status: 'ready', data });
const UNREAD = { available: false, unreadable: true, reason: 'This could not be read on this database. That is not the same as none.' };
const t = (window, previous) => ({ noun: 'x', window, previous });

// ---------------------------------------------------------------- the model

test('D4820 part 6: total participation against the weeks before, in one sentence', () => {
  // Mutation checked: the share from one series alone → 50% here and this fails.
  assert.deepEqual(participationInsight([t(60, 40), t(12, 10), t(7, 2)], [], 4), {
    kind: 'up', text: 'Participation increased 52% compared with the 4 weeks before: 79 against 52, this week so far.',
  });
  assert.equal(participationInsight([t(30, 40), t(10, 10)], [], 12).kind, 'down');
  assert.match(participationInsight([t(30, 40), t(10, 10)], [], 12).text, /^Participation decreased 20% compared with the 12 weeks before/);
  assert.equal(participationInsight([t(10, 10)], [], 4).kind, 'same');
});

test('D4820 part 6: no percentage from a zero, and none when nothing was recorded', () => {
  // Mutation checked: dividing by a zero period before → "Infinity%" and this fails.
  assert.deepEqual(participationInsight([t(5, 0), t(2, 0)], [], 4), { kind: 'new', text: '7 registrations, applications and bookings in these 4 weeks; none in the 4 weeks before.' });
  assert.equal(participationInsight([t(0, 0)], [], 4).kind, 'none');
  assert.equal(participationInsight([], [], 4), null);
});

test('D4820 part 6 (CM03): a series that could not be read withholds the total, and says why', () => {
  const i = participationInsight([t(60, 40)], ['Job applications'], 4);
  // Mutation checked: summing the series that were read anyway → an "increased" sentence and this fails.
  assert.deepEqual(i, { kind: 'withheld', text: 'Total participation isn’t shown: job applications couldn’t be read, and leaving it out would understate it.' });
  const a = buildActivity({ overview: ok({ ...full(), blocks: { ...full().blocks, jobs: UNREAD } }) });
  assert.equal(a.insight.kind, 'withheld');
  assert.equal(buildActivity({ overview: ok(full()) }).insight.kind, 'up');
});

// ---------------------------------------------------------------- mounted

async function mount(answer, activity) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const seen = [];
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname + u.search);
    if (u.pathname === '/api/admin/community/overview') return json(answer);
    if (u.pathname === '/api/admin/community/activity') return json(activity(u.searchParams));
    return json({});
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [`${COMMUNITY_PATH}?weeks=4`] }, h(AdminCommunity))); });
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen,
    has: (id) => Boolean(byTestId(id)),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    async click(id) { await act(async () => { props(byTestId(id)).onClick({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

const ROW = { kind: 'events', actor: 'admin', icon: '◆', sentence: 'An admin published “Demo Night”.', title: 'Demo Night', href: '/admin/events', at: at(-1) };
const activity = (p) => (p.get('kind')
  ? { rows: [ROW], total: 1, limit: 10, offset: 0, unreadable: [] }
  : { rows: [ROW], total: 9, limit: 10, offset: 0, unreadable: [], by_kind: { events: 5, jobs: 3, circles: 1, wellbeing: 0 } });

test('mounted D4820 part 6: the Activity card leads with the insight, then the biggest change', async () => {
  const m = await mount(full(), activity);
  try {
    assert.match(m.of('community-activity-insight'), /^Participation increased 52% compared with the 4 weeks before/);
    assert.match(m.of('community-activity-sentence'), /Event registrations moved most/);
  } finally { await m.unmount(); }
});

test('mounted D4820 part 6: the Recent activity chips carry the read\'s counts, kept when a kind is chosen', async () => {
  const m = await mount(full(), activity);
  try {
    assert.equal(m.of('community-recent-chip-all-count'), '9');
    assert.equal(m.of('community-recent-chip-jobs-count'), '3');
    assert.equal(m.of('community-recent-chip-wellbeing-count'), '0');
    assert.ok(!m.has('community-recent-chip-admin-count'), 'Admin actions is not counted');
    await m.click('community-recent-chip-jobs');
    assert.match(m.seen.at(-1), /kind=jobs/);
    // Mutation checked: counts read off each answer (the jobs answer has no by_kind) → they vanish and this fails.
    assert.equal(m.of('community-recent-chip-events-count'), '5');
  } finally { await m.unmount(); }
});
