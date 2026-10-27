/**
 * D988 (#2779, part 7 of #2376) — the studio's Programs tab (GR7–GR15): the
 * tiles, the nine programs with status, terms, period and schedule, the
 * partner deal types, GR8's terms, GR9's request sheet and its limit, the
 * sixth Requests button, the Summary card, and the states. Mounted on a
 * stubbed fetch; React props are read through `__reactProps$`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/studio_programs_d988.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  NOT_ENTERED, NOT_RECORDED, buildProgramRequest, copyStamp, programTiles, statusOf, summaryLine, termRows,
  termsSummary, answerSentence, asksFor, programRequestKind,
} from '../src/lib/studioPrograms.js';
import ProgramsTab, { ProgramsUnlinked } from '../src/pages/subsidiary/licence/ProgramsTab.jsx';
import { RequestsView } from '../src/pages/subsidiary/licence/RequestsTab.jsx';
import { ProgramsCard } from '../src/pages/subsidiary/LicenceSummary.jsx';
import { requestKind } from '../src/pages/subsidiary/licence/licenceTabsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const TODAY = new Date('2026-10-25T09:00:00Z');

// ─────────────────────────────────────────────────────────────── fixtures, D984's shape

const grant = (key, over = {}) => ({
  uid: `g-${key}`, program_key: key, state: 'granted', in_force: true, waiting_on: [], effective_end: '2027-10-31',
  schedule: { status: 'signed', contract_uid: 'c1', signed_at: '2026-10-02 10:00:00' },
  note: null, paused_at: null, ended_at: null, set_at: '2026-10-14 09:00:00', ...over,
});
const P = (key, name, group, standing, word, g = null) => ({ program_key: key, name, group, standing, word, line: `${word} line`, grant: g });
const PROGRAMS = [
  P('spinout-lab', 'Spin-Out Lab', 'Ventures', 'in_force', 'In force', grant('spinout-lab', {
    terms: { starts_on: '2024-11-01', ends_on: null, ends_with_licence: 1, capacity_cap: null, capacity_uncapped: null, cohorts_per_year: 12, fee_cents: 300000, currency: 'EUR', hq_share_bps: 1000, hq_approves_each_cohort: 1, playbook: 'as_written', brand: 'axal', reporting: null, requires_signed_schedule: 1 },
  })),
  P('ai-native-venture', 'AI-native Venture', 'Ventures', 'not_offered', 'Not offered yet'),
  P('mentor-cohorts', 'Mentor cohort access', 'Access', 'paused', 'Paused', grant('mentor-cohorts', {
    state: 'paused', in_force: false, note: 'Paused while HQ reviews mentors.', paused_at: '2026-10-20 10:00:00', effective_end: '2026-12-01',
    terms: { starts_on: '2025-01-01', ends_on: '2026-12-01', ends_with_licence: 0, capacity_cap: 8, capacity_uncapped: 0, cohorts_per_year: null, fee_cents: null, currency: null, hq_approves_each_cohort: null, playbook: null, brand: null, reporting: null, requires_signed_schedule: null },
    schedule: { status: 'not_sent', contract_uid: null, signed_at: null },
  })),
  P('investor-cohorts', 'Investor cohort access', 'Access', 'not_offered', 'Not offered yet'),
  P('referral-partners', 'Referral partners', 'Network and referrals', 'not_recorded', 'Not recorded'),
  P('refer-and-earn', 'Refer & Earn', 'Network and referrals', 'granted', 'Granted, not in force yet', grant('refer-and-earn', {
    in_force: false, waiting_on: ['schedule_signed'], schedule: { status: 'sent', contract_uid: 'c2', signed_at: null },
    terms: { starts_on: '2025-02-01', ends_on: null, ends_with_licence: 1, credits_per_quarter: 400, fee_cents: 200000, currency: 'EUR', hq_share_bps: 1000, playbook: 'may_adapt', brand: 'studio', reporting: 'quarterly', requires_signed_schedule: 1 },
  })),
  P('perks', 'Perks', 'Rewards', 'switched_off', 'Not offered'),
  P('learning', 'Learning', 'Learning', 'not_recorded', 'Not recorded'),
  P('product-testing', 'Product testing', 'Product', 'hq_only', 'Runs at HQ'),
];
const READ = { linked: true, source: 'hq', as_of: null, age_seconds: null, licence: { uid: 'l1', brand_name: 'Studio Lisbon' }, programs: PROGRAMS, reason: null };
const REQUESTS = {
  open_max: 20, response_hours: { program_grant: 72, program_terms_change: 72, program_end: 72 },
  items: [
    { uid: 'r1', kind: 'program_grant', status: 'open', created_at: '2026-10-12 08:00:00', request: { program: 'learning' } },
    { uid: 'r2', kind: 'renewal', status: 'open', created_at: '2026-10-01 08:00:00', request: {} },
    { uid: 'r3', kind: 'program_grant', status: 'answered', created_at: '2026-09-01 08:00:00', request: { program: 'perks' } },
  ],
};
const DEALS = {
  source: 'hq', recorded: true, types: ['equity_partnership', 'services_partnership'], reason: null,
  catalogue: [
    { type: 'equity_partnership', label: 'Equity partnership' }, { type: 'services_partnership', label: 'Services partnership' },
    { type: 'capital_partnership', label: 'Capital partnership' },
  ],
};

// ─────────────────────────────────────────────────────────────── mounting

async function render(el, url = '/admin/my-licence/programs') {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, el)); });
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const node = (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    text: () => textOf(container),
    of: (id) => textOf(node(id)),
    has: (id) => Boolean(byTestId(id)),
    props: (id) => props(node(id)),
    byText: (t, tag = 'BUTTON') => walk(container).find((n) => n.tagName === tag && textOf(n).trim() === t),
    async click(n) { await act(async () => { props(n).onClick({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { await act(async () => { props(node(id)).onChange({ target: { value } }); }); await settle(); },
    form: (id) => { let n = node(id); while (n && n.tagName !== 'FORM') n = n.parentNode; return n; },
    settle,
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

/** A fetch stub by path; `answers` maps a pathname to a body or a function. Records every POST. */
function stub(answers) {
  const original = globalThis.fetch;
  const posts = [];
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    seen.push(`${init.method || 'GET'} ${u.pathname}`);
    if ((init.method || 'GET') === 'POST' && u.pathname !== '/api/client-error') posts.push({ path: u.pathname, body: JSON.parse(init.body || '{}') });
    const a = answers[`${init.method || 'GET'} ${u.pathname}`] ?? answers[u.pathname];
    if (typeof a === 'function') return a(init);
    if (a === undefined) return json({});
    return json(a);
  };
  return { posts, seen, restore() { globalThis.fetch = original; } };
}
const ANSWERS = {
  '/api/licence/mine/programs': READ,
  '/api/licence/mine/requests': REQUESTS,
  '/api/licence/mine/partner-deal-types': DEALS,
};

