/**
 * D4814 (#4814) — Admin › Approvals v2, part 4: Lanes as an operations map
 * (AP-06) and Decided as an audit trail (AP-07).
 *
 * Lanes: Lane · Waiting · Oldest · Notifies / owner · Reviewed in, each
 * group's total ("N+" when a lane in it was not read), each lane's overdue
 * count from the inbox's band split, native boards tagged, the banner when a
 * lane could not be read, HQ decides as a locked line for an Admin, and the
 * places that are not approval queues collapsed at the bottom.
 * Decided: Lane, Outcome, Decided by and a date range, Include HQ lanes (a
 * Super Admin's), the note shown or internal, a wait not recorded as a dash,
 * Open ↗, and About this history after the log.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_v2_4814_part4.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  NATIVE_BOARDS, aboutHistory, decidedFilterCount, decidedHq, laneGroups, laneOverdue, lanesBanner, noteKind,
} from '../src/pages/admin/approvals/lanesDecidedModel.js';
import { decidedQueryOf, decidedRows } from '../src/pages/admin/approvals/inboxModel.js';
import { ApprovalsPage } from '../src/pages/admin/approvals/AdminApprovals.jsx';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ADMIN = { id: 7, role: 'admin', is_super_admin: 0 };
const SUPER = { id: 7, role: 'admin', is_super_admin: 1 };

const ZERO = ['kyb', 'partner_profiles', 'exploring', 'product_testers', 'cohort', 'lab_hosts', 'moderation', 'referrals', 'strategic_access', 'perk_listings',
  'best_fit', 'events', 'jobs', 'wellbeing_experts', 'comarketing', 'articles', 'due_diligence', 'score_flags'];
const GLANCE = (over = {}) => ({
  tier: 'hq',
  approvals: {
    pending_total: 26,
    lanes: [
      { key: 'kyc', label: 'KYC', count: 20, oldest_age_hours: 100, sla: 'past', notifies: 'The member, by email' },
      { key: 'lp', label: 'LP applications', count: 6, oldest_age_hours: 30, sla: 'due_soon' },
      ...ZERO.map((key) => ({ key, label: key, count: 0, oldest_age_hours: null, sla: 'ok' })),
      ...(over.lanes || []),
    ].map((l) => (over.fail === l.key ? { ...l, count: null, reason: 'Did not answer.' } : l)),
    hq_decides: { lanes: [{ key: 'payouts', count: 1, oldest_age_hours: 5 }], pending_total: 1, unreadable: [] },
    no_queue: [],
  },
});
const INBOX = {
  items: [], total: 26, page: 1, page_size: 25, unreadable: [],
  lanes: [
    { key: 'kyc', label: 'KYC', group: 'people', count: 20, bands: { ok: 0, due_soon: 12, past: 8, unknown: 0 } },
    { key: 'lp', label: 'LP applications', group: 'programs', count: 6, bands: null, bands_reason: 'Capped.' },
  ],
  tiles: {}, reviewers: [],
};
const ROWS = [
  { lane: 'kyc', lane_label: 'KYC', item_id: 40, who: 'Person D', outcome: 'approved', outcome_word: 'Approved', decided_at: '2026-10-25 14:00:00', decided_by: { id: 8, name: 'Admin B' }, wait_hours: 33, note: 'Welcome aboard', note_shown: true },
  { lane: 'lp', lane_label: 'LP applications', item_id: 2, who: 'Person E', outcome: 'declined', outcome_word: 'Declined', decided_at: '2026-10-24 10:00:00', decided_by: { id: 7, name: 'Admin A' }, wait_hours: 20, note: 'Not accredited yet.', note_shown: false },
  { lane: 'perk_listings', lane_label: 'Perk listings', item_id: 3, who: 'Perk F', outcome: 'approved', outcome_word: 'Approved', decided_at: '2026-10-23 10:00:00', decided_by: { id: 7, name: 'Admin A' }, wait_hours: null, note: null, note_shown: false },
];
const DECIDED = { items: ROWS, total: 3, page: 1, page_size: 25, unreadable: [], deciders: [{ id: 7, name: 'Admin A' }, { id: 8, name: 'Admin B' }],
  lanes: [{ key: 'partner_profiles', label: 'Partner profiles', recorded: true, since: '2026-10-25' }, { key: 'jobs', label: 'Jobs', recorded: false, reason: 'Jobs keeps no decision time.' }] };

async function mount(url, viewer, over = {}) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u) => {
    const x = new URL(String(u), 'http://x');
    seen.push(`${x.pathname}${x.search}`);
    if (x.pathname === '/api/admin/studio/glance') return json(over.glance || GLANCE());
    if (x.pathname === '/api/admin/approvals') return json(INBOX);
    if (x.pathname === '/api/admin/approvals/decided') return over.decided ? over.decided(x.searchParams) : json(DECIDED);
    if (x.pathname === '/api/admin/approvals/decided/weekly') return json({ weeks: [], totals: {}, tile: null, unreadable: [] });
    return json({});
  };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: h(ApprovalsPage, { viewer }) })), h(Probe))); });
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent || '' : n?.childNodes?.length ? n.childNodes.map(textOf).join('') : n?.textContent || '');
  const props = (n) => (n ? Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {} : {});
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, key: '', preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    seen, at,
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    node: byId,
    props: (id) => props(byId(id)),
    ids: (prefix) => walk(container).map((n) => props(n)['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    within: (id, tag) => walk(byId(id)).filter((n) => n.tagName === tag).map(props),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value, checked = true) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked } }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

// ---------------------------------------------------------------- the model

test('Lanes: overdue from the inbox\'s band split; a group short by an unread lane is "N+"; the banner names the lane', () => {
  assert.equal(laneOverdue(INBOX, 'kyc'), 8);
  assert.equal(laneOverdue(INBOX, 'lp'), null, 'a capped lane was not split: no figure, never 0');
  assert.equal(laneOverdue(null, 'kyc'), null);
  const views = [
    { key: 'kyc', group: 'people', label: 'KYC', state: 'ready', count: 20 },
    { key: 'kyb', group: 'people', label: 'KYB', state: 'unreadable', count: null },
    { key: 'lp', group: 'programs', label: 'LP applications', state: 'ready', count: 6 },
  ];
  const groups = laneGroups(views, INBOX);
  const people = groups.find((g) => g.key === 'people');
  assert.deepEqual([people.waiting, people.lanes], ['20+ waiting', '2 lanes']);
  assert.equal(groups.find((g) => g.key === 'programs').waiting, '6 waiting');
  assert.equal(people.rows[0].overdue, 8);
  assert.deepEqual(lanesBanner(views), { text: '26+ waiting · 1 lane could not be read.', names: 'KYB didn’t respond; every other lane is measured.' });
  assert.equal(lanesBanner(views.filter((v) => v.state === 'ready')), null);
  assert.deepEqual([...NATIVE_BOARDS].sort(), ['comarketing', 'product_testers', 'wellbeing_experts']);
});

test('Decided: hq=0 only for a Super Admin; a note is shown, internal or none; a wait not recorded is not 0', () => {
  assert.equal(decidedHq('?hq=0', true), '0');
  assert.equal(decidedHq('?hq=0', false), null, 'a plain Admin never sends hq');
  assert.equal(decidedQueryOf('?hq=0').hq, '0');
  assert.equal(decidedQueryOf('?hq=1').hq, undefined, 'on is the default, never sent');
  const rows = decidedRows(DECIDED);
  assert.deepEqual(rows.map(noteKind), ['shown', 'internal', 'none']);
  assert.deepEqual(rows.map((r) => r.waitKnown), [true, true, false]);
  assert.equal(decidedFilterCount({ page: 2, lane: 'kyc', hq: '0' }), 2);
  const about = aboutHistory({ since: ['Partner profiles: decisions were not recorded before 25 Oct 2026.'], notRecorded: [{ label: 'Jobs', reason: 'Jobs keeps no decision time.' }], caveats: [] });
  assert.equal(about[0], 'Partner profiles: decisions were not recorded before 25 Oct 2026.');
  assert.equal(about[1], 'Jobs does not record its decisions: Jobs keeps no decision time.');
  assert.match(about.at(-2), /dash.*not a wait of zero/);
});

// ---------------------------------------------------------------- mounted

test('mounted AP-06: the map — columns, group totals, overdue, Approvals board, Reviewed in →, HQ locked for an Admin, Not approval queues collapsed', async () => {
  const v = await mount('/admin/approvals/lanes', ADMIN);
  try {
    assert.ok(v.seen.includes('/api/admin/approvals?page=1'), 'Lanes reads the inbox, unfiltered, for the band split');
    const heads = v.within('approvals-lanes-people', 'TH').map((p) => p.children);
    assert.deepEqual(heads, ['Lane', 'Waiting', 'Oldest', 'Notifies / owner', 'Reviewed in']);
    assert.match(v.of('approvals-lanes-people-count'), /^26 waiting · \d+ lanes$/, 'KYC 20 and LP applications 6');
    assert.match(v.of('approvals-lane-kyc'), /KYC\s*20 waiting\s*8 overdue\s*oldest 4 d 4 h\s*The member, by email\s*KYC & KYB →/);
    assert.ok(!v.has('approvals-lane-overdue-lp'), 'a lane with no band split draws no overdue pill');
    assert.equal(v.of('approvals-lane-native-product_testers'), 'Approvals board');
    assert.ok(!v.has('approvals-lane-native-kyc'));
    assert.match(v.of('approvals-hq-locked'), /HQ decides — Super Admin only.*You are signed in as Admin\./s);
    assert.ok(!v.has('approvals-hq-lanes'));
    assert.equal(v.node('approvals-not-a-queue').tagName, 'DETAILS', 'collapsed until opened');
    assert.ok(!v.props('approvals-not-a-queue').open);
    assert.match(v.of('approvals-not-a-queue'), /Not approval queues · 5/);
    assert.ok(!v.has('approvals-lanes-banner'), 'every lane answered');
    const order = v.ids('approvals-');
    assert.ok(order.indexOf('approvals-hq-locked') < order.indexOf('approvals-not-a-queue'), 'Not approval queues is at the bottom');
  } finally { await v.unmount(); }
});

test('mounted AP-06: one lane unread — the banner with N+, its row says so with Try again, every other lane stays measured', async () => {
  const v = await mount('/admin/approvals/lanes', ADMIN, { glance: GLANCE({ fail: 'lp' }) });
  try {
    assert.match(v.of('approvals-lanes-banner'), /20\+ waiting · 1 lane could not be read\.\s*LP applications didn’t respond; every other lane is measured\.\s*Try again/);
    assert.match(v.of('approvals-lane-lp'), /LP applications\s*Could not be read\s*Try again\s*— not read/);
    assert.match(v.of('approvals-lanes-people-count'), /^20\+ waiting/, 'short by the unread lane: N+, never N');
    assert.match(v.of('approvals-lanes-programs-count'), /^0 waiting/, 'a group whose lanes all answered is exact');
    assert.match(v.of('approvals-lane-kyc'), /20 waiting/);
  } finally { await v.unmount(); }
});

test('mounted AP-06: a Super Admin sees HQ decides with the same columns', async () => {
  const v = await mount('/admin/approvals/lanes', SUPER);
  try {
    assert.match(v.of('approvals-hq-lanes'), /HQ decides — Super Admin only/);
    assert.match(v.of('approvals-hq-payouts'), /Payout requests\s*1 waiting\s*oldest 5 h.*Commissions/);
    assert.ok(!v.has('approvals-hq-locked'));
  } finally { await v.unmount(); }
});

test('mounted AP-07: Decided — the columns, shown or internal, a dash for a wait not recorded, Open ↗, About this history after the log', async () => {
  const v = await mount('/admin/approvals/decided', SUPER);
  try {
    const heads = v.within('approvals-decided', 'TH').map((p) => (typeof p.children === 'string' ? p.children : 'Open'));
    assert.deepEqual(heads, ['Decided ↓', 'Request', 'Outcome', 'Decided by', 'Wait', 'Note', 'Open']);
    assert.match(v.of('approvals-decided-kyc:40:2026-10-25 14:00:00'), /Person D\s*KYC\s*Approved\s*Admin B\s*1 d 9 h\s*Welcome aboard\s*👁 Shown to them\s*Open in KYC & KYB ↗/);
    assert.match(v.of('approvals-decided-note-lp:2:2026-10-24 10:00:00'), /Not accredited yet\.\s*🔒 Internal note/);
    assert.equal(v.of('approvals-decided-note-perk_listings:3:2026-10-23 10:00:00'), 'No note');
    assert.equal(v.of('approvals-decided-wait-perk_listings:3:2026-10-23 10:00:00'), '—');
    assert.match(v.props('approvals-decided-wait-perk_listings:3:2026-10-23 10:00:00').title, /not known/);
    const order = v.ids('approvals-decided');
    assert.ok(order.indexOf('approvals-decided-count') < order.indexOf('approvals-decided-about'), 'About this history comes after the log');
    assert.match(v.of('approvals-decided-about'), /Partner profiles: decisions were not recorded before 25 Oct 2026\..*Jobs does not record its decisions/s);
  } finally { await v.unmount(); }
});

test('mounted AP-07: Decided by from the Worker\'s deciders; Include HQ lanes off is hq=0 for a Super Admin, disabled and never sent for an Admin', async () => {
  const v = await mount('/admin/approvals/decided', SUPER);
  try {
    assert.deepEqual(v.within('approvals-decided-by', 'OPTION').map((p) => p.children), ['Anyone', 'Admin A', 'Admin B']);
    await v.change('approvals-decided-by', '8');
    assert.match(v.at.path, /decided_by=8/);
    assert.ok(v.seen.some((p) => p.startsWith('/api/admin/approvals/decided?') && p.includes('decided_by=8')));
    assert.equal(v.props('approvals-decided-hq').checked, true, 'HQ lanes are in by default');
    await v.change('approvals-decided-hq', '', false);
    assert.match(v.at.path, /hq=0/);
    assert.ok(v.seen.some((p) => p.startsWith('/api/admin/approvals/decided?') && p.includes('hq=0')));
  } finally { await v.unmount(); }
  const a = await mount('/admin/approvals/decided?hq=0', ADMIN);
  try {
    assert.equal(a.props('approvals-decided-hq').disabled, true);
    assert.ok(!a.seen.some((p) => p.includes('hq=0')), 'a plain Admin never sends hq');
  } finally { await a.unmount(); }
});

test('mounted AP-18g: no matches — "No recorded decisions match these filters." with Clear filters; no About section', async () => {
  const v = await mount('/admin/approvals/decided?outcome=declined', SUPER, { decided: () => json({ ...DECIDED, items: [], total: 0 }) });
  try {
    assert.match(v.of('approvals-decided-empty'), /No recorded decisions match these filters\.\s*Clear filters/);
    assert.ok(!v.has('approvals-decided-about'));
    await v.click('approvals-decided-clear');
    assert.equal(v.at.path, '/admin/approvals/decided');
  } finally { await v.unmount(); }
});
