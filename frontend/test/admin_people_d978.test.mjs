/**
 * D978 (#2764) — Advisors & Partners › People (AP3) and one person (AP4):
 * the table from D973's people read, its search, filters, sort and pages in
 * the address, the bulk add to the deck roster and the CSV, and the drawer
 * composing D973's person, D976's standing and the roster's link, with
 * Pause in network and the advisor directory switch behind in-page dialogs.
 *
 * Every mounted test runs on a stubbed fetch with at least one failed block.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_people_d978.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  NOT_RECORDED, UNREADABLE, cell, controlsOf, csvField, csvOf, deckDraftOf, deckDrafts, dialogCopy, effectsLine,
  pageLine, personPath, queryOf, refusalWord, rowOf, searchOf, standingCell, stateOf,
} from '../src/pages/admin/advisors/peopleModel.js';
import { cardOf } from '../src/pages/admin/advisors/deckRosterModel.js';
import { tabOf } from '../src/pages/admin/advisors/apModel.js';
import AdvisorsPartners from '../src/pages/admin/advisors/AdvisorsPartners.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-10-24T12:00:00Z');
const PEOPLE = '/admin/advisors-partners/people';

const ok = (value) => ({ available: true, recorded: true, value });
const missing = (reason) => ({ available: true, recorded: false, reason });
const down = (reason) => ({ available: false, reason });
const STALE = 'A network stage per person is not recorded in this read yet (D976).';

// Invented people; no real names, accounts or amounts.
const ADA = {
  ref: 'user:7', user_id: 7, advisor_id: 70, kind: 'advisor', name: 'Ada Example',
  headline: ok('Fractional CFO'), firm: ok(null), skills: ok(['Finance', 'Legal', 'GTM']), sectors: ok(['Fintech']),
  stage: missing(STALE), profile_check: ok('approved'), kyc: ok('verified'), lab_host: ok([{ id: 1, status: 'approved', capacity: 2 }]),
  sessions_90d: ok({ booked: 1, completed: 3, no_show: 0, cancelled: 0, total: 4 }), rating: ok({ count: 2, average: 4.5 }),
  deck: missing('No member-to-roster link is recorded yet (D974).'), active_deals: ok([]),
  hourly_rate: ok({ amount_cents: 25000, currency: 'usd' }), last_active: ok('2026-10-22 12:00:00'), member_active: ok(true),
};
const BRAM = {
  ref: 'user:8', user_id: 8, advisor_id: null, kind: 'operating_partner', name: 'Bram Sample',
  headline: missing('Headline not recorded.'), firm: ok({ id: 100, name: 'Example Ventures Ltd', company: null, source: 'account_link' }),
  skills: missing('No per-person skills are recorded.'), sectors: missing('No per-person sectors are recorded.'),
  stage: missing(STALE), profile_check: missing('Profile check not recorded.'), kyc: down('accounts could not be read. Try again.'),
  lab_host: ok([]), sessions_90d: missing('Partner sessions are recorded for the firm, not this person.'),
  rating: missing('No individual advisor rating store is linked.'), deck: missing('No member-to-roster link is recorded yet (D974).'),
  active_deals: ok([{ id: 5, type: 'services_partnership', ends_at: '2027-03-12 00:00:00' }]),
  hourly_rate: missing('No hourly rate recorded.'), last_active: missing('Last active not recorded.'), member_active: ok(true),
};
const CLEO = {
  ref: 'roster:3', user_id: null, advisor_id: null, kind: 'deck_only', name: '=Cleo Placeholder',
  headline: ok('Angel'), firm: ok({ id: null, name: 'Sample Co', source: 'roster_text' }), skills: ok([]), sectors: missing('none'),
  stage: missing(STALE), profile_check: missing('No member account is linked.'), kyc: missing('No account KYC is linked.'),
  lab_host: missing('No member account is linked.'), sessions_90d: missing('No linked advisor profile.'), rating: missing('none'),
  deck: ok({ roster_id: 3, shown: true, reach: 'profile', position: 1, has_photo: false }), active_deals: ok([]),
  hourly_rate: missing('none'), last_active: missing('No account activity timestamp is linked.'), member_active: missing('none'),
};
const LIST = { available: true, items: [ADA, BRAM, CLEO], total: 3, limit: 25, offset: 0, sort: 'name_asc', filters: { skill: ['Finance', 'Legal'], profile_check: ['approved'] }, unreadable: ['accounts'] };
const DRAWER = {
  person: ADA,
  profile: ok({ bio: 'Helps founders with their first finance hire.', stages: ok(['seed']), languages: ok(['English']), country: ok('Ireland'), timezone: ok('Europe/Dublin'), availability_note: missing('Availability not recorded.'), weekly_hours: ok('2-4'), linkedin_url: missing('LinkedIn not recorded.') }),
  work: { sessions_90d: ADA.sessions_90d, firm_sessions_90d: missing('No operating-partner firm.'), open_slots_14d: ok(3), cohort_assignments: down('cohort_assignments could not be read. Try again.'), engagements: ok([{ lane: 'signed', count: 1 }]) },
  terms: { hourly_rate: ADA.hourly_rate, active_deals: ok([]), payout_readiness: missing('Payout readiness is supplied by D976 (#2762).'), studio_agreement: missing('D976') },
  history: missing('A network-person history read is not recorded yet (D974/D976).'), unreadable: ['cohort_assignments'],
};
const STANDING = {
  user_id: 7, kind: 'advisor', stage: 'active',
  pause: { paused: false, paused_at: null, reason: null, last_resumed_at: null, last_resume_reason: null, effects: [] },
  directory: { listed: true, hidden_by_admin: false, hidden_at: null },
  payout: { available: true, on_file: true, ready: true, state: 'verified', last_checked_at: '2026-10-01 00:00:00' },
  agreement: { recorded: false, reason: 'No store records a studio agreement with an advisor yet.' },
};
const ROSTER = { profiles: [{ id: 3, name: '=Cleo Placeholder', kind: 'advisor', is_active: 1, state: 'shown', linked_user: null }] };

// ---------------------------------------------------------------- the model

test('every cell is its block: a value, Not recorded with its reason, or Unreadable — never a zero', () => {
  assert.deepEqual(cell(ok(0)), { state: 'ready', text: '0' });
  assert.deepEqual(cell(missing('why')), { state: 'unrecorded', text: NOT_RECORDED, reason: 'why' });
  assert.equal(cell(down('broke')).text, UNREADABLE);
  assert.equal(cell(undefined).state, 'unreadable', 'a column missing from the answer is Unreadable, not blank');
  const a = rowOf(ADA, NOW);
  assert.equal(a.skills.text, 'Finance · Legal +1');
  assert.equal(a.stage.text, NOT_RECORDED);
  assert.equal(a.stage.reason, STALE, 'the stage says why it is not recorded');
  assert.equal(a.host.text, '✓ Approved');
  assert.equal(a.sessions.text, '4');
  assert.equal(a.rating.text, '4.5 (2)');
  assert.equal(a.terms.text, '$250/h', 'the rate is read from amount_cents');
  assert.equal(a.lastActive.text, '2 d ago', 'a zone-less D1 stamp is UTC');
  const b = rowOf(BRAM, NOW);
  assert.equal(b.firm.text, 'Example Ventures Ltd');
  assert.equal(b.kyc.text, UNREADABLE);
  assert.equal(b.sessions.text, NOT_RECORDED);
  assert.match(b.terms.text, /^Services partnership · ends 12 Mar 2027$/);
  const noFirm = rowOf({ ...BRAM, firm: ok(null) }, NOW).firm;
  assert.deepEqual([noFirm.text, noFirm.warn], ['No firm', true], 'a partner with no firm is flagged');
  assert.equal(rowOf(CLEO, NOW).deck.text, 'On the slide · 1');
  assert.equal(rowOf(CLEO, NOW).firm.text, 'Sample Co (deck card)');
});

test('the address is the state: search, filters, sort and page round-trip, and the read is asked for that page', () => {
  const s = stateOf('?q=ada&skill=Finance&sort=rating_desc&page=3&bogus=1');
  assert.deepEqual(s, { q: 'ada', filters: { skill: 'Finance' }, sort: 'rating_desc', page: 3 });
  assert.equal(searchOf(s), '?q=ada&skill=Finance&sort=rating_desc&page=3');
  assert.equal(searchOf(stateOf('')), '', 'defaults stay out of the address');
  assert.equal(stateOf('?sort=evil').sort, 'name_asc');
  assert.deepEqual(queryOf(s), { q: 'ada', skill: 'Finance', sort: 'rating_desc', limit: 25, offset: 50 });
  assert.ok(!('stage' in queryOf(stateOf('?stage=active')).valueOf()), 'stage is not sent: the read refuses it');
  assert.equal(pageLine(0, 25, 82), '1–25 of 82');
  assert.equal(pageLine(25, 25, null), '26–50 of an unknown total');
  assert.equal(personPath('user:7'), `${PEOPLE}/user%3A7`);
  assert.equal(tabOf(`${PEOPLE}/user%3A7`), 'people');
});

test('the CSV: every column in words, a formula neutralised, a missing value Not recorded', () => {
  assert.equal(csvField('=SUM(A1)'), `"'=SUM(A1)"`);
  assert.equal(csvField('a "b"'), '"a ""b"""');
  const csv = csvOf([ADA, BRAM, CLEO], NOW);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^"Name","Kind","Headline","Firm"/);
  assert.match(lines[1], /^"Ada Example","Advisor","Fractional CFO"/);
  assert.match(lines[2], /"Unreadable"/, 'a failed block is Unreadable in the file too');
  assert.ok(!/(^|,)"0"(,|$)/.test(lines[2]), 'no zero stands in for a missing value');
  assert.match(lines[3], /^"'=Cleo Placeholder"/);
});

test('bulk add: deck-only names and people already linked are skipped; the rest go in hidden, linked to their account', () => {
  const d = deckDrafts([ADA, BRAM, CLEO], [{ id: 9, linked_user: { id: 8, name: 'Bram Sample' } }]);
  assert.deepEqual(d.map((x) => Boolean(x.payload)), [true, false, false]);
  assert.match(d[1].skip, /already has a deck card/i);
  assert.match(d[2].skip, /already on the deck roster/i);
  assert.deepEqual(d[0].payload, { name: 'Ada Example', kind: 'advisor', role: 'Fractional CFO', company: null, bio: null, linkedin_url: null, skills: [], is_active: false, linked_user_id: 7 });
  const card = cardOf(deckDraftOf(BRAM));
  assert.equal(card.company, 'Example Ventures Ltd');
  assert.equal(card.kind, 'partner');
  assert.equal(card.is_active, false, 'a new card from People starts hidden');
  assert.deepEqual(card.linked_user, { id: 8, name: 'Bram Sample' });
  assert.equal(deckDraftOf(CLEO), null);
});

test('the drawer offers only what the standing allows, and each dialog says what it changes', () => {
  assert.deepEqual(controlsOf(ADA, STANDING), { pause: 'pause', directory: 'hide' });
  assert.deepEqual(controlsOf(ADA, { ...STANDING, pause: { paused: true } }), { pause: 'resume', directory: 'hide' });
  assert.deepEqual(controlsOf(ADA, { ...STANDING, stage: 'ended' }).pause, null);
  assert.deepEqual(controlsOf(BRAM, STANDING), { pause: 'pause', directory: null }, 'a partner has no advisor directory switch');
  assert.deepEqual(controlsOf(CLEO, STANDING), { pause: null, directory: null });
  assert.deepEqual(controlsOf(ADA, null), { pause: null, directory: null }, 'an unread standing offers nothing');
  assert.match(dialogCopy('pause', ADA).body, /New bookings stop.*advisor directory.*office hours/);
  assert.match(dialogCopy('pause', BRAM).body, /Nothing else changes/);
  assert.match(dialogCopy('hide', ADA).body, /This is not a pause/);
  assert.equal(dialogCopy('pause', ADA).reason, true);
  assert.equal(refusalWord({ code: 'already_paused' }), 'They are already paused. Refresh to see since when.');
  assert.equal(effectsLine(['advisor_bookings_stop']), 'Paused: new bookings stop.');
  // D976's own block shape.
  assert.equal(standingCell({ available: true, on_file: true, signed_at: '2026-09-02 10:00:00' }, (v) => `Signed ${v.signed_at.slice(0, 10)}`).text, 'Signed 2026-09-02');
  assert.equal(standingCell({ recorded: false, reason: 'none kept' }, String).text, NOT_RECORDED);
  assert.equal(standingCell({ available: false, reason: 'down' }, String).text, UNREADABLE);
  assert.equal(standingCell(undefined, String).text, UNREADABLE);
});

// ---------------------------------------------------------------- mounted

function worker(fail = [], writes = {}) {
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = init.method || 'GET';
    seen.push(`${method} ${u.pathname}${u.search}`);
    const p = u.pathname;
    const is = (n) => fail.includes(n);
    if (method === 'POST') {
      const w = writes[p];
      return w ? w(JSON.parse(init.body || '{}')) : json({ detail: 'unexpected' }, 500);
    }
    if (p === '/api/admin/network/people') {
      if (is('people')) return json({ available: false, detail: 'A requested search/filter source could not be read. Try again.', reason: 'A requested search/filter source could not be read. Try again.' }, 503);
      return json(typeof writes.list === 'function' ? writes.list(u.searchParams) : LIST);
    }
    if (p === '/api/admin/network/people/user%3A7' || p === '/api/admin/network/people/user:7') return is('person') ? json({ detail: 'down' }, 503) : json(DRAWER);
    if (p === '/api/admin/network/people/user%3A99' || p === '/api/admin/network/people/user:99') return json({ detail: 'Person not found.' }, 404);
    if (p === '/api/admin/network/people/7') return is('standing') ? json({ detail: 'down' }, 503) : json(writes.standing ? writes.standing() : STANDING);
    if (p === '/api/admin/network-profiles') return is('roster') ? json({ detail: 'down' }, 503) : json(ROSTER);
    return json({});
  };
  return seen;
}

function Where() { const l = useLocation(); return h('output', { 'data-testid': 'where' }, l.pathname + l.search); }

async function mount(url, { fail = [], writes = {}, phone = false } = {}) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const media = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  const seen = worker(fail, writes);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AdvisorsPartners), h(Where))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await settle(); };
  return {
    seen,
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    prop: (id, k) => props(byTestId(id))?.[k],
    where: () => textOf(byTestId('where')),
    click: (id) => fire(id, 'onClick'),
    change: (id, value) => fire(id, 'onChange', { target: { value } }),
    submit: (id) => fire(id, 'onSubmit', { preventDefault() {} }),
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; globalThis.matchMedia = media; restore(); },
  };
}

test('mounted People: the tab, each row from its blocks, a failed block Unreadable, and only the people read', async () => {
  const m = await mount(PEOPLE);
  try {
    assert.match(m.of('ap-header'), /Advisors & Partners › People/);
    assert.ok(m.has('ap-tab-people'));
    assert.match(m.of('people-row-user:7'), /Ada Example.*Fractional CFO.*Advisor.*Finance · Legal \+1.*Not recorded.*Approved.*4.*4\.5 \(2\).*\$250\/h.*2 d ago/s);
    assert.match(m.of('people-row-user:8'), /Bram Sample.*Operating partner.*Example Ventures Ltd.*Unreadable/s, 'the failed KYC block is Unreadable, the row stays');
    assert.match(m.of('people-row-roster:3'), /Deck only.*On the slide · 1/s);
    assert.equal(m.of('people-pageline'), '1–3 of 3');
    const paths = [...new Set(m.seen.map((s) => s.split('?')[0]))].filter((s) => !s.includes('/api/ai'));
    assert.deepEqual(paths, ['GET /api/admin/network/people'], 'People makes no Overview reads');
  } finally { await m.unmount(); }
});

test('mounted People: search, a filter and sort go to the address and the read; Clear empties them', async () => {
  const m = await mount(PEOPLE);
  try {
    await m.change('people-search', 'ada');
    await m.submit('people-search-form');
    assert.equal(m.where(), `${PEOPLE}?q=ada`);
    await m.change('people-filter-skill', 'Finance');
    await m.change('people-sort', 'sessions_desc');
    assert.equal(m.where(), `${PEOPLE}?q=ada&skill=Finance&sort=sessions_desc`);
    assert.ok(m.seen.includes('GET /api/admin/network/people?q=ada&skill=Finance&sort=sessions_desc&limit=25&offset=0'));
    assert.match(m.of('people-clear'), /Clear 2 filters/);
    await m.click('people-clear');
    assert.equal(m.where(), `${PEOPLE}?sort=sessions_desc`);
  } finally { await m.unmount(); }
});

test('mounted People: a 503 is the list Unreadable with Try again; an empty network and a missed search say so', async () => {
  const bad = await mount(PEOPLE, { fail: ['people'] });
  try {
    assert.match(bad.of('people-unreadable'), /Unreadable\. A requested search\/filter source could not be read.*Nothing here is a zero/s);
    assert.ok(!bad.has('people-table'));
    assert.equal(bad.prop('people-export', 'disabled'), true);
  } finally { await bad.unmount(); }
  const none = await mount(PEOPLE, { writes: { list: () => ({ ...LIST, items: [], total: 0 }) } });
  try { assert.match(none.of('people-empty'), /No advisors or partners yet/); } finally { await none.unmount(); }
  const miss = await mount(`${PEOPLE}?q=zed`, { writes: { list: () => ({ ...LIST, items: [], total: 0 }) } });
  try { assert.match(miss.of('people-nomatch'), /No one matches ‘zed’.*Clear the search/s); } finally { await miss.unmount(); }
  const half = await mount(PEOPLE, { writes: { list: () => ({ ...LIST, available: false, total: null }) } });
  try {
    assert.match(half.of('people-incomplete'), /total is unknown/);
    assert.equal(half.of('people-pageline'), '1–3 of an unknown total');
  } finally { await half.unmount(); }
});

test('mounted People on a phone: cards, not the table', async () => {
  const m = await mount(PEOPLE, { phone: true });
  try {
    assert.ok(m.has('people-cards'));
    assert.ok(!m.has('people-table'));
    assert.match(m.of('people-card-user:8'), /Bram Sample.*Operating partner/s);
  } finally { await m.unmount(); }
});

test('mounted bulk add: it reads the roster first, skips who is on it, asks, then adds hidden cards', async () => {
  const sent = [];
  const writes = { '/api/admin/network-profiles': (body) => { sent.push(body); return new Response(JSON.stringify({ profile: { id: 50, ...body } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } };
  const m = await mount(PEOPLE, { writes });
  try {
    await m.change('people-pick-all');
    assert.match(m.of('people-bulk'), /3 picked/);
    await m.click('people-bulk-deck-open');
    assert.match(m.of('people-bulk-deck'), /hidden.*the next deck built does not change/s);
    assert.match(m.of('people-bulk-deck-roster:3'), /Skipped: Already on the deck roster/);
    assert.equal(sent.length, 0, 'nothing is written before the confirm');
    assert.match(m.of('people-bulk-deck-save'), /Add 2 to the deck roster/);
    await m.click('people-bulk-deck-save');
    assert.deepEqual(sent.map((b) => [b.name, b.is_active, b.linked_user_id]), [['Ada Example', false, 7], ['Bram Sample', false, 8]]);
    assert.match(m.of('people-bulk-deck-user:7'), /Added, hidden/);
  } finally { await m.unmount(); }
  const bad = await mount(PEOPLE, { fail: ['roster'] });
  try {
    await bad.change('people-pick-user:7');
    await bad.click('people-bulk-deck-open');
    assert.match(bad.of('people-bulk-deck-unreadable'), /Unreadable.*Nothing is added/s);
    assert.equal(bad.prop('people-bulk-deck-save', 'disabled'), true);
  } finally { await bad.unmount(); }
});

test('mounted export: pages the read at 100 and hands over a CSV; an incomplete list is refused', async () => {
  const blobs = [];
  const urlApi = { createObjectURL: (b) => { blobs.push(b); return 'blob:x'; }, revokeObjectURL() {} };
  const saved = { c: URL.createObjectURL, r: URL.revokeObjectURL };
  Object.assign(URL, urlApi);
  try {
    const m = await mount(PEOPLE);
    try {
      await m.click('people-export');
      assert.ok(m.seen.includes('GET /api/admin/network/people?sort=name_asc&limit=100&offset=0'));
      assert.equal(m.of('people-note'), 'Exported 3 people.');
      const text = await blobs[0].text();
      assert.match(text, /"Ada Example"/);
    } finally { await m.unmount(); }
    let calls = 0;
    const half = await mount(PEOPLE, { writes: { list: () => { calls += 1; return calls === 1 ? LIST : { ...LIST, available: false, total: null }; } } });
    try {
      await half.click('people-export');
      assert.match(half.of('people-note'), /Not exported: some people could not be read/);
      assert.equal(blobs.length, 1, 'no file is handed over for an incomplete list');
    } finally { await half.unmount(); }
  } finally { URL.createObjectURL = saved.c; URL.revokeObjectURL = saved.r; }
});

test('mounted drawer: profile, standing with its links, work with a failed block, terms from the standing, the deck link', async () => {
  const m = await mount(`${PEOPLE}/user%3A7?skill=Finance`);
  try {
    assert.match(m.of('person-drawer'), /Ada Example/);
    assert.match(m.of('person-profile'), /Helps founders.*Finance · Legal · GTM.*Ireland · Europe\/Dublin.*Not recorded/s);
    assert.match(m.of('person-standing'), /Profile check.*Decided in Approvals.*approved.*KYC.*Decided in KYC.*Listed/s);
    assert.match(m.of('person-work-cohorts'), /Unreadable/, 'the failed cohort block is Unreadable and the rest stays');
    assert.match(m.of('person-work-slots'), /3/);
    assert.match(m.of('person-terms-rate'), /\$250 an hour/);
    assert.match(m.of('person-terms-payout'), /Ready/, 'payout comes from D976 standing, not the drawer read');
    assert.match(m.of('person-terms-agreement'), /Not recorded: No store records a studio agreement/);
    assert.ok(m.has('person-deck-none'));
    assert.match(m.of('person-history'), /Not recorded/);
    assert.ok(m.has('person-pause') && m.has('person-hide'));
    await m.click('person-close');
    assert.equal(m.where(), `${PEOPLE}?skill=Finance`, 'closing keeps the list’s search');
  } finally { await m.unmount(); }
});

test('mounted drawer: a failed standing read is Unreadable and offers no Pause; a failed person read has Try again; an unknown ref says so', async () => {
  const m = await mount(`${PEOPLE}/user%3A7`, { fail: ['standing'] });
  try {
    assert.match(m.of('person-standing-unreadable'), /Unreadable.*Pause and Hide wait/s);
    assert.ok(!m.has('person-pause'));
    assert.match(m.of('person-terms-payout'), /Unreadable/);
    assert.match(m.of('person-profile'), /Helps founders/, 'the person read still draws');
  } finally { await m.unmount(); }
  const p = await mount(`${PEOPLE}/user%3A7`, { fail: ['person'] });
  try { assert.match(p.of('person-unreadable'), /Unreadable.*Try again/s); } finally { await p.unmount(); }
  const gone = await mount(`${PEOPLE}/user%3A99`);
  try { assert.ok(gone.has('person-missing')); } finally { await gone.unmount(); }
});

test('mounted Pause: the dialog says what it changes, needs a reason, shows a refusal in words, then the result', async () => {
  let paused = false;
  const sent = [];
  const writes = {
    standing: () => (paused ? { ...STANDING, stage: 'paused', pause: { ...STANDING.pause, paused: true, paused_at: '2026-10-24 11:00:00', reason: 'On leave' } } : STANDING),
    '/api/admin/network/people/7/pause': (body) => {
      sent.push(body);
      if (sent.length === 1) return new Response(JSON.stringify({ error: 'already_paused', detail: 'x' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      paused = true;
      return new Response(JSON.stringify({ user_id: 7, stage: 'paused', effects: ['advisor_bookings_stop', 'advisor_directory_hidden'] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  };
  const m = await mount(`${PEOPLE}/user%3A7`, { writes });
  try {
    await m.click('person-pause');
    assert.match(m.of('person-pause-dialog'), /Pause Ada Example\?.*New bookings stop/s);
    assert.equal(m.prop('person-pause-confirm', 'disabled'), true, 'no reason, no pause');
    await m.change('person-pause-reason', 'On leave');
    await m.click('person-pause-confirm');
    assert.equal(m.of('person-pause-refusal'), 'They are already paused. Refresh to see since when.');
    await m.click('person-pause-confirm');
    assert.deepEqual(sent, [{ reason: 'On leave' }, { reason: 'On leave' }]);
    assert.ok(!m.has('person-pause-dialog'));
    assert.equal(m.of('person-done'), 'Paused: new bookings stop, they are hidden from the advisor directory.');
    assert.match(m.of('person-paused'), /Paused since 24 Oct 2026\. Reason: On leave/);
    assert.ok(m.has('person-resume'));
  } finally { await m.unmount(); }
});

test('mounted directory switch: Hide asks in a dialog, with no reason box, then says the result', async () => {
  const sent = [];
  const writes = { '/api/admin/network/people/7/directory': (body) => { sent.push(body); return new Response(JSON.stringify({ user_id: 7, hidden_by_admin: true, listed: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } };
  const m = await mount(`${PEOPLE}/user%3A7`, { writes });
  try {
    await m.click('person-hide');
    assert.match(m.of('person-hide-dialog'), /This is not a pause/);
    assert.ok(!m.has('person-hide-reason'));
    assert.equal(sent.length, 0);
    await m.click('person-hide-confirm');
    assert.deepEqual(sent, [{ listed: false }]);
    assert.equal(m.of('person-done'), 'Hidden from the advisor directory.');
  } finally { await m.unmount(); }
});

test('the drawer’s Add to deck roster opens the card dialog filled in and hidden', async () => {
  const m = await mount(`${PEOPLE}/user%3A7`);
  try {
    await m.click('person-deck-add');
    assert.ok(m.has('deck-card-dialog'));
    assert.match(m.of('deck-card-dialog'), /Ada Example|Fractional CFO/);
  } finally { await m.unmount(); }
});

test('the wiring: routes for People and a person, the tab door, no browser pop-ups', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`path="${PEOPLE}"`));
  assert.ok(app.includes(`path="${PEOPLE}/:ref"`));
  for (const f of ['People.jsx', 'PersonDrawer.jsx']) {
    const src = read(`frontend/src/pages/admin/advisors/${f}`);
    assert.ok(!/window\.(confirm|alert|prompt)\(|\b(confirm|alert|prompt)\(/.test(src), `${f} uses an in-page dialog`);
    assert.ok(!/credits/i.test(src));
  }
});
