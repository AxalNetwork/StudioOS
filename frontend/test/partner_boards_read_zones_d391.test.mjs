/**
 * D391 — the partner bucket boards read what their zones read, and stop
 * saying things the stores contradict.
 *
 *   · Pipeline · Lead sources read `listNeeds()` and said a source and a match
 *     score did not exist. `LeadsZone` reads `listPartnerLeads()`, which returns
 *     both. The board now reads the same call.
 *   · Delivery · Engagement health said "no satisfaction input exists anywhere"
 *     and drew three of the artboard's five columns. Migration 232 holds a
 *     stated scope and a sourced satisfaction score; the section now has the
 *     artboard's columns.
 *   · Research · the library footnote told an advisor nobody can send them a
 *     document (false since migration 218), and the Markets card described the
 *     signals feed that zone no longer is.
 *
 * Each test drives the real registry with a fake `api` and a payload, so it
 * pins what reaches the screen, not the wording of a line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boardFor } from '../src/workspaces/boards/index.js';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CANVAS = raw('design/canvases/backlog/Partner Operator Canvas.dc.html');

/** A fake API that records which methods a source called. */
function spyApi() {
  const calls = [];
  const api = new Proxy({}, {
    get: (_, name) => (name === 'research'
      ? { documents: () => { calls.push('research.documents'); return Promise.resolve({}); } }
      : () => { calls.push(String(name)); return Promise.resolve({}); }),
  });
  return { api, calls };
}

const section = (board, slug) => {
  const s = board.sections.find((x) => x.slug === slug);
  assert.ok(s, `section ${slug} exists`);
  return s;
};

/** The `<span class="th">` headings of the canvas table that follows `marker`. */
function canvasHeadings(marker) {
  const at = CANVAS.indexOf(marker);
  assert.ok(at > 0, `canvas marker ${marker} not found`);
  const row = CANVAS.slice(at, CANVAS.indexOf('\n', at));
  return [...row.matchAll(/<span class="th">([^<]*)<\/span>/g)].map((m) => m[1]);
}

// ── Pipeline · Lead sources ────────────────────────────────────────────────

test('D391: the Pipeline board\'s leads read the Leads zone\'s endpoint, not the raw needs list', async () => {
  const { api, calls } = spyApi();
  const board = boardFor('partner', '/pipeline', api);
  const leads = section(board, 'leads');
  await board.sources[leads.source]();
  assert.deepEqual(calls, ['listPartnerLeads']);
  assert.ok(!Object.values(board.sources).some((f) => String(f).includes('listNeeds')),
    'no board source may read listNeeds any more');
  // The zone reads the same method, so the two cannot show different lists.
  assert.match(codeOnly(raw('frontend/src/pages/partner/pipeline/LeadsZone.jsx')), /api\.listPartnerLeads\(\)/);
});

test('D391: a lead row carries its source, its match and the receipts behind it', () => {
  const { api } = spyApi();
  const leads = section(boardFor('partner', '/pipeline', api), 'leads');
  const payload = {
    open_count: 3,
    strong_fit_count: null,
    scoring_note: 'This firm has stated no fit rule and listed no service, so there is nothing to score a lead against.',
    items: [
      { title: 'Pricing sprint', source_label: 'Marketplace need', score: 75, excluded_by: null,
        budget_min: 5000, budget_max: 8000, receipts: [{ label: 'Pricing · offered', kind: 'hit' }] },
      { title: 'Native app', source_label: 'Marketplace need', score: null, excluded_by: 'We do not build native apps.',
        budget_min: null, budget_max: null, receipts: [{ label: 'native · excluded', kind: 'miss' }] },
      { title: 'Brand refresh', source_label: 'Marketplace need', score: null, excluded_by: null,
        budget_min: null, budget_max: 2000, receipts: [] },
    ],
  };
  const rows = leads.rows(payload);
  assert.deepEqual(rows[0], ['Pricing sprint', 'Marketplace need', 75, '$5,000–$8,000', 'Pricing · offered']);
  assert.equal(rows[1][2], 'Excluded', 'an exclusion is not a low score');
  assert.equal(rows[1][4], 'We do not build native apps.', 'an exclusion quotes the firm\'s own rule');
  assert.equal(rows[2][2], null, 'an unscored lead is absent, never zero');
  assert.equal(rows[2][4], null);
  assert.equal(leads.summary(payload), '3 open leads', 'a null strong-fit count drops out rather than reading 0');
  assert.equal(leads.footnote(payload), payload.scoring_note, 'the footnote is the worker\'s own sentence');
  // The artboard's five headings, one for one. The fifth is named for what it
  // holds: the canvas's "Read" is a written sentence nothing stores, and the
  // receipts are the stored reason behind the match.
  const canvas = canvasHeadings('<span class="th">Lead</span><span class="th">Source</span>');
  assert.deepEqual(leads.columns.slice(0, 4), canvas.slice(0, 4));
  assert.equal(leads.columns.length, canvas.length, 'one column per artboard heading');
});