// ─────────────────────────────────────────────────────────────── the model

test('the model: tiles, statuses, terms and a request body, never a guessed value', () => {
  const tiles = Object.fromEntries(programTiles({ programs: PROGRAMS, requests: REQUESTS, today: TODAY }).map((t) => [t.id, t]));
  assert.equal(tiles.granted.value, '3', 'in force, granted and paused are held');
  assert.equal(tiles.granted.sub, 'of 5 HQ offers', 'switched off, not offered and HQ only are not offers');
  assert.equal(tiles.requests.value, '1', 'one open program request; the renewal and the answered one are not');
  assert.equal(tiles.requests.sub, 'Learning · sent 12 Oct 2026');
  assert.equal(tiles.ending.value, '1');
  assert.match(tiles.ending.sub, /Mentor cohort access ends 1 Dec 2026/);
  assert.equal(tiles.fees.value, '€5,000', 'the fees recorded, summed; the paused one has none');
  assert.equal(tiles.fees.sub, '1 grant has no fee recorded');

  const ended = [P('perks', 'Perks', 'Rewards', 'ended', 'Ended', grant('perks', { state: 'ended', in_force: false, ended_at: '2026-09-01', terms: { fee_cents: 50000, currency: 'EUR' } }))];
  const endedTiles = Object.fromEntries(programTiles({ programs: ended, requests: REQUESTS, today: TODAY }).map((t) => [t.id, t]));
  assert.deepEqual([endedTiles.granted.value, endedTiles.granted.sub, endedTiles.fees.value], ['0', 'of 1 HQ offers', NOT_RECORDED], 'an ended grant is offered, not held, and owes no fee');
  assert.deepEqual(asksFor(ended[0]), ['grant'], 'an ended program can be asked for again');

  const reading = programTiles({ programs: undefined, requests: undefined, today: TODAY });
  assert.ok(reading.every((t) => t.value === '' && t.sub === 'Reading…'), 'GR12b: every tile reads');
  const lost = programTiles({ programs: null, requests: null, today: TODAY });
  assert.ok(lost.every((t) => t.value === 'Unreadable'), 'a failed read is never a zero');

  const open = REQUESTS.items.filter((r) => r.status === 'open');
  const learning = PROGRAMS.find((p) => p.program_key === 'learning');
  assert.deepEqual([statusOf(learning, open).word, statusOf(learning, open).line], ['Requested', 'Waiting for HQ since 12 Oct 2026']);
  assert.equal(statusOf(PROGRAMS[4], open).word, NOT_RECORDED, 'no grant row is "Not recorded"');
  assert.match(statusOf(PROGRAMS[5], open).line, /the schedule to be signed/);
  assert.match(statusOf(PROGRAMS[2], open).line, /Paused while HQ reviews mentors/);
  assert.deepEqual(termsSummary(PROGRAMS[0]), ['12 cohorts a year', '10% to HQ']);

  const rows = Object.fromEntries(termRows(PROGRAMS[0]).map((r) => [r.eye, r]));
  assert.equal(rows.REPORTING.text, NOT_RECORDED);
  assert.equal(rows.REPORTING.sub, NOT_ENTERED, 'GR13 E');
  assert.equal(rows.REPORTING.chip, null, 'no schedule states a term nobody entered');
  assert.equal(rows.MONEY.chip, 'Program schedule · signed');
  assert.match(rows.PERIOD.text, /From 1 Nov 2024 · ends with the licence term, 31 Oct 2027/);
  assert.equal(Object.fromEntries(termRows(PROGRAMS[2]).map((r) => [r.eye, r])).MONEY.text, NOT_RECORDED, 'a fee nobody set is not €0');
  assert.equal(Object.fromEntries(termRows(PROGRAMS[2]).map((r) => [r.eye, r])).CAPACITY.chip, 'No schedule sent yet');

  assert.deepEqual(asksFor(PROGRAMS[0]), ['change', 'end']);
  assert.deepEqual(asksFor(learning), ['grant']);
  assert.deepEqual(asksFor(PROGRAMS[8]), [], 'Runs at HQ cannot be asked for');
  assert.equal(buildProgramRequest({ program: learning, ask: 'grant', why: '  ' }).ok, false, 'the reason is required');
  assert.deepEqual(buildProgramRequest({ program: PROGRAMS[5], ask: 'change', term: 'credits_per_quarter', asked: '600', why: 'Referrals doubled.' }).body, {
    kind: 'program_terms_change', subject: 'Program change · Refer & Earn · Credits a quarter', detail: 'Referrals doubled.',
    request: { program: 'refer-and-earn', term: 'credits_per_quarter', asked: '600' },
  });
  assert.ok(!('current' in buildProgramRequest({ program: PROGRAMS[5], ask: 'change', term: 'fee_cents', asked: 'x', why: 'y' }).body.request), 'HQ fills "as it stands"');
  assert.equal(buildProgramRequest({ program: PROGRAMS[5], ask: 'change', term: 'cohorts_per_year', asked: '2', why: 'y' }).ok, false, 'a term the program does not carry');
  assert.equal(answerSentence('program_grant', { program_grant: 72 }), 'HQ answers within 3 days. You will see the answer here and under Requests.');
  assert.match(answerSentence('program_grant', {}), /not recorded/);

  assert.equal(summaryLine(PROGRAMS, REQUESTS), '3 granted · 1 with HQ');
  assert.equal(summaryLine(null, REQUESTS), 'Programs unreadable · 1 with HQ');
  assert.equal(copyStamp({ source: 'hq' }), null, 'HQ reads its store, so no stamp');
  assert.equal(copyStamp({ source: 'copy', as_of: '2026-10-18T10:42:00Z' }), 'As of 10:42 UTC, 18 Oct 2026. This is HQ’s copy of your grants. It updates when HQ changes them.');
  assert.equal(requestKind(REQUESTS.items[0]), 'Program · Learning');
  assert.equal(programRequestKind({ kind: 'program_end', request: { program: 'perks' } }), 'End program · Perks');
});

