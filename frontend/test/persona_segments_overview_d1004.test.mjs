/**
 * D1004 (#2819, part 7 of #2378) — Persona segments' Overview complete: every
 * tile from D999's segment counts, the profile filter and the sub-account
 * chips, the weekly chart, the cards with HQ's profiles and D1000's needs, the
 * needs and offers table gaps first, an Admin rail key, SEG7's scope and
 * suggestions inset, and SEG10–SEG12's states. The fixtures are made up and
 * every expected figure is worked out from them in the comments.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/persona_segments_overview_d1004.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  BLOCK_FAILED, NOT_PER_PROFILE, advisorsWithout, confidenceRead, howSetRead, needsTable, overviewTiles, profileLine,
  segmentCardsRead, segmentsByProfileRead, subAccountChips, weeklyRead,
} from '../src/pages/admin/segments/segModel.js';
import PersonaSegments, { PersonaSegmentsPage } from '../src/pages/admin/segments/PersonaSegments.jsx';
import { pageKeyFor } from '../src/lib/railPages.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ── The fixtures ──────────────────────────────────────────────────────────────
// Twenty members (admins out): twelve in a segment, eight with none.
//   by profile: Founders 7 (2 none; Founder — New Venture 5), Investors 9 (2 none; Angel / Scout 4, LP — Individual 3),
//   Advisors 3 (3 none), Operating Partners 0, Explorers 1 (1 none). 7 + 9 + 3 + 0 + 1 = 20; 2 + 2 + 3 + 0 + 1 = 8.
const SEG = {
  members: { available: true, total: 20, in_segment: 12, no_segment: 8, new_30d: 3, deactivated: 1, profile_differs: 2, not_in_taxonomy: 0 },
  segments: { available: true, rows: [
    { id: 'founder_new', members: 5, new_30d: 2 }, { id: 'angel_scout', members: 4, new_30d: 1 }, { id: 'lp_individual', members: 3, new_30d: 0 },
    { id: 'academic', members: 0, new_30d: 0 }, { id: 'service_provider', members: 0, new_30d: 0 },
  ] },
  sub_accounts: { available: true, lp: { total: 2, by_segment: { lp_individual: 2 }, no_segment: 0, definition: 'Accounts with an approved LP application.' },
    product_tester: { recorded: false, reason: 'Nothing on the database marks a product tester yet.' } },
  by_profile: { available: true, profiles: [
    { profile: 'founder', members: 7, no_segment: 2, segments: [{ id: 'founder_new', count: 5 }] },
    { profile: 'investor', members: 9, no_segment: 2, segments: [{ id: 'angel_scout', count: 4 }, { id: 'lp_individual', count: 3 }] },
    { profile: 'advisor', members: 3, no_segment: 3, segments: [] },
    { profile: 'partner', members: 0, no_segment: 0, segments: [] },
    { profile: 'exploring', members: 1, no_segment: 1, segments: [] },
  ], other: { members: 0, no_segment: 0, segments: [] } },
  how_set: { available: true, counts: { router: 7, self_select: 3, admin_retag: 2, not_recorded: 0 } },
  confidence: { available: true, over: 7, bands: [{ key: 'under_50', count: 1 }, { key: '50_69', count: 2 }, { key: '70_89', count: 3 }, { key: '90_up', count: 0 }], not_recorded: 1 },
  // Weeks from Monday 31 August: two before any segment was dated (null), then 0, 2, 3, 1, 4 and 2 to date.
  weekly: { available: true, weeks: ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']
    .map((d, i) => ({ week_start: d, count: [null, null, 0, 2, 3, 1, 4, 2][i], ...(i === 7 ? { to_date: true } : {}) })), undated: 0 },
  moves_30d: { available: true, count: 4 },
};
const PROFILES = { segments: [
  { key: 'founder_new', name: 'Founder — New Venture', profile: 'founder', status: 'active', who: 'Founders turning an idea into a company.' },
  { key: 'angel_scout', name: 'Angel / Scout', profile: 'investor', status: 'active', who: null },
  { key: 'lp_individual', name: 'LP — Individual', profile: 'investor', status: 'draft', who: null },
  { key: 'academic', name: 'Academic / Lab', profile: 'exploring', status: 'active', who: null },
  { key: 'service_provider', name: 'Service Provider', profile: 'partner', status: 'retired', who: null },
] };
const off = (count) => ({ available: true, count });
const COVERAGE = { segments: [
  { key: 'founder_new', name: 'Founder — New Venture', profile: 'founder', status: 'active',
    needs: { recorded: true, total: 2, met: 1, gaps: [{ id: 'n2', text: 'Perks for the first hires' }], items: [{ id: 'n1', text: 'A clear path to incorporation' }, { id: 'n2', text: 'Perks for the first hires' }] },
    gap_kinds: ['perk'], offers: { programs: off(2), perks: off(0), events: off(1), content: off(3), sidebar_links: off(0) } },
  { key: 'angel_scout', name: 'Angel / Scout', profile: 'investor', status: 'active',
    needs: { recorded: false, reason: 'HQ has not written needs for this segment yet.' },
    gap_kinds: [], offers: { programs: off(1), perks: { available: false, reason: 'Perks could not be read.' }, events: off(0), content: off(0), sidebar_links: off(2) } },
  { key: 'lp_individual', name: 'LP — Individual', profile: 'investor', status: 'draft',
    needs: { recorded: true, total: 1, met: 1, gaps: [], items: [{ id: 'n1', text: 'Steady fund reporting' }] },
    gap_kinds: [], offers: { programs: off(0), perks: off(0), events: off(0), content: off(0), sidebar_links: off(0) } },
  { key: 'academic', name: 'Academic / Lab', profile: 'exploring', status: 'active',
    needs: { recorded: false, reason: 'HQ has not written needs for this segment yet.' }, gap_kinds: [], offers: { programs: off(0), perks: off(0), events: off(0), content: off(0), sidebar_links: off(0) } },
  { key: 'service_provider', name: 'Service Provider', profile: 'partner', status: 'retired',
    needs: { recorded: true, total: 3, met: 0, gaps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], items: [{ id: 'a', text: 'Founders who need the service now' }] },
    gap_kinds: ['program', 'content'], offers: { programs: off(0), perks: off(0), events: off(0), content: off(1), sidebar_links: off(0) } },
] };

// ── The model ─────────────────────────────────────────────────────────────────

test('the tiles come from D999; under a profile filter, the counts not split by profile say so instead of a number', () => {
  // Mutations checked: the percentage over in-segment; the filter ignored; a per-profile tile showing the all-profile number.
  const all = overviewTiles(SEG);
  assert.deepEqual([all.tagged.value, all.tagged.sub, all.tagged.delta], [12, 'of 20 members · 60%', '+3 in 30 days']);
  assert.deepEqual([all.untagged.value, all.differ.value, all.moved.value], [8, 2, 4]);
  const inv = overviewTiles(SEG, 'investor');
  assert.deepEqual([inv.tagged.value, inv.tagged.sub, inv.untagged.value], [7, 'of 9 investors', 2], '9 investors, 2 with none');
  assert.deepEqual([inv.differ, inv.moved], [{ notPerProfile: true }, { notPerProfile: true }]);
  const broken = overviewTiles({ ...SEG, members: { available: false, reason: 'x' }, moves_30d: { available: false } });
  assert.deepEqual([broken.tagged, broken.untagged, broken.differ, broken.moved], [{ failed: true }, { failed: true }, { failed: true }, { failed: true }], 'a failed block is never a 0');
  assert.equal(overviewTiles({ ...SEG, members: { available: false } }, 'founder').tagged.value, 5, 'the profile tiles read by_profile, not members');
});

test('segments by profile, how set and confidence read D999\'s blocks; Other appears only when it holds someone', () => {
  // Mutations checked: Other always drawn; the band keys misread; the profile filter ignored.
  const by = segmentsByProfileRead(SEG);
  assert.deepEqual(by.groups.map((g) => [g.role, g.total, g.none, g.bars.map((b) => `${b.label}:${b.count}`).join(',')]), [
    ['founder', 7, 2, 'Founder — New Venture:5'], ['investor', 9, 2, 'Angel / Scout:4,LP — Individual:3'],
    ['advisor', 3, 3, ''], ['partner', 0, 0, ''], ['exploring', 1, 1, ''],
  ]);
  assert.deepEqual(segmentsByProfileRead({ ...SEG, by_profile: { ...SEG.by_profile, other: { members: 2, no_segment: 2, segments: [] } } }).groups.at(-1).label, 'Other');
  assert.deepEqual(segmentsByProfileRead(SEG, 'investor').groups.map((g) => g.role), ['investor']);
  assert.deepEqual(howSetRead(SEG).rows.map((r) => r.count), [7, 3, 2]);
  const c = confidenceRead(SEG);
  assert.deepEqual([c.counts.map((x) => x.count), c.total, c.unrecorded], [[1, 2, 3, 0], 7, 1]);
  assert.equal(advisorsWithout(SEG), 3);
  for (const fn of [segmentsByProfileRead, howSetRead, confidenceRead]) assert.equal(fn({}).failed, true);
});

test('the weekly chart keeps a week before any date as a break, not 0, and sums the last four weeks', () => {
  // Hand-worked: the last four weeks are 3, 1, 4 and 2 → 10, 2 of them this week to date.
  // Mutations checked: a null drawn as 0; the summary over all eight weeks.
  const w = weeklyRead(SEG);
  assert.deepEqual(w.chart.values, [null, null, 0, 2, 3, 1, 4, 2]);
  assert.deepEqual([w.chart.labels[0], w.chart.labels[7]], ['31 Aug', '19 Oct']);
  assert.equal(w.summary, '10 members were given a segment in the last 4 weeks, 2 of them this week to date.');
  assert.match(w.alt, /not recorded, not recorded, 0, 2, 3, 1, 4, 2 so far/);
  assert.equal(weeklyRead({ weekly: { available: true, weeks: [{ week_start: '2026-10-19', count: null, to_date: true }] } }).summary, 'No segment was given a date in these eight weeks.');
});

test('the cards join HQ\'s profiles, D999\'s counts and D1000\'s needs, grouped by profile; each part fails alone', () => {
  // Mutations checked: the top need taken from the gaps; a missing segment row read as unreadable; a failed needs read as Not recorded.
  const r = segmentCardsRead({ seg: SEG, profiles: PROFILES, coverage: COVERAGE });
  assert.deepEqual(r.groups.map((g) => [g.role, g.cards.map((c) => c.key).join(',')]), [
    ['founder', 'founder_new'], ['investor', 'angel_scout,lp_individual'], ['advisor', ''], ['partner', 'service_provider'], ['exploring', 'academic'], ['any', ''],
  ]);
  const fn = r.groups[0].cards[0];
  assert.deepEqual([fn.members, fn.new30, fn.lp, fn.needs], [5, 2, 0, { recorded: true, top: 'A clear path to incorporation', met: 1, total: 2, gaps: 1 }]);
  const lp = r.groups[1].cards[1];
  assert.deepEqual([lp.status, lp.lp], ['draft', 2]);
  assert.deepEqual(r.groups[1].cards[0].needs, { recorded: false, reason: 'HQ has not written needs for this segment yet.' });
  const noCounts = segmentCardsRead({ seg: { ...SEG, segments: { available: false } }, profiles: PROFILES, coverage: { failed: true } });
  assert.deepEqual([noCounts.groups[0].cards[0].members, noCounts.groups[0].cards[0].needs], [null, { failed: true }]);
  // A segment HQ holds that D999 has no row for has no members yet: 0, not unreadable.
  const extra = segmentCardsRead({ seg: SEG, profiles: { segments: [...PROFILES.segments, { key: 'gp_external', name: 'GP — External Fund', profile: 'investor', status: 'draft' }] }, coverage: COVERAGE });
  assert.equal(extra.groups[1].cards.find((c) => c.key === 'gp_external').members, 0);
  assert.equal(segmentCardsRead({ seg: SEG, profiles: { failed: true } }).failed, true);
  assert.deepEqual(segmentCardsRead({ seg: SEG, profiles: PROFILES, coverage: COVERAGE }, 'investor').groups.map((g) => g.role), ['investor']);
  assert.deepEqual(subAccountChips(SEG).productTester, { recorded: false, reason: 'Nothing on the database marks a product tester yet.' });
});

test('needs and offers: gaps first, a Gap where a need asks for a kind nothing answers, a dash where nothing is offered, and a failed store said', () => {
  // Hand-worked gaps: Service Provider 2 kinds + 3 needs = 5; Founder — New Venture 1 + 1 = 2; the rest 0, by name.
  // Mutations checked: sorted by name only; a Gap with offers shown without its count; an unreadable store shown as a dash.
  const t = needsTable(COVERAGE);
  assert.deepEqual(t.rows.map((r) => [r.name, r.gaps]), [
    ['Service Provider', 5], ['Founder — New Venture', 2], ['Academic / Lab', 0], ['Angel / Scout', 0], ['LP — Individual', 0],
  ]);
  assert.deepEqual(t.rows[0].cells.map((c) => c.text), ['Gap', '—', '—', '1 · Gap', '—']);
  assert.deepEqual(t.rows[1].cells.map((c) => c.text), ['2', 'Gap', '1', '3', '—']);
  assert.deepEqual(t.rows[3].cells.map((c) => c.text), ['1', 'Could not be read', '—', '—', '2']);
  assert.deepEqual(t.rows.map((r) => r.needs.text), ['0 of 3', '1 of 2', 'Not recorded', 'Not recorded', '1 of 1']);
  assert.deepEqual(needsTable(COVERAGE, { profile: 'investor' }).rows.map((r) => r.key), ['angel_scout', 'lp_individual']);
  assert.deepEqual(needsTable(COVERAGE, { q: 'lp' }).rows.map((r) => r.key), ['lp_individual']);
  assert.equal(needsTable({ failed: true }).failed, true);
  assert.equal(profileLine('investor', 'draft'), 'Investors · Draft');
  assert.equal(profileLine('any', 'active'), 'Any profile');
});

// ── The page, mounted ─────────────────────────────────────────────────────────

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function stub(routes) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname);
    const r = routes[u.pathname];
    if (r) return r();
    if (u.pathname === '/api/personas/admin/list') return json({ users: [] });
    return json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}
const OK = {
  '/api/personas/admin/segments': () => json(SEG),
  '/api/personas/segments': () => json(PROFILES),
  '/api/personas/segments/coverage': () => json(COVERAGE),
};

async function render(element, url = '/admin/persona-segments') {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
      h(Route, { path: '/admin/persona-segments', element }),
      h(Route, { path: '/admin/persona-segments/unclassified', element }))));
  });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    count: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).length,
    async click(id) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => props(n).onClick()); await settle(); },
    async clickText(within, text) {
      const n = walk(byTestId(within)).find((x) => x.tagName === 'BUTTON' && textOf(x).trim() === text);
      assert.ok(n, `no "${text}" in ${within}`); await act(async () => props(n).onClick()); await settle();
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('mounted as an Admin: the tiles, the filter, the LP chip, the weekly chart, the cards and the needs table, in the Admin\'s rail frame', async () => {
  // Mutations checked: the filter not reaching the cards or the table; the LP chip doing nothing.
  const s = stub(OK);
  const v = await render(h(PersonaSegments));
  try {
    assert.ok(v.has('admin-board-persona-segments'), 'the Admin\'s own rail frame');
    assert.ok(!v.has('hq-board-persona-segments'));
    assert.match(v.of('seg-tab-unclassified'), /Unclassified\s*8/, 'the tab counts D999\'s eight, not the list');
    assert.match(v.of('seg-tile-tagged'), /12.*of 20 members · 60%.*\+3 in 30 days/s);
    assert.match(v.of('seg-tile-untagged'), /8.*Open Unclassified/s);
    assert.match(v.of('seg-tile-differ'), /2/);
    assert.match(v.of('seg-tile-moved30'), /4/);
    assert.match(v.of('seg-group-investor'), /Investors · 9.*Angel \/ Scout.*4.*LP — Individual.*3.*No segment.*2/s);
    assert.match(v.of('seg-weekly-summary'), /10 members were given a segment in the last 4 weeks, 2 of them this week to date\./);
    assert.match(v.of('seg-card-founder_new'), /5 members.*\+2 in 30 days.*Top need: A clear path to incorporation.*Needs met 1 of 2.*1 gap.*Active/s);
    assert.match(v.of('seg-card-angel_scout'), /Top need: Not recorded.*Needs met: Not recorded/s);
    assert.match(v.of('seg-card-advisors-none'), /No segment for Advisors yet\..*HQ is defining them\. 3 advisors have none\./s);
    assert.equal(v.count('seg-needs-row'), 5);
    assert.match(v.of('seg-sub-accounts'), /LPs\s*2.*Product testers · Not recorded/s);
    assert.ok(!v.has('seg-card-lp-lp_individual'));
    await v.click('seg-chip-lp');
    assert.match(v.of('seg-card-lp-lp_individual'), /2 with an LP sub-account/);
    await v.click('seg-filter-investor');
    assert.match(v.of('seg-tile-tagged'), /7.*of 9 investors/s);
    assert.match(v.of('seg-tile-differ'), new RegExp(NOT_PER_PROFILE.slice(0, 30)));
    assert.ok(!v.has('seg-card-founder_new'), 'the filter reaches the cards');
    assert.equal(v.count('seg-needs-row'), 2, 'and the table');
    assert.ok(!v.has('seg-scope-select') && !v.has('seg-suggestions-inset'), 'the scope and suggestions are HQ\'s');
    for (const p of ['/api/personas/admin/segments', '/api/personas/segments', '/api/personas/segments/coverage']) assert.ok(s.seen.includes(p), p);
  } finally { await v.unmount(); s.restore(); }
});

test('one failed block never blanks the page; each has its own Try again; all three failing is one message (SEG12, SEG12f)', async () => {
  // Mutations checked: the needs failure blanking the cards; Try again not reading again; the all-failed page on one failure.
  let calls = 0;
  let s = stub({ ...OK, '/api/personas/segments/coverage': () => { calls += 1; return calls === 1 ? json({ detail: 'down' }, 503) : json(COVERAGE); } });
  let v = await render(h(PersonaSegments));
  try {
    assert.match(v.of('seg-failed-needs'), new RegExp(BLOCK_FAILED.slice(0, 20)));
    assert.match(v.of('seg-card-founder_new'), /5 members.*Needs could not be read\./s, 'the cards stand, saying what failed');
    assert.match(v.of('seg-tile-tagged'), /12/);
    await v.clickText('seg-failed-needs', 'Try again');
    assert.equal(calls, 2);
    assert.equal(v.count('seg-needs-row'), 5);
  } finally { await v.unmount(); s.restore(); }

  s = stub({ ...OK, '/api/personas/admin/segments': () => json({ ...SEG, members: { available: false, unreadable: true, reason: 'x' }, weekly: { available: false } }) });
  v = await render(h(PersonaSegments));
  try {
    assert.match(v.of('seg-tile-tagged'), /Could not be read/);
    assert.ok(v.has('seg-failed-weekly'));
    assert.match(v.of('seg-group-founder'), /Founder — New Venture/, 'by profile still answers');
  } finally { await v.unmount(); s.restore(); }

  const down = () => json({ detail: 'down' }, 503);
  s = stub({ '/api/personas/admin/segments': down, '/api/personas/segments': down, '/api/personas/segments/coverage': down });
  v = await render(h(PersonaSegments));
  try {
    assert.match(v.of('seg-all-failed'), /Persona segments could not be read\..*The sidebar, the tabs and Eadwyn still work\./s);
    assert.ok(!v.has('seg-tiles'));
  } finally { await v.unmount(); s.restore(); }
});

test('no member has a segment yet (SEG10), and HQ\'s scope select and suggestions inset (SEG7)', async () => {
  const empty = { ...SEG, members: { ...SEG.members, in_segment: 0, no_segment: 20, new_30d: 0 } };
  let s = stub({ ...OK, '/api/personas/admin/segments': () => json(empty) });
  let v = await render(h(PersonaSegments));
  try {
    assert.match(v.of('seg-empty'), /No member has a segment yet\..*Open Unclassified/s);
    assert.ok(!v.has('seg-by-profile'));
    assert.ok(v.has('seg-cards'), 'the segments themselves still show');
  } finally { await v.unmount(); s.restore(); }

  s = stub(OK);
  v = await render(h(PersonaSegmentsPage, { superAdmin: true }));
  try {
    assert.match(v.of('seg-header'), /Content.*Persona segments/s);
    assert.match(v.of('seg-filters'), /Scope.*HQ-held accounts/s);
    assert.match(v.of('seg-scope-line'), /Today only HQ-held accounts exist\. Subsidiaries appear once they are deployed\./);
    assert.match(v.of('seg-suggestions-inset'), /Waiting for HQ.*D997 part 6/s);
    assert.match(v.of('seg-card-advisors-none'), /No segment for Advisors yet\.3 advisors have none\./s, 'HQ is not told HQ is defining them');
  } finally { await v.unmount(); s.restore(); }
});

// ── The source ────────────────────────────────────────────────────────────────

test('the Admin rail key, HQ keeps H22, and no browser pop-up', () => {
  // Mutation checked: the Admin key removed.
  assert.equal(pageKeyFor('/admin/persona-segments', 'admin'), 'Admin · Accounts · Persona segments');
  assert.equal(pageKeyFor('/admin/persona-segments/unclassified', 'admin'), 'Admin · Accounts · Persona segments');
  assert.equal(pageKeyFor('/admin/persona-segments', 'super_admin'), 'Super Admin · Content · Personas');
  const page = read('frontend/src/pages/admin/segments/PersonaSegments.jsx');
  assert.match(page, /<AdminBoardFrame workspace="Personas"/);
  assert.match(page, /<AdminBoardFrame workspace="Persona segments"/);
  assert.ok(!/\b(alert|confirm)\(/.test(page));
  assert.match(page, /import \{ Chart, ChartTable \} from '\.\.\/\.\.\/\.\.\/ui\/Charts'/, 'the weekly chart reuses D893\'s parts');
});