// ── Delivery · Engagement health and capacity ──────────────────────────────

test('D391: the health section has the artboard\'s five columns', () => {
  const { api } = spyApi();
  const health = section(boardFor('partner', '/delivery', api), 'health');
  assert.deepEqual(health.columns, canvasHeadings('<span class="th">Client</span><span class="th">Scope vs SOW</span>'));
});

test('D391: scope and satisfaction come from the store, sourced, and never defaulted', () => {
  const { api } = spyApi();
  const health = section(boardFor('partner', '/delivery', api), 'health');
  const payload = {
    unrated_count: 1, drift_count: 1, scope_unassessed_count: 1,
    satisfaction_note: '1 of 2 engagements has no score, and averaging the rest would present 1 opinion as a firm-wide fact.',
    items: [
      { founder_name: 'Verwood', health: 'at_risk', scope_state: 'drift', satisfaction: 4.2,
        satisfaction_source: 'said on the QBR call', health_reasons: ['2 overdue milestones'] },
      { founder_name: 'Thornfield', health: 'on_track', scope_state: null, satisfaction: null,
        satisfaction_source: null, health_reasons: [] },
      { founder_name: 'Empty', health: null, scope_state: null, satisfaction: null },
    ],
  };
  const rows = health.rows(payload);
  assert.equal(rows.length, 2, 'a row with nothing recorded is not drawn as a rating');
  assert.deepEqual(rows[0], ['Verwood', 'Drift', 'At risk', '4.2 of five · said on the QBR call', '2 overdue milestones']);
  assert.equal(rows[1][1], null, 'an unassessed scope reads absent, never "Within"');
  assert.equal(rows[1][3], null, 'no score reads absent, never zero');
  assert.equal(health.summary(payload), '1 unrated · 1 drifting · 1 scope unassessed');
  const foot = health.footnote(payload);
  assert.ok(foot.includes(payload.satisfaction_note), 'the worker\'s reason for withholding the average is printed');
  assert.doesNotMatch(foot, /no satisfaction input/i);
});

test('D391: capacity counts people over a STATED cap, and nothing before one is stated', () => {
  const { api } = spyApi();
  const cap = section(boardFor('partner', '/delivery', api), 'capacity');
  const people = [{ name: 'A' }, { name: 'B' }];
  assert.equal(cap.summary({ people, over_committed_count: 1 }), '2 people · 1 over cap');
  assert.equal(cap.summary({ people, over_committed_count: null }), '2 people',
    'with no cap stated the over count is absent, not "0 over"');
});

test('D391: no delivery or bucket-route line still says the cap or satisfaction has no store', () => {
  const delivery = raw('frontend/src/workspaces/boards/partnerDelivery.js');
  const routes = raw('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');
  assert.doesNotMatch(delivery, /No satisfaction input exists anywhere, so/);
  assert.doesNotMatch(delivery, /nothing records the firm's CAP|No capacity cap is recorded anywhere in this\s+\*?\s*product\. Hours/);
  assert.doesNotMatch(routes, /nothing records the firm's CAP/);
});

// ── Research ───────────────────────────────────────────────────────────────

test('D391: the library footnote no longer tells an advisor nobody can send them a document', () => {
  const { api } = spyApi();
  for (const role of ['partner', 'advisor']) {
    const lib = section(boardFor(role, '/research', api), 'library');
    const foot = lib.footnote({});
    assert.doesNotMatch(foot, /Nobody can send you a document/, role);
    assert.match(foot, /Only what you uploaded yourself/, role);
  }
  const advisor = section(boardFor('advisor', '/research', api), 'library').footnote({});
  assert.match(advisor, /Client prep/, 'an advisor is told where a founder\'s granted files are read');
});

test('D391: the Markets card describes the zone it opens, not the signals feed', () => {
  const { api } = spyApi();
  for (const role of ['partner', 'advisor']) {
    const markets = section(boardFor(role, '/research', api), 'markets');
    assert.doesNotMatch(markets.blurb, /signal/i, role);
    assert.match(markets.blurb, /Comparable ranges/, role);
  }
  assert.match(raw('frontend/src/pages/research/MarketZone.jsx'), /comparable RANGES/,
    'if MarketZone stops being comparable ranges, this card must be revisited');
});