// ─────────────────────────────────────────────────────────────── the tab, mounted

test('GR7 mounted: the rule, four tiles, nine programs with status, terms, period, schedule and action, and the deal types', async () => {
  const s = stub(ANSWERS);
  const v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    assert.match(v.of('licence-programs-rule'), /HQ decides which programs your studio runs, and on what terms/);
    assert.match(v.of('licence-programs-tile-granted'), /3of 5 HQ offers/);
    assert.match(v.of('licence-programs-tile-requests'), /1Learning · sent 12 Oct 2026/);
    assert.match(v.of('licence-programs-tile-fees'), /€5,000/);
    const spin = v.of('licence-program-spinout-lab');
    assert.match(spin, /In force/); assert.match(spin, /12 cohorts a year/); assert.match(spin, /1 Nov 2024 → 31 Oct 2027/);
    assert.match(spin, /Signed 2 Oct 2026/); assert.match(spin, /Open program ›/);
    assert.match(v.of('licence-program-learning'), /Requested.*Waiting for HQ since 12 Oct 2026.*View request/);
    assert.match(v.of('licence-program-referral-partners'), /Not recorded.*Request it/);
    assert.match(v.of('licence-program-mentor-cohorts'), /Not sent/);
    assert.match(v.of('licence-program-product-testing'), /Runs at HQ/);
    assert.doesNotMatch(v.of('licence-program-product-testing'), /Request it|Open program/, 'Runs at HQ has no action');
    assert.doesNotMatch(v.text(), /Not granted/);
    assert.ok(v.has('licence-program-card-perks'), 'GR15a: the phone\'s cards');
    assert.match(v.of('licence-deal-type-equity_partnership'), /✓ Equity partnership/);
    assert.match(v.of('licence-deal-type-capital_partnership'), /Capital partnership · locked/);
    assert.match(v.of('licence-programs-deal-types'), /Your partner invitations offer only these types/);
    assert.ok(!v.has('licence-programs-stamp'), 'no copy stamp on HQ');
    assert.ok(!v.has('licence-programs-nothing'));
    assert.deepEqual(s.posts, [], 'reading the tab sends nothing');
  } finally { await v.unmount(); s.restore(); }
});

