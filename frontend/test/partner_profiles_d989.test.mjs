/**
 * D989 (#2380) — Partner profiles at /admin/partner-profiles: the owner's
 * canvas (PRF1–PRF12) integrated under D936's header, out of the Admin
 * Console. To review and All profiles draw what the list read and Approvals'
 * lane carry; the review is today's dialog until part 6.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_profiles_d989.test.mjs
 */
import test from 'node:test';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  MOVED_NOTICES, categoryBars, pageOf, queueRows, rowView, searchRows, statusCounts, tabOf,
} from '../src/pages/admin/profiles/ppModel.js';
import PartnerProfiles from '../src/pages/admin/profiles/PartnerProfiles.jsx';
import { legacyContractsTarget } from '../src/pages/admin/LegacyContractsRedirect.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// Newest first, as the list read answers (ORDER BY created_at DESC).
const ROWS = [
  { email: 'eva@example.com', user_name: 'Eva Demo', persona: 'Legal Counsel', admin_status: 'pending' },
  { email: 'dev@example.com', user_name: 'Dev Testcase', persona: 'Operating Partner', legal_entity_name: 'Placeholder Labs Ltd', admin_status: 'pending' },
  { email: 'finn@example.com', user_name: 'Finn Mock', persona: 'Founder', founder_track: 'Strategic Scale (Existing)', company_established: 1, admin_status: 'verified', agreement_type: 'Strategic Scale Partnership Agreement' },
  { email: 'chloe@example.com', user_name: 'Chloé Placeholder', persona: 'Investor — LP', legal_entity_name: 'Example Holdings LLC', admin_status: 'rejected' },
  { email: 'draft@example.com', user_name: null, persona: null, admin_status: 'pending' },
  { email: 'ada@example.com', user_name: 'Ada Example', persona: 'Founder', founder_track: 'Spin-Out (New)', company_established: 0, admin_status: 'pending' },
  { email: 'odd@example.com', user_name: 'Odd Row', persona: 'Founder', admin_status: 'archived' },
];

// ---------------------------------------------------------------- the model

test('the addresses, the tabs and the moved notice', () => {
  assert.equal(tabOf('/admin/partner-profiles'), 'review');
  assert.equal(tabOf('/admin/partner-profiles/all/'), 'all');
  assert.equal(tabOf('/admin/partner-profiles/pp_7f3a21'), null, 'one profile\'s address waits for a reference');
  assert.equal(legacyContractsTarget('?tab=profiles'), '/admin/partner-profiles?moved=profiles');
  assert.equal(MOVED_NOTICES.profiles, 'The Admin Console has moved: Partner profiles now lives under Approvals.');
});

test('the queue is the waiting profiles, oldest first (the list read is newest first)', () => {
  assert.deepEqual(queueRows(ROWS).map((r) => r.email), ['ada@example.com', 'draft@example.com', 'dev@example.com', 'eva@example.com']);
  assert.deepEqual(statusCounts(ROWS), { all: 7, pending: 4, verified: 1, rejected: 1, other: 1 });
});

test('a row in the canvas\'s words: founder track and company, "Not given", and an unknown status is not drawn as a known one', () => {
  const ada = rowView(ROWS[5]);
  assert.deepEqual([ada.track, ada.incorporated, ada.entity, ada.agreement, ada.status], ['Spin-Out', 'Not incorporated', 'Not given', 'Not sent', 'Waiting']);
  const finn = rowView(ROWS[2]);
  assert.deepEqual([finn.track, finn.incorporated, finn.status], ['Strategic Scale', 'Incorporated', 'Verified']);
  assert.equal(rowView(ROWS[6]).track, 'Track not given');
  assert.equal(rowView(ROWS[6]).incorporated, 'Not answered');
  assert.deepEqual([rowView(ROWS[6]).status, rowView(ROWS[6]).statusKey], ['Not recorded', 'other']);
  assert.equal(rowView(ROWS[1]).track, null, 'a track pill on a non-founder');
});

test('onboarding categories: by count, Founder split by track, no category a line and never a bar', () => {
  const { bars, none, max } = categoryBars(ROWS);
  assert.equal(bars[0].category, 'Founder');
  assert.deepEqual([bars[0].count, bars[0].spinout, bars[0].scale, bars[0].untracked], [3, 1, 1, 1]);
  assert.equal(none, 1);
  assert.equal(max, 3);
  assert.ok(!bars.some((b) => !b.category));
});

test('search needs two characters and reads name, email and entity; pages say "1–25 of n"', () => {
  assert.equal(searchRows(ROWS, 'z').length, ROWS.length, 'one character filtered');
  assert.deepEqual(searchRows(ROWS, 'placeholder').map((r) => r.email), ['dev@example.com', 'chloe@example.com']);
  const many = Array.from({ length: 64 }, (_, i) => ({ email: `p${i}@example.com` }));
  assert.equal(pageOf(many, 1).label, '1–25 of 64');
  assert.equal(pageOf(many, 3).label, '51–64 of 64');
  assert.equal(pageOf(many, 9).page, 3);
  assert.equal(pageOf([], 1).label, '0 of 0');
});

// ---------------------------------------------------------------- the page, mounted

