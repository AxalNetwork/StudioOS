/**
 * D1007 (#2822, part 10 of #2378) — Persona segments on a phone (SEG14a–b):
 * the header's "‹ Accounts", tiles two by two, every chart with "View as
 * table", one card a row, needs and offers one line a segment, the Move
 * dialog as a full-screen sheet with its buttons at the foot, and every
 * control at least 44 by 44 px. The API is stubbed; every name and figure is
 * made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/persona_segments_phone_d1007.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PHONE_QUERY, needsLine, needsTable } from '../src/pages/admin/segments/segModel.js';
import { PersonaSegmentsPage } from '../src/pages/admin/segments/PersonaSegments.jsx';
import MoveDialog from '../src/pages/admin/segments/MoveDialog.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Twelve members (admins out): seven in a segment, five with none.
//   Founders 5 (Founder — New Venture 4, 1 none); Investors 7 (Angel / Scout 3, 4 none).
const SEG = {
  members: { available: true, total: 12, in_segment: 7, no_segment: 5, new_30d: 1, deactivated: 0, profile_differs: 1, not_in_taxonomy: 0 },
  segments: { available: true, rows: [{ id: 'founder_new', members: 4, new_30d: 1 }, { id: 'angel_scout', members: 3, new_30d: 0 }] },
  sub_accounts: { available: true, lp: { total: 0, by_segment: {}, no_segment: 0, definition: 'Accounts with an approved LP application.' },
    product_tester: { recorded: false, reason: 'Nothing on the database marks a product tester yet.' } },
  by_profile: { available: true, profiles: [
    { profile: 'founder', members: 5, no_segment: 1, segments: [{ id: 'founder_new', count: 4 }] },
    { profile: 'investor', members: 7, no_segment: 4, segments: [{ id: 'angel_scout', count: 3 }] },
  ], other: { members: 0, no_segment: 0, segments: [] } },
  how_set: { available: true, counts: { router: 4, self_select: 2, admin_retag: 1, not_recorded: 0 } },
  confidence: { available: true, over: 4, bands: [{ key: 'under_50', count: 1 }, { key: '50_69', count: 0 }, { key: '70_89', count: 2 }, { key: '90_up', count: 1 }], not_recorded: 0 },
  weekly: { available: true, weeks: ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']
    .map((d, i) => ({ week_start: d, count: [0, 1, 0, 2, 1, 1, 1, 1][i], ...(i === 7 ? { to_date: true } : {}) })), undated: 0 },
  moves_30d: { available: true, count: 2 },
};
const PROFILES = { segments: [
  { key: 'founder_new', name: 'Founder — New Venture', profile: 'founder', status: 'active', who: null },
  { key: 'angel_scout', name: 'Angel / Scout', profile: 'investor', status: 'active', who: null },
  { key: 'corporate_vc', name: 'Corporate VC', profile: 'investor', status: 'active', who: null },
] };
const off = (count) => ({ available: true, count });
// Founder — New Venture: needs met 1 of 2, a perk gap and a content gap (two kinds).
// Angel / Scout: needs not written; perks could not be read.
// Corporate VC: needs met 2 of 2, nothing missing.
const COVERAGE = { segments: [
  { key: 'founder_new', name: 'Founder — New Venture', profile: 'founder', status: 'active',
    needs: { recorded: true, total: 2, met: 1, gaps: [{ id: 'n2' }], items: [{ id: 'n1', text: 'A clear path to incorporation' }] },
    gap_kinds: ['perk', 'content'], offers: { programs: off(2), perks: off(0), events: off(1), content: off(0), sidebar_links: off(0) } },
  { key: 'angel_scout', name: 'Angel / Scout', profile: 'investor', status: 'active',
    needs: { recorded: false, reason: 'HQ has not written needs for this segment yet.' },
    gap_kinds: [], offers: { programs: off(1), perks: { available: false, reason: 'x' }, events: off(0), content: off(0), sidebar_links: off(2) } },
  { key: 'corporate_vc', name: 'Corporate VC', profile: 'investor', status: 'active',
    needs: { recorded: true, total: 2, met: 2, gaps: [], items: [] },
    gap_kinds: [], offers: { programs: off(1), perks: off(1), events: off(0), content: off(0), sidebar_links: off(0) } },
] };

function stub(routes = {}) {
  const original = globalThis.fetch;
  const writes = [];
  const base = {
    '/api/personas/admin/segments': () => json(SEG),
    '/api/personas/segments': () => json(PROFILES),
    '/api/personas/segments/coverage': () => json(COVERAGE),
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    if ((init.method || 'GET').toUpperCase() === 'POST') { writes.push({ path: u.pathname, body: JSON.parse(init.body) }); return json({ moved: [], skipped: [] }); }
    const r = routes[u.pathname] || base[u.pathname];
    return r ? r() : json({});
  };
  return { writes, restore() { globalThis.fetch = original; } };
}

/** Mounts at a phone width (every media query matches) or a desktop one (none does). */
async function render(element, { phone, url = '/admin/persona-segments' }) {
  const restore = installDocument();
  const queries = [];
  globalThis.matchMedia = (q) => { queries.push(q); return { matches: phone, media: q, addEventListener() {}, removeEventListener() {} }; };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '/admin/persona-segments/*', element }))));
  });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const all = (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id);
  const node = (id) => { const n = all(id)[0]; assert.ok(n, `no ${id}`); return n; };
  return {
    queries,
    has: (id) => all(id).length > 0,
    of: (id) => textOf(node(id)),
    texts: (id) => all(id).map(textOf),
    cls: (id) => String(props(node(id)).className || ''),
    // What a phone shows: a control under a class that hides it below sm (the desktop crumb) is not drawn there.
    controls: () => {
      const out = [];
      const hiddenOnPhone = (n) => /(?:^|\s)hidden(?:\s|$)/.test(String(props(n)?.className || ''));
      const go = (n) => {
        if (hiddenOnPhone(n)) return;
        if (['BUTTON', 'A', 'SELECT', 'INPUT'].includes(n.tagName)) out.push(n);
        (n.childNodes || []).forEach(go);
      };
      go(container);
      return out;
    },
    classOf: (n) => String(props(n)?.className || ''),
    textOf,
    async click(id) { await act(async () => props(node(id)).onClick()); await settle(); },
    async change(id, value) { await act(async () => props(node(id)).onChange({ target: { value } })); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); delete globalThis.matchMedia; },
  };
}