test('GR8: View all terms opens the read-only terms, each with its schedule; Request a change opens GR9 on that program', async () => {
  const s = stub(ANSWERS);
  const v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    assert.ok(!v.has('program-terms-dialog'), 'closed unless asked');
    await act(async () => { v.props('licence-program-terms-refer-and-earn').onClick(); });
    await v.settle();
    const d = v.of('program-terms-dialog');
    // D1317: one program's terms are the shared right-side Sheet, at 640px (its own 600 snapped).
    assert.equal(v.props('program-terms-dialog').role, 'dialog');
    assert.ok(v.props('program-terms-dialog')['aria-labelledby']);
    assert.equal(v.props('program-terms-dialog')['data-width'], 640);
    assert.match(d, /Refer & Earn · your terms/);
    assert.match(v.of('program-term-credits'), /400 credits a quarter.*Program schedule · sent/);
    assert.match(v.of('program-term-money'), /Program fee to HQ €2,000 a year · HQ share 10%/);
    assert.match(v.of('program-term-brand'), /Run under the studio’s brand/);
    assert.match(v.of('program-term-contract'), /Program schedule: Refer & Earn · Sent, not signed/);
    assert.match(v.of('program-terms-dates'), /Terms last set by HQ/);
    await act(async () => { v.props('program-terms-change').onClick(); });
    await v.settle();
    assert.ok(!v.has('program-terms-dialog'), 'the terms close when the sheet opens');
    assert.equal(v.props('program-request-program').value, 'refer-and-earn');
    assert.ok(v.has('program-request-term'), 'on "Change a term"');
    assert.deepEqual(s.posts, []);
  } finally { await v.unmount(); s.restore(); }
});