async function render(url) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] },
      h(Routes, null,
        h(Route, { path: '/admin/partner-profiles', element: h(PartnerProfiles) }),
        h(Route, { path: '/admin/partner-profiles/all', element: h(PartnerProfiles) }))));
  });
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const allByTestId = (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id);
  return {
    text: () => textOf(container),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    all: (id) => allByTestId(id).map(textOf),
    h1s: () => walk(container).filter((n) => n.tagName === 'H1').length,
    async click(label) {
      const b = walk(container).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
      assert.ok(b, `no button ${label}`);
      await act(async () => { props(b).onClick({ preventDefault() {}, stopPropagation() {} }); });
      for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const GLANCE = { tier: 'hq', approvals: { pending_total: 4, lanes: [{ key: 'partner_profiles', label: 'Partner profiles', count: 4, oldest_age_hours: 96 }] } };

function stub({ list = () => json(ROWS), glance = () => json(GLANCE), record = () => json({ email: 'ada@example.com', user_name: 'Ada Example', chat_history: '[]' }) } = {}) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname);
    if (u.pathname === '/api/profiling/admin/list') return list();
    if (u.pathname === '/api/admin/studio/glance') return glance();
    if (u.pathname.startsWith('/api/profiling/admin/')) return record();
    return json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

test('mounted, To review: one h1, the crumb, the tab counts, the queue oldest first, the waits, and only its reads', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles?moved=profiles');
  try {
    assert.equal(v.h1s(), 1);
    assert.match(v.of('pp-header'), /Approvals.*Partner profiles/s);
    assert.match(v.of('pp-header'), /The Admin Console has moved: Partner profiles now lives under Approvals\./);
    assert.match(v.of('pp-tab-review'), /To review\s*4/);
    assert.match(v.of('pp-tab-all'), /All profiles\s*7/);
    const queue = v.all('pp-queue-row');
    assert.equal(queue.length, 4);
    ['Ada Example', 'draft@example.com', 'Dev Testcase', 'Eva Demo'].forEach((who, i) => assert.ok(queue[i].startsWith(who), `${i}: ${queue[i]}`));
    assert.match(v.of('pp-tile-waiting'), /Waiting\s*4\s*oldest \S/, 'the Waiting tile is lane 7\'s figure');
    for (const id of ['past72', 'verified30', 'out']) assert.match(v.of(`pp-tile-${id}`), /Not read here yet/);
    assert.match(v.of('pp-drafts-note'), /Drafts are counted as waiting/);
    assert.deepEqual([...new Set(s.seen.filter((p) => !p.startsWith('/api/ai')))].sort(), ['/api/admin/studio/glance', '/api/profiling/admin/list']);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, All profiles: status chips over every profile, categories, and a status filter', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles/all');
  try {
    assert.match(v.of('pp-status-chips'), /All\s*7.*Waiting\s*4.*Verified\s*1.*Rejected\s*1/s);
    assert.match(v.of('pp-other-status'), /1 with a status the page does not know/);
    assert.match(v.of('pp-categories'), /Founder.*3/s);
    assert.match(v.of('pp-no-category'), /No category captured: 1/);
    assert.match(v.of('pp-wait-weekly'), /Not read here yet/);
    assert.equal(v.all('pp-all-row').length, 7);
    assert.match(v.of('pp-count'), /1–7 of 7/);
    await v.click('Rejected 1');
    assert.equal(v.all('pp-all-row').length, 1);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted: a failed list says so, never "nothing waiting"; an empty list says nothing waiting', async () => {
  let s = stub({ list: () => json({ detail: 'down' }, 503) });
  let v = await render('/admin/partner-profiles');
  try {
    assert.match(v.of('pp-list-failed'), /This is not a sign that there are none/);
    assert.ok(!v.has('pp-queue-empty'));
  } finally { await v.unmount(); s.restore(); }
  s = stub({ list: () => json([]) });
  v = await render('/admin/partner-profiles');
  try { assert.match(v.of('pp-queue-empty'), /Nothing waiting/); } finally { await v.unmount(); s.restore(); }
});

test('mounted: a failed record read is said in the page, not in a browser pop-up', async () => {
  const s = stub({ record: () => json({ detail: 'no' }, 500) });
  const original = globalThis.alert;
  let alerted = false;
  globalThis.alert = () => { alerted = true; };
  const v = await render('/admin/partner-profiles');
  try {
    await v.click('Review');
    assert.match(v.of('pp-record-failed'), /This profile could not be read\./);
    assert.equal(alerted, false);
  } finally { await v.unmount(); s.restore(); globalThis.alert = original; }
});

// ---------------------------------------------------------------- the source

test('the routes, the redirect, the console mount gone, the lane doors, and the rail frame outermost', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/partner-profiles" element={guard(['admin'], <PartnerProfiles />)} />`));
  assert.ok(app.includes(`<Route path="/admin/partner-profiles/all" element={guard(['admin'], <PartnerProfiles />)} />`));
  const admin = read('frontend/src/pages/admin/ConsolePages.jsx');
  assert.ok(!admin.includes('<PartnerProfilesConsole'), 'the console still mounts the tab');
  assert.ok(read('frontend/src/pages/admin/approvals/AdminApprovals.jsx').includes('<Link to="/admin/partner-profiles"'));
  assert.match(read('frontend/src/pages/admin/adminStudioOverview.js'), /partner_profiles: '\/admin\/partner-profiles'/);
  assert.ok(SIDEBAR_GROUPS.admin.flatMap((g) => g.items).find((r) => r.label === 'Approvals').match.includes('/admin/partner-profiles'));
  const page = read('frontend/src/pages/admin/profiles/PartnerProfiles.jsx');
  assert.match(page, /export default function PartnerProfiles\(\) \{\s*return \(\s*<AdminBoardFrame workspace="Entity profiles"/);
  assert.ok(!/\balert\(/.test(page), 'a browser pop-up on the page');
  assert.ok(!/\bpersona\b/i.test(page.replace(/r\.persona|\.persona/g, '')), 'the page says "persona"');
});
