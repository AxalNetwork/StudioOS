/**
 * D1121 (#3001, part of #2367) — the consoles open the one item a Community
 * lightbox row names: CM4's row opens `/admin/jobs?posting=<id>`, that one
 * posting across every status; CM5's opens `/admin/circles?circle=<id>`, that
 * circle's editor. Mounted on a stubbed `fetch`; every posting and circle is
 * made up.
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