test('GR9: the sheet lists only programs HQ offers, says what the term stands at, requires the reason, and sends D983\'s body', async () => {
  const s = stub({ ...ANSWERS, 'POST /api/licence/mine/requests': () => json({ uid: 'r9', due_at: '2026-10-28 09:00:00' }, 201) });
  const v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    await act(async () => { v.props('licence-program-ask-referral-partners').onClick(); });
    await v.settle();
    const sheetText = v.of('program-request-sheet');
    // D1317: the shared right-side Sheet at 480px, named by its title.
    assert.equal(v.props('program-request-sheet').role, 'dialog');
    assert.ok(v.props('program-request-sheet')['aria-labelledby']);
    assert.equal(v.props('program-request-sheet')['data-width'], 480);
    assert.doesNotMatch(sheetText, /Product testing|AI-native Venture|Perks/, 'only programs HQ offers');
    assert.equal(v.props('program-request-program').value, 'referral-partners');
    assert.match(v.of('program-request-answer'), /HQ answers within 3 days/);
    const form = v.form('program-request-why');
    const props = Object.entries(form).find(([k]) => k.startsWith('__reactProps$'))[1];
    await act(async () => { await props.onSubmit({ preventDefault() {} }); });
    assert.deepEqual(s.posts, [], 'no reason, nothing sent');
    assert.match(v.of('program-request-sheet'), /Say why your studio needs it/);

    await v.change('program-request-program', 'refer-and-earn');
    const propsOf = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))[1];
    assert.equal(propsOf(v.byText('Grant')).disabled, true, 'a program the studio holds cannot be asked for again');
    const change = propsOf(v.byText('Change a term'));
    await act(async () => { change.onClick(); });
    await v.settle();
    await v.change('program-request-term', 'credits_per_quarter');
    assert.equal(v.of('program-request-current'), '400 credits a quarter', 'as it stands, read only, from the grant');
    await v.change('program-request-asked', '600');
    await v.change('program-request-why', 'Referrals doubled again this quarter.');
    const props2 = Object.entries(v.form('program-request-why')).find(([k]) => k.startsWith('__reactProps$'))[1];
    await act(async () => { await props2.onSubmit({ preventDefault() {} }); });
    await v.settle();
    assert.deepEqual(s.posts, [{ path: '/api/licence/mine/requests', body: {
      kind: 'program_terms_change', subject: 'Program change · Refer & Earn · Credits a quarter', detail: 'Referrals doubled again this quarter.',
      request: { program: 'refer-and-earn', term: 'credits_per_quarter', asked: '600' },
    } }]);
    assert.ok(!v.has('program-request-sheet'), 'closed once sent');
    assert.match(v.of('licence-programs-sent'), /Sent to HQ. HQ answers by 2026-10-28. Nothing changes until HQ answers./);
  } finally { await v.unmount(); s.restore(); }
});

test('GR9b: at the open-request limit the sheet says so and Send is disabled; a refusal is shown in the Worker\'s words', async () => {
  const full = { ...REQUESTS, items: Array.from({ length: 20 }, (_, i) => ({ uid: `o${i}`, kind: 'renewal', status: 'open', created_at: '2026-10-01', request: {} })) };
  let s = stub({ ...ANSWERS, '/api/licence/mine/requests': full });
  let v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    await act(async () => { v.props('licence-program-ask-learning').onClick(); });
    await v.settle();
    assert.match(v.of('program-request-limit'), /You have 20 open requests with HQ, the most allowed. Wait for an answer before you send another./);
    assert.equal(v.props('program-request-send').disabled, true);
  } finally { await v.unmount(); s.restore(); }

  s = stub({ ...ANSWERS, 'POST /api/licence/mine/requests': () => json({ error: 'program_request_open', message: 'A request of this kind for this program is already open with HQ. Add to that one.' }, 409) });
  v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    await act(async () => { v.props('licence-program-ask-referral-partners').onClick(); });
    await v.settle();
    await v.change('program-request-why', 'We have partners waiting.');
    const p = Object.entries(v.form('program-request-why')).find(([k]) => k.startsWith('__reactProps$'))[1];
    await act(async () => { await p.onSubmit({ preventDefault() {} }); });
    await v.settle();
    assert.equal(s.posts.length, 1);
    assert.match(v.of('program-request-sheet'), /already open with HQ/);
  } finally { await v.unmount(); s.restore(); }
});