/** A control is 44px tall on a phone when its class sets it for every width, or for `max-sm:`. */
const TALL = /(?:^|\s)(?:max-sm:)?(?:min-h-\[44px\]|h-11)(?:\s|$)/;

// ── The model ─────────────────────────────────────────────────────────────────

test('needs and offers as one line a segment: needs met or Not recorded, the gap kinds counted, an unread kind said, never a 0', () => {
  // Mutations checked: the gaps counted from the needs rather than the offer kinds; an unread kind dropped; Not recorded read as met.
  const t = needsTable(COVERAGE);
  const lines = t.rows.map(needsLine);
  assert.deepEqual(lines.map((l) => l.text), [
    'Founder — New Venture · Needs met 1 of 2 · 2 gaps',
    'Angel / Scout · Needs: Not recorded · 1 kind could not be read',
    'Corporate VC · Needs met 2 of 2',
  ], 'gaps first (the table\'s order), then by name');
  assert.deepEqual(lines.map((l) => [l.gaps, l.unreadable]), [[2, 0], [0, 1], [0, 0]]);
  const one = needsLine({ key: 'k', name: 'One', needs: { recorded: true, text: '0 of 1' }, cells: [{ gap: true }, {}] });
  assert.equal(one.text, 'One · Needs met 0 of 1 · 1 gap');
  assert.equal(PHONE_QUERY, '(max-width: 639px)', 'the phone is below sm, as the admin header reads it');
});

