/**
 * D1121 (#3001, part of #2367) — the consoles open the one item a Community
 * lightbox row names: CM4's row opens `/admin/jobs?posting=<id>`, that one
 * posting across every status; CM5's opens `/admin/circles?circle=<id>`, that
 * circle's editor. Mounted on a stubbed `fetch`; every posting and circle is
 * made up. Also the days a posting has been open, from `published_at`
 * (migration 609): the Jobs card's "[d] days open", CM4's Posted and Days open.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_gaps_d1121.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AdminJobsPage from '../src/pages/admin/AdminJobsPage.jsx';
import AdminCirclesPage from '../src/pages/admin/AdminCirclesPage.jsx';
import { buildJobs, daysOpenText, jobDaysOpen } from '../src/pages/admin/community/communityModel.js';
import { JOBS as JOBS_SPEC, JOBS_FOOT, initialState, jobRow, listView } from '../src/pages/admin/community/lightboxModel.js';

const h = React.createElement;
const JOBS = [
  { id: 11, title: 'Backend Engineer', status: 'published', employment_type: 'full_time', application_count: 4 },
  { id: 12, title: 'Head of Growth', status: 'pending_review', employment_type: 'full_time', application_count: 0 },
  { id: 13, title: 'Old Role', status: 'closed', employment_type: 'contract', application_count: 1 },
];
const CIRCLES = [
  { id: 1, name: 'Founder Circle', type: 'founder', access: 'open', activity: 'active', members: 10, published: true, tags: [] },
  { id: 2, name: 'City Circle', type: 'city', access: 'open', activity: 'active', members: 3, published: false, tags: [] },
];

async function mount(page, url) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u) => {
    const x = new URL(String(u), 'http://x');
    seen.push(x.pathname + x.search);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const one = x.pathname.match(/^\/api\/admin\/jobs\/(\d+)$/);
    if (one) {
      const job = JOBS.find((j) => j.id === Number(one[1]));
      return job ? json({ job }) : new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (x.pathname === '/api/admin/jobs') {
      const st = x.searchParams.get('status');
      return json({ jobs: JOBS.filter((j) => !st || j.status === st) });
    }
    if (x.pathname === '/api/admin/circles') return json({ circles: CIRCLES });
    return json({});
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(page))); });
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  return {
    seen,
    text: () => textOf(container),
    has: (id) => walk(container).some((n) => props(n)?.['data-testid'] === id),
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('CM4\'s row opens that one posting on the job board, whatever its status', async () => {
  // Mutation checked: the param ignored → the board opens on In review with Head of Growth; the list read instead of the one posting → the route check fails.
  const m = await mount(AdminJobsPage, '/admin/jobs?posting=11');
  try {
    assert.ok(m.seen.includes('/api/admin/jobs/11'), 'the posting was not read by its own route');
    assert.ok(!m.seen.some((s) => s.startsWith('/api/admin/jobs?')), 'a list page was read, which could stop before the posting');
    assert.match(m.text(), /Backend Engineer/);
    assert.doesNotMatch(m.text(), /Head of Growth|Old Role/, 'the other roles are listed');
    assert.ok(m.has('admin-jobs-one'));
    assert.match(m.text(), /One role, opened from Community\.\s*Show every role/);
  } finally { await m.unmount(); }
  const missing = await mount(AdminJobsPage, '/admin/jobs?posting=99');
  try {
    assert.match(missing.text(), /That role is not on the job board\./);
  } finally { await missing.unmount(); }
  const plain = await mount(AdminJobsPage, '/admin/jobs');
  try {
    assert.ok(plain.seen.includes('/api/admin/jobs?status=pending_review&limit=50&offset=0'), 'the board no longer opens on In review');
    assert.ok(!plain.has('admin-jobs-one'));
  } finally { await plain.unmount(); }
});

test('CM5\'s row opens that circle\'s editor; nothing is saved until the admin does', async () => {
  // Mutation checked: the param ignored → no editor opens; the wrong row picked → the editor names the other circle.
  const m = await mount(AdminCirclesPage, '/admin/circles?circle=2');
  try {
    assert.match(m.text(), /Edit — City Circle/);
    assert.doesNotMatch(m.text(), /Edit — Founder Circle/);
    assert.ok(!m.seen.some((s) => /\/api\/admin\/circles\/\d+/.test(s)), 'opening the editor wrote something');
  } finally { await m.unmount(); }
  const plain = await mount(AdminCirclesPage, '/admin/circles');
  try {
    assert.doesNotMatch(plain.text(), /Edit — /, 'an editor opens with no circle asked for');
  } finally { await plain.unmount(); }
});

// Wednesday 21 October 2026, noon UTC.
const NOW = Date.parse('2026-10-21T12:00:00Z');
const POSTINGS = [
  { id: 1, title: 'Ten days', status: 'published', published_at: '2026-10-11 07:00:00', application_count: 3, created_at: '2026-01-01 09:00:00' },
  { id: 2, title: 'One day', status: 'published', published_at: '2026-10-20 11:00:00', application_count: 5, created_at: '2026-01-02 09:00:00' },
  { id: 3, title: 'Before 609', status: 'published', published_at: null, application_count: 4, created_at: '2026-01-03 09:00:00' },
  { id: 4, title: 'Closed since', status: 'closed', published_at: '2026-09-01 10:00:00', application_count: 1, created_at: '2026-01-04 09:00:00' },
  { id: 5, title: 'Closed before 609', status: 'closed', published_at: null, application_count: 0, created_at: '2026-01-05 09:00:00' },
  { id: 6, title: 'A draft', status: 'draft', published_at: null, application_count: 0, created_at: '2026-01-06 09:00:00' },
];
const byTitle = (t) => POSTINGS.find((p) => p.title === t);

test('days open: only a published posting is open, counted in whole days from its last approval; before 609 is not recorded, never 0', () => {
  // Mutation checked: the status check removed → a closed posting has days open;
  // a missing day read as 0 → "0 days open"; Math.ceil for floor → 11; "1 days" for one.
  assert.equal(jobDaysOpen(byTitle('Ten days'), NOW), 10);
  assert.equal(jobDaysOpen(byTitle('One day'), NOW), 1);
  assert.ok(Number.isNaN(jobDaysOpen(byTitle('Before 609'), NOW)));
  assert.equal(jobDaysOpen(byTitle('Closed since'), NOW), null, 'a closed posting is not open');
  assert.equal(jobDaysOpen(byTitle('A draft'), NOW), null);
  assert.equal(daysOpenText(byTitle('Ten days'), NOW), '10 days open');
  assert.equal(daysOpenText(byTitle('One day'), NOW), '1 day open');
  assert.equal(daysOpenText(byTitle('Before 609'), NOW), 'Days open not recorded');
  assert.equal(daysOpenText(byTitle('Closed since'), NOW), null);

  // The Jobs card's most-applications rows carry it.
  const card = buildJobs({ jobs: { status: 'ready', data: POSTINGS } }, NOW);
  assert.deepEqual(card.most.map((j) => [j.title, j.daysOpen]), [
    ['One day', '1 day open'], ['Before 609', 'Days open not recorded'], ['Ten days', '10 days open'], ['Closed since', null],
  ]);
});

test('CM4: Posted and Days open, the Days open sort, and the footnote', () => {
  // Mutation checked: Posted read from created_at → "1 Jan"; a closed posting before 609 as "Not published";
  // the sort's not-recorded rows first; the old footnote back.
  const row = (t) => jobRow(byTitle(t), NOW);
  assert.deepEqual([row('Ten days').posted, row('Ten days').daysOpen], ['11 Oct', '10']);
  assert.deepEqual([row('Before 609').posted, row('Before 609').daysOpen], ['Not recorded', 'Not recorded']);
  assert.deepEqual([row('Closed since').posted, row('Closed since').daysOpen], ['1 Sept', 'Not open']);
  assert.deepEqual([row('Closed before 609').posted, row('Closed before 609').daysOpen], ['Not recorded', 'Not open'], 'it was live once, so not "Not published"');
  assert.deepEqual([row('A draft').posted, row('A draft').daysOpen], ['Not published', 'Not open']);
  const sorted = listView(JOBS_SPEC, POSTINGS, { ...initialState(JOBS_SPEC), sort: 'days_open' }).rows.map((j) => j.title);
  assert.deepEqual(sorted.slice(0, 2), ['Ten days', 'One day'], 'longest open first');
  assert.deepEqual(new Set(sorted.slice(2)), new Set(['Before 609', 'Closed since', 'Closed before 609', 'A draft']), 'not open or not recorded sorts last');
  assert.doesNotMatch(JOBS_FOOT, /not shown/);
  assert.match(JOBS_FOOT, /last approved/);
});
