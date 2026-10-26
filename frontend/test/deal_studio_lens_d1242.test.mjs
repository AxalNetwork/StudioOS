/**
 * D1242 (#3255, part 6 of #2423) — Deal flow's Studio lens at /deals for an
 * admin or an Operating Partner (DLS11, DLS11b, DLS12), replacing DealsPage.
 * The fixtures are made up; each expected figure is worked out from them in
 * the comments. Mounted on a stubbed fetch, with a failed read in each block.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_studio_lens_d1242.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  LENS_COLUMNS, PARTNER_NOTE, PASS_CLOSES, columnSummary, intakeNotice, investorsLine, lensRows, nextStatus,
  notRaisingLine, rowActions, studioRow, studioViewHref, studioViewOf,
} from '../src/pages/investor/dealflow/studioLensModel.js';
import StudioLens from '../src/pages/investor/dealflow/StudioLens.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ── The fixtures ──────────────────────────────────────────────────────────────
// Alpha (In intake, $500K, led by the partner, 2 invited · 1 interested · 1 committed),
// Beta (Screened, no ask, led by someone else, not invited), Gamma (Raising, $1.5M),
// and three Not raising: Delta passed by Ada Admin, Epsilon set by intake, Zeta untraced.
const inv = (invited, interested, committed) => ({ invited, interested, committed });
const R = (o) => ({ currency: 'USD', terms: {}, investors: inv(0, 0, 0), you_lead: false, can_move: false, not_raising_by: null, passed_by_name: null, ...o });
const ROWS = [
  R({ id: 71, project_name: 'Alpha', project_sector: 'Robotics', status: 'applied', amount: 500000, source: 'Founder applied', lead_partner_name: 'Pat Partner', investors: inv(2, 1, 1), you_lead: true, can_move: true, days_in_stage: 3 }),
  R({ id: 72, project_name: 'Beta', project_sector: 'Health', status: 'scored', amount: null, lead_partner_name: 'Olu Other' }),
  R({ id: 73, project_name: 'Gamma', status: 'active', amount: 1500000, source: 'Studio sourced', investors: inv(6, 2, 1) }),
  R({ id: 74, project_name: 'Delta', status: 'rejected', not_raising_by: 'person', passed_by_name: 'Ada Admin' }),
  R({ id: 75, project_name: 'Epsilon', status: 'rejected', not_raising_by: 'intake' }),
  R({ id: 76, project_name: 'Zeta', status: 'rejected', not_raising_by: 'not_recorded' }),
];
const asAdmin = ROWS.map((r) => ({ ...r, can_move: true, you_lead: false }));

// ── The model ─────────────────────────────────────────────────────────────────

test('the address: Board by default, Table, Not raising and intake\'s alone, each a link', () => {
  // Mutations checked: `by=intake` honoured without Not raising; the default view written into the address.
  assert.deepEqual(studioViewOf(''), { view: 'board', notRaising: false, intakeOnly: false });
  assert.deepEqual(studioViewOf('?view=table&round=not_raising&by=intake'), { view: 'table', notRaising: true, intakeOnly: true });
  assert.equal(studioViewOf('?by=intake').intakeOnly, false);
  assert.equal(studioViewHref({}), '/deals');
  assert.equal(studioViewHref({ view: 'table', notRaising: true, intakeOnly: true }), '/deals?view=table&round=not_raising&by=intake');
});

test('a row, the investors line, and who set Not raising: intake never reads as a pass, a missing count never as 0', () => {
  // Mutations checked: intake worded as a pass; null counts drawn as "0 invited"; a missing ask read as 0.
  const a = studioRow(ROWS[0]);
  assert.deepEqual([a.round, a.ask, a.lead, a.youLead, a.canMove], ['In intake', 500000, 'Pat Partner', true, true]);
  assert.equal(studioRow(ROWS[1]).ask, null);
  assert.equal(investorsLine(a.investors), '2 invited · 1 interested · 1 committed');
  assert.equal(investorsLine(inv(0, 0, 0)), 'Not invited yet');
  assert.equal(investorsLine(inv(null, 0, 0)), null);
  assert.equal(notRaisingLine(studioRow(ROWS[4])), 'Set to Not raising by intake scoring, not by a person');
  assert.ok(!/pass/i.test(notRaisingLine(studioRow(ROWS[4]))), 'an intake row reads as a pass');
  assert.equal(notRaisingLine(studioRow(ROWS[3])), 'Passed by Ada Admin');
  assert.equal(notRaisingLine(studioRow(ROWS[5])), 'Who set it is not recorded');
  assert.equal(notRaisingLine(a), null);
});

test('the menu: moves only where the round may be moved; Invite for an admin on Screened or Raising; nothing past Funded', () => {
  // Mutations checked: Advance offered without can_move; Invite offered to a partner; Pass on a Not raising round.
  const keys = (row, role) => rowActions(studioRow(row), role).map((x) => x.key);
  assert.deepEqual(keys(ROWS[0], 'partner'), ['advance', 'pass', 'terms'], 'the round the partner leads');
  assert.deepEqual(keys(ROWS[1], 'partner'), [], 'a round another partner leads: no menu');
  assert.deepEqual(keys(asAdmin[1], 'admin'), ['advance', 'pass', 'invite', 'terms']);
  assert.equal(rowActions(studioRow(asAdmin[1]), 'admin').find((x) => x.key === 'invite').href, '/deals/72/invitations');
  assert.deepEqual(keys({ ...asAdmin[2], status: 'funded' }, 'admin'), ['pass', 'terms']);
  assert.deepEqual(keys(asAdmin[3], 'admin'), ['terms']);
  assert.deepEqual(LENS_COLUMNS.map(nextStatus), ['scored', 'active', 'funded', null]);
});

test('the notice, the filters and the column heads', () => {
  // Mutations checked: a zero notice; Not raising rows on the board; the search missing the lead; an unrecorded ask summed as 0.
  assert.equal(intakeNotice(0), null);
  assert.equal(intakeNotice(1), '1 round was set to Not raising by intake scoring, not by a person.');
  assert.equal(intakeNotice(4), '4 rounds were set to Not raising by intake scoring, not by a person.');
  const rows = ROWS.map(studioRow);
  assert.deepEqual(lensRows(rows).map((r) => r.name), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(lensRows(rows, { notRaising: true }).map((r) => r.name), ['Delta', 'Epsilon', 'Zeta']);
  assert.deepEqual(lensRows(rows, { notRaising: true, intakeOnly: true }).map((r) => r.name), ['Epsilon']);
  assert.deepEqual(lensRows(rows, { q: 'olu' }).map((r) => r.name), ['Beta']);
  assert.deepEqual(columnSummary(lensRows(rows).slice(0, 2)), { count: 2, asks: [{ currency: 'USD', total: 500000 }], none: 1 });
});

// ── The lens, mounted ────────────────────────────────────────────────────────

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const STAGE = { stages: [{ stage: 'applied', entered: 3, advanced: 1, conversion: 33.3, avg_days: 4 }], events_counted: 4, recording_started_at: '2026-09-01 00:00:00', covers_full_window: true };
const PASSES = { total: 2, buckets: [{ reason: 'valuation', label: 'Valuation', count: 1, pct: 50 }], unrecorded: 1, unrecorded_note: null, intake_not_raising: 1, deals: [] };
function stub(rows, over = {}) {
  const original = globalThis.fetch;
  const seen = [];
  const routes = {
    'GET /api/deals/studio': () => json({ rows, intake_not_raising: rows.filter((r) => r.not_raising_by === 'intake').length }),
    'GET /api/deals/stage-analytics': () => json(STAGE),
    'GET /api/deals/pass-analytics': () => json(PASSES),
    ...over,
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = (init.method || 'GET').toUpperCase();
    seen.push({ method, path: u.pathname, body: init.body ? JSON.parse(init.body) : null });
    const r = routes[`${method} ${u.pathname}`];
    return r ? r() : json({ detail: 'not stubbed' }, 404);
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

async function mount(props) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(StudioLens, props))); });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props_ = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props_(n)?.['data-testid'] === id);
  const node = (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    of: (id) => textOf(node(id)),
    has: (id) => Boolean(byTestId(id)),
    props: (id) => props_(node(id)),
    all: () => textOf(container),
    async click(id) { await act(async () => props_(node(id)).onClick()); await settle(); },
    async clickText(text) {
      const n = walk(container).find((x) => (x.tagName === 'BUTTON') && textOf(x).trim() === text);
      assert.ok(n, `no "${text}"`); await act(async () => props_(n).onClick()); await settle();
    },
    async radio(value) {
      const n = walk(container).find((x) => x.tagName === 'INPUT' && props_(x)?.value === value);
      assert.ok(n, `no radio ${value}`); await act(async () => props_(n).onChange()); await settle();
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const BOARD = { view: 'board', notRaising: false, intakeOnly: false };
const TABLE = { view: 'table', notRaising: false, intakeOnly: false };

test('mounted for an admin: the board on the round\'s status, the intake notice, Draft a deal, and the panels below', async () => {
  // Mutations checked: Not raising drawn as a column; the notice without its Review link; the partner note shown to an admin.
  const s = stub(asAdmin);
  const v = await mount({ role: 'admin', view: BOARD });
  try {
    assert.match(v.of('studio-lens'), /Studio › Deal flow.*Every round on the platform, how it scores, and who is looking at it\./s);
    assert.ok(v.has('studio-draft'));
    assert.match(v.of('studio-col-applied'), /In intake\s*1.*\$500K in asks.*Alpha.*Founder applied.*2 invited · 1 interested · 1 committed/s);
    assert.match(v.of('studio-col-scored'), /Screened\s*1.*1 with none recorded.*Beta.*Not invited yet/s);
    assert.ok(!v.has('studio-col-rejected') && !/Delta/.test(v.of('studio-board')), 'Not raising is a filter, not a column');
    assert.match(v.of('studio-intake-notice'), /1 round was set to Not raising by intake scoring, not by a person\..*Review them/s);
    assert.equal(v.props('studio-intake-review').href, '/deals?view=table&round=not_raising&by=intake');
    assert.ok(!v.has('studio-partner-note'));
    assert.match(v.of('stage-analytics'), /Stage funnel/);
    assert.match(v.of('pass-intake-apart'), /1 round set to Not raising by intake scoring is not counted here: intake is not a pass\./);
    await v.click('studio-menu-72');
    assert.match(v.of('studio-menu-72-list'), /Advance.*Pass….*Invite investors.*Edit terms/s);
    assert.equal(v.props('studio-menu-72-invite').href, '/deals/72/invitations');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted for an Operating Partner: read only, moves only on the round they lead', async () => {
  // Mutations checked: a menu on a round another partner leads; the "You lead this" pill missing; Draft offered to a partner.
  const s = stub(ROWS);
  const v = await mount({ role: 'partner', view: TABLE });
  try {
    assert.equal(v.of('studio-partner-note'), PARTNER_NOTE);
    assert.ok(!v.has('studio-draft'));
    assert.match(v.of('studio-row-71'), /Alpha.*You lead this.*In intake.*\$500K.*You.*2 invited · 1 interested · 1 committed.*Founder applied/s);
    assert.ok(v.has('studio-menu-71'));
    assert.ok(!v.has('studio-menu-72') && !v.has('studio-menu-73'), 'a move menu on a round they do not lead');
    assert.match(v.of('studio-row-72'), /Beta.*Screened.*Not recorded.*Olu Other.*Not invited yet/s);
  } finally { await v.unmount(); s.restore(); }
});

test('Advance says where the round goes, writes only on Move, and a refusal stays in the dialog', async () => {
  // Mutations checked: the write on opening the dialog; the dialog closed on a refusal; the lens not read again.
  let refuse = true;
  const s = stub(asAdmin, { 'POST /api/deals/72/advance': () => (refuse ? json({ code: 'not_your_round', detail: 'You can move only the rounds you lead. The studio moves the rest.' }, 403) : json({ id: 72, status: 'active' })) });
  const v = await mount({ role: 'admin', view: BOARD });
  try {
    await v.click('studio-menu-72');
    await v.click('studio-menu-72-advance');
    assert.match(v.of('studio-advance'), /Move Beta to Raising\?.*Beta moves from Screened to Raising for every investor, and the founder is told\./s);
    assert.equal(s.seen.filter((x) => x.method === 'POST').length, 0, 'written before Move');
    await v.click('studio-advance-go');
    assert.match(v.of('studio-advance-refusal'), /You can move only the rounds you lead\./);
    assert.ok(!v.has('studio-done'));
    refuse = false;
    const reads = s.seen.filter((x) => x.path === '/api/deals/studio').length;
    await v.click('studio-advance-go');
    assert.ok(!v.has('studio-advance'));
    assert.equal(v.of('studio-done'), 'Beta moved to Raising.');
    assert.ok(s.seen.filter((x) => x.path === '/api/deals/studio').length > reads, 'the lens was not read again');
  } finally { await v.unmount(); s.restore(); }
});

test('Pass closes the round for every investor, needs a reason, and posts it', async () => {
  // Mutations checked: the closing line dropped; Record pass enabled with no reason; the reason not sent.
  const s = stub(asAdmin, { 'POST /api/deals/73/pass': () => json({ id: 73, status: 'rejected' }) });
  const v = await mount({ role: 'admin', view: BOARD });
  try {
    await v.click('studio-menu-73');
    await v.click('studio-menu-73-pass');
    assert.equal(v.of('pass-closes'), PASS_CLOSES);
    await v.clickText('Select a reason to continue');
    assert.equal(s.seen.filter((x) => x.method === 'POST').length, 0, 'a pass with no reason');
    await v.radio('valuation');
    await v.clickText('Record pass · Valuation');
    assert.deepEqual(s.seen.find((x) => x.method === 'POST'), { method: 'POST', path: '/api/deals/73/pass', body: { reason: 'valuation', note: '' } });
    assert.match(v.of('studio-done'), /Gamma is Not raising\. The round is closed for every investor, and the founder is told\./);
  } finally { await v.unmount(); s.restore(); }
});

test('Not raising, and intake\'s alone: who set each, and an intake row never reads as a pass', async () => {
  // Mutations checked: the Set by column missing; the intake filter ignored.
  let s = stub(asAdmin);
  let v = await mount({ role: 'admin', view: { view: 'table', notRaising: true, intakeOnly: false } });
  try {
    assert.equal(v.of('studio-set-by-74'), 'Passed by Ada Admin');
    assert.equal(v.of('studio-set-by-75'), 'Set to Not raising by intake scoring, not by a person');
    assert.equal(v.of('studio-set-by-76'), 'Who set it is not recorded');
    assert.ok(!v.has('studio-row-71'), 'a raising round under Not raising');
  } finally { await v.unmount(); s.restore(); }
  s = stub(asAdmin);
  v = await mount({ role: 'admin', view: { view: 'table', notRaising: true, intakeOnly: true } });
  try {
    assert.ok(v.has('studio-row-75'));
    assert.ok(!v.has('studio-row-74') && !v.has('studio-row-76'));
  } finally { await v.unmount(); s.restore(); }
});

test('a failed read says so in its own block; the header, toolbar and the other blocks still draw', async () => {
  // Mutations checked: a failed lens read drawn as "No round is listed"; one failure blanking the panels.
  const s = stub(asAdmin, {
    'GET /api/deals/studio': () => json({ detail: 'down' }, 503),
    'GET /api/deals/stage-analytics': () => json({ detail: 'down' }, 503),
  });
  const v = await mount({ role: 'admin', view: BOARD });
  try {
    assert.match(v.of('studio-failed'), /The rounds could not be read\. That is not the same as having none\./);
    assert.ok(!v.has('studio-empty') && !v.has('studio-board'));
    assert.ok(v.has('studio-toolbar'));
    assert.match(v.all(), /The stage funnel could not be read\. That is not the same as no moves\./);
    assert.match(v.all(), /Why we passed/, 'the pass panel was blanked by another block');
  } finally { await v.unmount(); s.restore(); }
});

// ── The sources ───────────────────────────────────────────────────────────────

test('DealsPage is retired: /deals mounts the lens for an admin or a partner, and no browser pop-up', () => {
  assert.equal(existsSync(resolve(process.cwd(), 'frontend/src/pages/DealsPage.jsx')), false);
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes("effectiveRole === 'investor' ? <InvestorDealsRoutes /> : <StudioLensRoute role={effectiveRole} />"));
  assert.ok(!/DealsPage'\)/.test(app), 'DealsPage is still imported');
  for (const f of ['StudioLens.jsx', 'StudioParts.jsx', 'studioLensModel.js']) {
    assert.ok(!/\b(?:window\.)?(alert|confirm|prompt)\(/.test(read(`frontend/src/pages/investor/dealflow/${f}`)), `a browser pop-up in ${f}`);
  }
  assert.ok(read('frontend/src/lib/api.js').includes("export * from './api/dealFlow.js';"));
});