// ── Mounted ───────────────────────────────────────────────────────────────────

test('mounted on a phone (SEG14a): "‹ Accounts", tiles two by two, needs and offers as lines, every chart with View as table', async () => {
  // Mutations checked: the lines drawn above sm; a chart's table showing other counts; the phone query widened.
  const s = stub();
  const v = await render(h(PersonaSegmentsPage, { superAdmin: false }), { phone: true });
  try {
    assert.match(v.of('admin-page-back'), /‹ Accounts/);
    assert.match(v.cls('seg-tiles'), /(?:^|\s)grid-cols-2(?:\s|$)/, 'two by two');
    assert.ok(v.queries.includes(PHONE_QUERY));

    assert.ok(!v.has('seg-needs-row'), 'no table on a phone');
    assert.deepEqual(v.texts('seg-needs-line').map((t) => t.replace(/\d+ gaps?$/, '').trim()), [
      'Founder — New Venture · Needs met 1 of 2 · 2 gaps',
      'Angel / Scout · Needs: Not recorded · 1 kind could not be read',
      'Corporate VC · Needs met 2 of 2',
    ]);

    // Segments by profile: 4 and 1 founders, 3 and 4 investors.
    await v.click('seg-by-profile-view');
    assert.match(v.of('seg-by-profile-table'), /Founders · Founder — New Venture4.*Founders · No segment1.*Investors · Angel \/ Scout3.*Investors · No segment4/s);
    assert.match(v.of('seg-by-profile-view'), /View as chart/);
    await v.click('seg-how-set-view');
    assert.match(v.of('seg-how-set-table'), /4.*2.*1/s);
    await v.click('seg-confidence-view');
    assert.match(v.of('seg-confidence-table'), /Under 50%1.*50 to 69%0.*70 to 89%2.*90% and over1/s);
    await v.click('seg-weekly-view');
    assert.ok(v.has('seg-weekly'));
    await v.click('seg-by-profile-view');
    assert.ok(!v.has('seg-by-profile-table'), 'back to the chart');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted above a phone: the needs and offers table stays, and no line is drawn', async () => {
  const s = stub();
  const v = await render(h(PersonaSegmentsPage, { superAdmin: false }), { phone: false });
  try {
    assert.equal(v.texts('seg-needs-row').length, 3);
    assert.ok(!v.has('seg-needs-lines'));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted on a phone: every button, link, select and field on Overview is at least 44px tall', async () => {
  // Mutations checked: the chips' max-sm height removed; Refresh left at 36px; a card's name link left at its text height.
  const s = stub();
  const v = await render(h(PersonaSegmentsPage, { superAdmin: true }), { phone: true });
  try {
    const own = v.controls().filter((n) => !v.textOf(n).includes('Eadwyn'));
    assert.ok(own.length > 20, `${own.length} controls`);
    const short = own.filter((n) => !TALL.test(v.classOf(n)) && !/(?:^|\s)h-11(?:\s|$)/.test(v.classOf(n)));
    assert.deepEqual(short.map((n) => `${n.tagName} ${v.textOf(n).slice(0, 30)} [${v.classOf(n).slice(0, 60)}]`), []);
    assert.match(v.cls('seg-refresh'), /max-sm:h-11 max-sm:w-11/);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted on a phone: one failed block still says so with its own Try again; the lines never stand in for an unread store', async () => {
  const s = stub({ '/api/personas/segments/coverage': () => json({ detail: 'down' }, 500) });
  const v = await render(h(PersonaSegmentsPage, { superAdmin: false }), { phone: true });
  try {
    assert.match(v.of('seg-failed-needs'), /Could not be read.*Try again/s);
    const retry = v.controls().filter((n) => v.textOf(n).trim() === 'Try again');
    assert.equal(retry.length, 1);
    assert.match(v.classOf(retry[0]), TALL, 'Try again is 44px tall on a phone');
    assert.ok(!v.has('seg-needs-lines'));
    assert.ok(v.has('seg-tiles') && v.has('seg-by-profile'), 'the rest of the page still draws');
  } finally { await v.unmount(); s.restore(); }
});

const MEMBER = { user_id: 7, name: 'Rowan Sample', profile: 'investor', segment: { key: 'angel_scout', name: 'Angel / Scout' }, howSet: 'router', confidence: 0.92 };

test('mounted on a phone (SEG14b): Move is a full-screen sheet with "‹ Members", Cancel and Move side by side at the foot, 44px, and nothing moves before Move', async () => {
  // Mutations checked: the sheet back to a bottom sheet; the shell's 36px close kept on a phone; the buttons' widths swapped.
  const s = stub();
  let closed = 0;
  const v = await render(h(MoveDialog, { members: [MEMBER], back: 'Members', onClose: () => { closed += 1; }, onMoved: () => {} }), { phone: true });
  try {
    assert.notEqual(v.cls('seg-move-dialog').includes('max-sm:h-full'), false, 'full screen on a phone');
    assert.ok(!v.has('seg-move-dialog-close'), 'no 36px close on a phone');
    assert.match(v.of('seg-move-dialog-phone-bar'), /‹ Members.*Move Rowan Sample/s);
    assert.match(v.cls('seg-move-dialog-back'), TALL);
    await v.change('seg-move-dialog-target', 'corporate_vc');
    assert.equal(s.writes.length, 0, 'choosing writes nothing');
    assert.match(v.cls('seg-move-dialog-buttons'), /^flex gap-2$/);
    assert.match(v.cls('seg-move-dialog-cancel'), /max-sm:min-h-\[44px\] flex-1$/);
    assert.match(v.cls('seg-move-dialog-go'), /max-sm:min-h-\[44px\] flex-\[1\.4\]$/);
    assert.match(v.cls('seg-move-dialog-target'), /max-sm:h-11/);
    await v.click('seg-move-dialog-back');
    assert.equal(closed, 1, '‹ Members closes the sheet');
    await v.click('seg-move-dialog-go');
    assert.deepEqual(s.writes.map((w) => [w.path, w.body.persona_id]), [['/api/personas/admin/members/move', 'corporate_vc']]);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted above a phone: Move keeps its titled header with the shell\'s close, and no phone bar', async () => {
  const s = stub();
  const v = await render(h(MoveDialog, { members: [MEMBER], onClose: () => {}, onMoved: () => {} }), { phone: false });
  try {
    assert.ok(v.has('seg-move-dialog-close'));
    assert.ok(!v.has('seg-move-dialog-phone-bar'));
    assert.match(v.cls('seg-move-dialog-buttons'), /justify-end/);
  } finally { await v.unmount(); s.restore(); }
});

test('the source: each caller says where Back goes, the sheet is full, and no browser pop-up', () => {
  assert.match(read('frontend/src/pages/admin/segments/SegmentPage.jsx'), /<MoveDialog members=\{moving\} superAdmin=\{superAdmin\} back="Members"/);
  assert.match(read('frontend/src/pages/admin/segments/SegmentWork.jsx'), /<MoveDialog members=\{chosen[\s\S]{0,120}back="Unclassified"/);
  const dialog = read('frontend/src/pages/admin/segments/MoveDialog.jsx');
  assert.match(dialog, /<Lightbox phone="full" label=\{v\.title\} title=\{phone \? undefined : v\.title\}/);
  for (const f of ['PersonaSegments.jsx', 'MoveDialog.jsx', 'segModel.js']) {
    assert.ok(!/\b(?:window\.)?(alert|confirm|prompt)\(/.test(read(`frontend/src/pages/admin/segments/${f}`)), f);
  }
});
