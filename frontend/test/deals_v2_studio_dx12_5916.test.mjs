/**
 * D5916 (#5916, Deals v2 board DE12, canvas section DX12) — the Studio lens of
 * /deals for an admin or an Operating Partner, redrawn: the stage strip, the
 * Needs attention strip, the Table by default with the canvas's columns, and
 * Advance on the row with More (Pass, Invite investors, Edit terms) only where
 * `can_move` allows. Every count comes from `GET /api/deals/studio` as it is.
 * The fixtures are made up; each expected figure is worked out in a comment.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_studio_dx12_5916.test.mjs
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
  ATTENTION, ATTENTION_NOT_COUNTED, STAGE_STRIP, TABLE_COLUMNS, attentionChip, attentionCounts, attentionOf, committedLine,
  lensRows, splitActions, stageCounts, studioRow, studioViewHref, studioViewOf,
} from '../src/pages/investor/dealflow/studioLensModel.js';
import StudioLens from '../src/pages/investor/dealflow/StudioLens.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ── The fixtures ──────────────────────────────────────────────────────────────
// A (In intake, no lead, 40 days): no owner + stale (standard red is 30d).
// B (Screened, led by the partner, ask but no instrument, 2 days): terms missing.
// C (Raising, led by someone else, every term, 31 days): stale.
// D (Raising, led by someone else, no ask, no lead, 5 days): no owner + terms missing.
// E (Funded, no lead, 90 days): nothing, a funded round needs no owner and is not stale.
// F (Not raising, no lead, 200 days): nothing.
const inv = (invited, interested, committed) => ({ invited, interested, committed });
const FULL = { instrument: 'SAFE', minimum_check: 25000 };
const R = (o) => ({ currency: 'USD', investors: inv(0, 0, 0), you_lead: false, can_move: false, lead_partner_id: null, lead_partner_name: null, not_raising_by: null, ...o });
const ROWS = [
  R({ id: 1, project_name: 'Venture A', status: 'applied', amount: 300000, terms: {}, days_in_stage: 40 }),
  R({ id: 2, project_name: 'Venture B', status: 'scored', target_raise: 800000, terms: { minimum_check: 10000 }, lead_partner_id: 9, lead_partner_name: 'Pat Partner', you_lead: true, can_move: true, days_in_stage: 2, investors: inv(3, 1, 0) }),
  R({ id: 3, project_name: 'Venture C', status: 'active', target_raise: 1500000, terms: FULL, lead_partner_id: 8, lead_partner_name: 'Olu Other', days_in_stage: 31, investors: inv(6, 2, 1) }),
  R({ id: 4, project_name: 'Venture D', status: 'active', terms: FULL, days_in_stage: 5 }),
  R({ id: 5, project_name: 'Venture E', status: 'funded', amount: 900000, terms: FULL, days_in_stage: 90 }),
  R({ id: 6, project_name: 'Venture F', status: 'rejected', terms: {}, days_in_stage: 200, not_raising_by: 'person' }),
];
const rows = ROWS.map(studioRow);
const asAdmin = ROWS.map((r) => ({ ...r, can_move: true, you_lead: false }));

// ── The model ─────────────────────────────────────────────────────────────────

test('the stage strip counts every round by status, Not raising included, in the canvas order', () => {
  // Mutations checked: Not raising left out; a status counted under its neighbour.
  assert.deepEqual(STAGE_STRIP, ['applied', 'scored', 'active', 'funded', 'rejected']);
  assert.deepEqual(stageCounts(rows), { applied: 1, scored: 1, active: 2, funded: 1, rejected: 1 });
  assert.deepEqual(stageCounts([]), { applied: 0, scored: 0, active: 0, funded: 0, rejected: 0 });
});

test('Needs attention: each count is a rule over the read, and only open rounds carry one', () => {
  // Mutations checked: a funded round counted as no owner; stale at the amber band; terms missing on In intake; a lead name alone read as no owner.
  assert.deepEqual(rows.map((r) => attentionOf(r)), [['no_owner', 'stale'], ['terms_missing'], ['stale'], ['no_owner', 'terms_missing'], [], []]);
  assert.deepEqual(attentionCounts(rows), { no_owner: 2, stale: 2, terms_missing: 2 });
  // The viewer's Stage SLA moves Stale: tight's red is 14d, relaxed's 45d.
  assert.equal(attentionCounts(rows, 'tight').stale, 2);
  assert.equal(attentionCounts(rows, 'relaxed').stale, 0);
  assert.equal(attentionCounts(rows.map((r) => ({ ...r, daysInStage: null }))).stale, 0, 'an unknown age is not stale');
  assert.deepEqual(attentionOf(studioRow({ status: 'active', lead_partner_name: 'Named', target_raise: 1, terms: FULL })), []);
  assert.deepEqual(attentionOf(studioRow({ status: 'applied', lead_partner_id: 7, lead_partner_name: null, days_in_stage: 1 })), [], 'a lead whose name is not recorded is still an owner');
  assert.equal(attentionChip('no_owner', 2), '2 no owner');
  assert.equal(attentionChip('terms_missing', 1), '1 terms missing');
  assert.deepEqual(ATTENTION.map((a) => a.key), ['no_owner', 'stale', 'terms_missing']);
  // The canvas's other two have no field in this read: named, never drawn.
  assert.deepEqual(ATTENTION_NOT_COUNTED.map((a) => a.label), ['Investor waiting', 'Closing blocked']);
});

test('the address: a stage and an attention filter, each a link; Not raising drops both', () => {
  // Mutations checked: an unknown attention key honoured; a stage kept under Not raising; Board not written.
  assert.deepEqual(studioViewOf('?round=active&attention=stale'), { view: 'table', notRaising: false, intakeOnly: false, stage: 'active', attention: 'stale' });
  assert.equal(studioViewOf('?attention=investor_waiting').attention, null);
  assert.equal(studioViewOf('?round=rejected').stage, null);
  assert.deepEqual(studioViewOf('?round=not_raising&attention=stale'), { view: 'table', notRaising: true, intakeOnly: false, stage: null, attention: null });
  assert.equal(studioViewHref({ view: 'board', stage: 'scored', attention: 'no_owner' }), '/deals?view=board&round=scored&attention=no_owner');
  assert.equal(studioViewHref({ notRaising: true, stage: 'scored', attention: 'no_owner' }), '/deals?round=not_raising');
  assert.deepEqual(lensRows(rows, { attention: 'no_owner' }).map((r) => r.id), ['1', '4']);
  assert.deepEqual(lensRows(rows, { stage: 'active', attention: 'stale' }).map((r) => r.id), ['3']);
  assert.deepEqual(lensRows(rows, { stage: 'active' }).map((r) => r.id), ['3', '4']);
});

test('row actions: Advance on the row, the rest under More, nothing where the caller may not move the round', () => {
  // Mutations checked: Advance left in More; More offered to a partner on a round they do not lead; Invite to a partner.
  const keys = (r, role) => { const s = splitActions(studioRow(r), role); return [s.primary?.key || null, s.more.map((m) => m.key)]; };
  assert.deepEqual(keys(asAdmin[2], 'admin'), ['advance', ['pass', 'invite', 'terms']]);
  assert.deepEqual(keys(ROWS[1], 'partner'), ['advance', ['pass', 'terms']], 'the round the partner leads');
  assert.deepEqual(keys(ROWS[2], 'partner'), [null, []], 'a round someone else leads');
  assert.deepEqual(keys(asAdmin[4], 'admin'), [null, ['pass', 'terms']], 'Funded: nothing to advance to');
  assert.equal(committedLine(rows[2]), '1 investor');
  assert.equal(committedLine(studioRow({ investors: inv(4, 0, 3) })), '3 investors');
  assert.equal(committedLine(studioRow({ investors: inv(null, null, null) })), null);
});

// ── The lens, mounted ────────────────────────────────────────────────────────

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function stub(list, over = {}) {
  const original = globalThis.fetch;
  const routes = {
    'GET /api/deals/studio': () => json({ rows: list, intake_not_raising: 0 }),
    'GET /api/deals/stage-analytics': () => json({ stages: [], events_counted: 0, covers_full_window: true }),
    'GET /api/deals/pass-analytics': () => json({ total: 0, buckets: [], unrecorded: 0, intake_not_raising: 0, deals: [] }),
    'POST /api/venture-scores/batch': () => json({ items: [] }),
    ...over,
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const r = routes[`${(init.method || 'GET').toUpperCase()} ${u.pathname}`];
    return r ? r() : json({ detail: 'not stubbed' }, 404);
  };
  return { restore() { globalThis.fetch = original; } };
}

async function mount(props, { phone = false } = {}) {
  const restore = installDocument();
  const hadMatch = globalThis.matchMedia;
  if (phone) globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(StudioLens, props))); });
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props_ = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props_(n)?.['data-testid'] === id);
  const node = (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    of: (id) => textOf(node(id)),
    has: (id) => Boolean(byTestId(id)),
    props: (id) => props_(node(id)),
    heads: () => walk(container).filter((n) => n.tagName === 'TH').map(textOf),
    async unmount() { await act(async () => root.unmount()); if (phone) globalThis.matchMedia = hadMatch; restore(); },
  };
}

test('mounted for an admin: the Table by default, both strips from the read, the canvas columns and the foot', async () => {
  // Mutations checked: the board drawn by default; a strip counted from the filtered rows; a column out of order; Committed drawn as 0.
  const s = stub(asAdmin);
  const v = await mount({ role: 'admin', view: studioViewOf('') });
  try {
    assert.ok(v.has('studio-table') && !v.has('studio-board'));
    assert.match(v.of('studio-stages'), /In intake\s*1\s*Screened\s*1\s*Raising\s*2\s*Funded\s*1\s*Not raising\s*1/);
    assert.equal(v.of('studio-attention'), 'Needs attention2 no owner2 stale2 terms missing');
    assert.equal(v.props('studio-attention-stale').href, '/deals?attention=stale');
    assert.deepEqual(v.heads().slice(0, 10), TABLE_COLUMNS);
    assert.deepEqual(TABLE_COLUMNS, ['Company', 'Round status', 'Scorecard', 'Lead', 'Investors', 'Ask', 'Committed', 'Source', 'Days', 'Attention']);
    assert.match(v.of('studio-committed-3'), /^1 investorNot recorded$/);
    assert.doesNotMatch(v.of('studio-committed-3'), /\$0/);
    assert.equal(v.of('studio-attention-4'), 'No ownerTerms missing');
    assert.ok(!v.has('studio-attention-5'), 'a funded round flagged');
    assert.ok(!v.has('studio-row-6'), 'a Not raising round in the open table');
    assert.ok(v.has('studio-row-advance-3') && v.has('studio-menu-3'));
    assert.match(v.of('studio-partner-foot'), /Operating Partners see the same table; actions appear only on rounds they lead\./);
    assert.equal(v.props('studio-stage-rejected').href, '/deals?round=not_raising');
    assert.equal(v.props('studio-stage-active').href, '/deals?round=active');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted for an Operating Partner: the same read, actions only on the round they lead', async () => {
  // Mutations checked: Advance on a round someone else leads; the admin foot shown to a partner; different counts for a partner.
  const s = stub(ROWS);
  const v = await mount({ role: 'partner', view: studioViewOf('') });
  try {
    assert.equal(v.of('studio-attention'), 'Needs attention2 no owner2 stale2 terms missing');
    assert.ok(v.has('studio-row-advance-2') && v.has('studio-menu-2'));
    for (const id of [1, 3, 4, 5]) assert.ok(!v.has(`studio-row-advance-${id}`) && !v.has(`studio-menu-${id}`), `an action on round ${id}`);
    assert.ok(!v.has('studio-partner-foot'));
    assert.ok(v.has('studio-partner-note'));
  } finally { await v.unmount(); s.restore(); }
});

test('an attention filter narrows the rows; a zero chip filters nothing; Board keeps the strips', async () => {
  // Mutations checked: the filter ignored; a zero chip drawn as a link.
  let s = stub(asAdmin);
  let v = await mount({ role: 'admin', view: studioViewOf('?attention=no_owner') });
  try {
    assert.ok(v.has('studio-row-1') && v.has('studio-row-4'));
    assert.ok(!v.has('studio-row-2') && !v.has('studio-row-3'));
    assert.equal(v.of('studio-attention'), 'Needs attention2 no owner2 stale2 terms missing', 'the strip counted over the filtered rows');
    assert.equal(v.props('studio-attention-no_owner')['aria-current'], 'true');
    assert.equal(v.props('studio-attention-no_owner').href, '/deals');
  } finally { await v.unmount(); s.restore(); }
  s = stub(asAdmin.filter((r) => r.id === 3).map((r) => ({ ...r, days_in_stage: 1 })));
  v = await mount({ role: 'admin', view: studioViewOf('?view=board') });
  try {
    assert.ok(v.has('studio-board') && v.has('studio-stages'));
    assert.equal(v.of('studio-attention'), 'Needs attention0 no owner0 stale0 terms missing');
    assert.equal(v.props('studio-attention-stale').href, undefined, 'a zero chip is a link');
  } finally { await v.unmount(); s.restore(); }
});

test('a failed read draws neither strip and never a zero; loading is the layout in skeleton', async () => {
  // Mutations checked: the strips drawn with zeros over a failed read.
  const s = stub(asAdmin, { 'GET /api/deals/studio': () => json({ detail: 'down' }, 503) });
  const v = await mount({ role: 'admin', view: studioViewOf('') });
  try {
    assert.match(v.of('studio-failed'), /The rounds could not be read\./);
    assert.ok(!v.has('studio-stages') && !v.has('studio-attention'));
  } finally { await v.unmount(); s.restore(); }
  assert.match(read('frontend/src/pages/investor/dealflow/StudioLens.jsx'), /function LensSkeleton\(\)[\s\S]*STAGE_STRIP\.map/);
});

test('on a phone the table is cards: nothing wider than the screen, the same actions', async () => {
  // Mutations checked: the 1080px table drawn on a phone.
  const s = stub(asAdmin);
  const v = await mount({ role: 'admin', view: studioViewOf('') }, { phone: true });
  try {
    assert.ok(v.has('studio-card-3'));
    assert.ok(!v.has('studio-row-3'), 'the wide table on a phone');
    assert.ok(v.has('studio-row-advance-3'));
    assert.equal(v.of('studio-card-attention-1'), 'No ownerStale');
  } finally { await v.unmount(); s.restore(); }
});