test('the states: reading (GR12b), unreadable programs, unreadable deal types, nothing granted (GR11 B), a branch copy (GR13 C)', async () => {
  let s = stub({ ...ANSWERS, '/api/licence/mine/programs': () => new Promise(() => {}) });
  let v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    assert.ok(v.has('licence-programs-loading'));
    assert.match(v.of('licence-programs-tile-granted'), /Reading…/);
  } finally { await v.unmount(); s.restore(); }

  s = stub({ ...ANSWERS, '/api/licence/mine/programs': () => json({ error: 'licence_programs_unreadable' }, 503), '/api/licence/mine/partner-deal-types': () => json({ error: 'deal_types_unreadable' }, 503) });
  v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    assert.match(v.of('licence-programs-unreadable'), /could not be read. That is not the same as none.*Try again/);
    assert.match(v.of('licence-programs-tile-granted'), /Unreadable/);
    assert.match(v.of('licence-programs-tile-requests'), /1/, 'the requests still read: one failed block never blanks the page');
    assert.match(v.of('licence-programs-deal-types-unreadable'), /Unreadable.*Try again/);
    assert.doesNotMatch(v.text(), /HQ has not granted any program/, 'a failed read is not "nothing granted"');
  } finally { await v.unmount(); s.restore(); }

  s = stub({ ...ANSWERS, '/api/licence/mine/programs': () => json({ error: 'licence_programs_unreadable' }, 503), '/api/licence/mine/requests': { ...REQUESTS, items: [] } });
  v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    assert.ok(v.has('licence-programs-unreadable'));
    assert.ok(!v.has('licence-programs-nothing'), 'with no request either, a failed read is still not "nothing granted"');
  } finally { await v.unmount(); s.restore(); }

  const none = PROGRAMS.map((p) => (p.grant ? { ...p, standing: 'not_recorded', word: 'Not recorded', grant: null } : p));
  s = stub({ ...ANSWERS, '/api/licence/mine/programs': { ...READ, programs: none }, '/api/licence/mine/requests': { ...REQUESTS, items: [] } });
  v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    assert.match(v.of('licence-programs-nothing'), /HQ has not granted any program to Studio Lisbon yet.See what HQ offers below, or request one./);
    assert.match(v.of('licence-programs-tile-fees'), /Not recorded/, 'no fee is not €0');
  } finally { await v.unmount(); s.restore(); }

  s = stub({ ...ANSWERS, '/api/licence/mine/programs': { ...READ, source: 'copy', as_of: '2026-10-18T10:42:00Z' } });
  v = await render(h(ProgramsTab, { today: TODAY }));
  try { assert.match(v.of('licence-programs-stamp'), /As of 10:42 UTC, 18 Oct 2026. This is HQ’s copy of your grants/); } finally { await v.unmount(); s.restore(); }

  s = stub({ ...ANSWERS, '/api/licence/mine/programs': { ...READ, source: 'copy', programs: null, reason: 'HQ has not sent this branch its programs yet.' } });
  v = await render(h(ProgramsTab, { today: TODAY }));
  try {
    assert.match(v.of('licence-programs-no-copy'), /HQ has not sent this branch its programs yet/);
    assert.match(v.of('licence-programs-tile-granted'), /Unreadable/);
  } finally { await v.unmount(); s.restore(); }
});

test('GR11 C and GR14: an account no licence binds, HQ viewing as an Admin, and a member refused', async () => {
  let v = await render(h(ProgramsUnlinked, { user: { role: 'admin', is_super_admin: 0 } }));
  try {
    assert.match(v.of('licence-programs-none'), /Your account is not linked to a licence.On HQ-held accounts, HQ runs every program.Open ProgramsContact HQ/);
  } finally { await v.unmount(); }
  v = await render(h(ProgramsUnlinked, { user: { role: 'admin', is_super_admin: 1 } }));
  try {
    assert.match(v.of('licence-programs-hq'), /You are viewing as an Admin.HQ is not a studio, so it holds no grants.Open Program grants/);
  } finally { await v.unmount(); }
  const s = stub({ ...ANSWERS, '/api/licence/mine/programs': { linked: false, source: 'hq', programs: [], reason: 'Your account is not linked to a licence.' } });
  v = await render(h(ProgramsTab, { today: TODAY, user: { role: 'admin' } }));
  try { assert.ok(v.has('licence-programs-none')); } finally { await v.unmount(); s.restore(); }

  const page = read('frontend/src/pages/subsidiary/MyLicencePage.jsx');
  assert.ok(page.includes("if (data.none && tab === 'programs') {"), 'the page\'s no-licence state draws GR11 C on this tab');
  assert.match(read('frontend/src/pages/hq/hqNoticeModel.js'), /ADMIN_TITLE = 'This page is for studio admins'[\s\S]*ADMIN_LINE = 'If you run a studio, ask HQ for admin access.'[\s\S]*ADMIN_HOME_LABEL = 'Go to your home'/, 'GR14 B is the admin-only notice');
});

test('the insets: the Requests tab\'s sixth button opens GR9, and the Summary card reads "granted · with HQ"', async () => {
  const s = stub({ ...ANSWERS, 'POST /api/licence/mine/requests': () => json({ uid: 'r9' }, 201) });
  const raised = [];
  let v = await render(h(RequestsView, { list: REQUESTS, mine: null, programs: PROGRAMS, today: '2026-10-25', raise: async (b) => { raised.push(b); return { uid: 'r9' }; } }), '/admin/my-licence/requests');
  try {
    const btn = v.byText('Request a program');
    assert.ok(btn, 'the sixth button');
    await v.click(btn);
    assert.ok(v.has('program-request-sheet'));
    assert.equal(v.props('program-request-program').value, 'referral-partners', 'on the first program the studio can ask HQ to grant');
    await v.change('program-request-why', 'We have partners waiting.');
    const p = Object.entries(v.form('program-request-why')).find(([k]) => k.startsWith('__reactProps$'))[1];
    await act(async () => { await p.onSubmit({ preventDefault() {} }); });
    await v.settle();
    assert.deepEqual(raised, [{ kind: 'program_grant', subject: 'Program · Referral partners', detail: 'We have partners waiting.', request: { program: 'referral-partners' } }]);
  } finally { await v.unmount(); s.restore(); }

  v = await render(h(ProgramsCard, { read: { value: READ }, requests: { value: REQUESTS } }), '/admin/my-licence');
  try { assert.match(v.of('licence-programs-card'), /Programs3 granted · 1 with HQOpen Programs ›/); } finally { await v.unmount(); }
  v = await render(h(ProgramsCard, { read: { value: null, reason: 'Down.' }, requests: { value: undefined } }), '/admin/my-licence');
  try { assert.match(v.of('licence-programs-card'), /Programs unreadable.*Down\./); } finally { await v.unmount(); }
});

test('the source: the module clients, the tab\'s one write is the request, and the tab owns no route of its own', () => {
  const tab = read('frontend/src/pages/subsidiary/licence/ProgramsTab.jsx');
  const sheet = read('frontend/src/pages/subsidiary/licence/ProgramRequestSheet.jsx');
  const terms = read('frontend/src/pages/subsidiary/licence/ProgramTermsDialog.jsx');
  for (const [f, src] of [['tab', tab], ['sheet', sheet], ['terms', terms]]) {
    assert.doesNotMatch(src, /from '\.\.\/\.\.\/\.\.\/lib\/api';/, `${f} imports module clients, not lib/api`);
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)/, `${f}: in-page dialogs only`);
  }
  assert.doesNotMatch(tab + terms, /method: ['"](POST|PUT|PATCH|DELETE)|\.raise\(/, 'the tab and the terms write nothing');
  assert.match(sheet, /api\.raise\(built\.body\)/, 'the sheet sends through D799\'s module');
  assert.ok(read('frontend/src/pages/subsidiary/licence/RequestsTab.jsx').includes("{ id: 'program', t: 'Request a program', kind: 'program_grant' }"));
});
