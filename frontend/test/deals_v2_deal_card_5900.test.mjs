/**
 * D5900 (#5900, Deals v2 DX1b) — the deal card of boards DE01 and DE01b, the
 * three status families, and the one shared score component.
 *
 * Every card state here is built from read payloads in the Worker's shapes
 * (`GET /api/deals/flow`, `GET /api/deals`, `POST /api/venture-scores/batch`)
 * through the same `flowRows` and `scoresOf` the page uses.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_deal_card_5900.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { DealCard } from '../src/pages/investor/dealflow/DealCard.jsx';
import { ScopeScore } from '../src/pages/investor/dealflow/ScopeScore.jsx';
import { CARD_STATES, SCORE_FAMILY, cardStates, familiesOf, scoreView } from '../src/pages/investor/dealflow/dealCardModel.js';
import { flowRows, moveTargets, scopeCell, scoresOf } from '../src/pages/investor/dealflow/flowModel.js';

const read = (p) => readFileSync(p, 'utf8');
const h = React.createElement;
const DIGIT = /\d/;

// ---------------------------------------------------------------- fixtures, in the Worker's shapes

const entry = (o) => ({
  uid: `u${o.deal_id}`, deal_id: 1, venture: 'Acme Robotics', sector: 'Robotics', round_status: 'active', stage: 'screening',
  owner: { user_id: 5, name: 'Nadia Ahmed' }, entered_via: 'invited', entered_at: '2026-10-02 10:00:00', stage_changed_at: '2026-11-08',
  days_in_stage: 6, ask: 1500000, pass: null, note: null, can_open: true, ...o,
});
const FLOW = () => ({ scope: 'firm', by_stage: {}, items: [
  entry({ deal_id: 1 }), // normal
  entry({ deal_id: 2, venture: 'Harbor AI', sector: 'AI tooling' }), // low confidence
  entry({ deal_id: 3, venture: 'Lumen Grid', sector: 'Energy', stage: 'sourcing', days_in_stage: 3 }), // missing
  entry({ deal_id: 4, venture: 'Tessellate Bio', sector: 'Bio', stage: 'diligence', days_in_stage: 4 }), // locked
  entry({ deal_id: 5, venture: 'Harbor Stale', sector: 'AI tooling', days_in_stage: 18 }), // stale
  entry({ deal_id: 6, venture: 'Quayside Pay', sector: 'Fintech', stage: 'passed', days_in_stage: 40 }), // passed
  entry({ deal_id: 7, venture: 'Quayside Two', sector: 'Fintech', stage: 'sourcing', owner: null, days_in_stage: 2, can_open: false }), // unassigned
  entry({ deal_id: 8, venture: 'No Start', days_in_stage: null }), // stage start not recorded
] });
const DEALS = () => FLOW().items.map((f) => ({ id: f.deal_id, project_name: f.venture, project_sector: f.sector, status: 'active', currency: 'EUR', instrument: 'SAFE', target_raise: 1500000 }));
const sc = (scope, band, conf = 'High', state = 'scored') => ({ scope, state, band, confidence_word: conf });
const BATCH = () => ({ not_readable: 0, items: [
  { deal_id: 1, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Fair', 'Medium'), sc('geographic', 'Strong', 'Medium')] },
  { deal_id: 2, locked: false, scopes: [sc('team', 'Fair', 'Low'), sc('market', 'Weak', 'Low'), sc('geographic', 'Fair', 'Low')] },
  { deal_id: 3, locked: false, scopes: [sc('market', 'Fair', 'Medium'), sc('geographic', null, null, 'not_expected'), sc('pmf', null, null, 'not_enough')] },
  { deal_id: 4, locked: true, reason: 'The founder has not shared this scorecard with investors.' },
  { deal_id: 5, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Strong'), sc('geographic', 'Strong')] },
  { deal_id: 6, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Strong'), sc('geographic', 'Strong')] },
  { deal_id: 7, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Strong'), sc('geographic', 'Strong')] },
  { deal_id: 8, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Strong'), sc('geographic', 'Strong')] },
] });
const CARDS = ['team', 'market', 'geographic'];
const rows = (batch = BATCH()) => flowRows('mine', { flow: FLOW(), deals: DEALS() }).map((r) => ({ ...r, scores: scoresOf(batch, r.id), fit: null }));
const rowOf = (id, batch) => rows(batch).find((r) => r.id === String(id));

// ---------------------------------------------------------------- the score rule

test('the Worker’s batch read sends state, band and confidence per scope and no number, so the score is a band', () => {
  const route = read('cloudflare-worker/src/routes/venture_scores.ts');
  assert.match(route, /POST \/api\/venture-scores\/batch\s+→ the deal list's strip: state, band and confidence per scope/);
  assert.match(route, /scopes: stripView\(stored\)/, 'the batch answers with stripView');
  const access = read('cloudflare-worker/src/services/ventureScoring/access.ts');
  const strip = /export function stripView[^{]*\{\s*return scopes\.map\(\(s\) => \(\{([^}]*)\}\)\);/.exec(access);
  assert.ok(strip, 'stripView is found');
  assert.deepEqual(strip[1].split(',').map((x) => x.trim().split(':')[0]), ['scope', 'state', 'band', 'confidence_word'], 'no value, no change');
  // Nothing in the card or the shared score reads a figure off the batch.
  for (const f of ['dealCardModel.js', 'ScopeScore.jsx', 'DealCard.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/investor/dealflow/${f}`), /(?<!target)\.value\b|\.change\b|\.delta\b/, f);
  }
  const d = read('documentation/architecture/decisions/D5900.md');
  assert.match(d, /^## D5900 — .+ \(#5900\)$/m);
  for (const opt of [/\*\*A\.\*\*/, /\*\*B\.\*\*/, /\*\*C\.\*\*/]) assert.match(d, opt);
});

test('the shared score: announced with the Worker’s band and confidence only, never a figure, and each absence its own family', () => {
  const ok = scoresOf(BATCH(), 1);
  const team = scoreView(scopeCell(ok, 'team'), 'Team');
  assert.deepEqual([team.family, team.word, team.confidence, team.announce], ['value', 'Strong', 'High', 'Team: Strong, high confidence']);
  assert.equal(scoreView(scopeCell(scoresOf(BATCH(), 2), 'team'), 'Team').low, true, 'low confidence is marked');
  const cases = {
    missing: scopeCell(scoresOf(BATCH(), 3), 'team'),
    not_recorded: scopeCell(scoresOf(BATCH(), 3), 'pmf'),
    not_expected: scopeCell(scoresOf(BATCH(), 3), 'geographic'),
    unreadable: scopeCell(scoresOf({ items: [{ deal_id: 1, scopes: [sc('team', null, null, 'unreadable')] }] }, 1), 'team'),
    locked: scopeCell(scoresOf(BATCH(), 4), 'team'),
    not_shared: scopeCell(scoresOf(BATCH(), 99), 'team'),
  };
  const words = new Set();
  for (const [family, cell] of Object.entries(cases)) {
    const v = scoreView(cell, 'Team');
    assert.equal(v.family, family, family);
    assert.doesNotMatch(v.word, DIGIT, `${family}: a word, never 0`);
    assert.doesNotMatch(v.announce, DIGIT, family);
    words.add(v.word);
  }
  assert.equal(words.size, 6, 'six absences, six words');
  assert.equal(scoreView(scopeCell(scoresOf('failed', 1), 'team'), 'Team').announce, 'Team: Unreadable', 'a failed read is said as Unreadable');
  assert.equal(SCORE_FAMILY.not_scored, 'missing');
  for (const r of rows()) for (const k of CARDS) assert.doesNotMatch(scoreView(scopeCell(r.scores, k), 'Team').announce, DIGIT, `${r.id} ${k}`);
});

// ---------------------------------------------------------------- the card's states (DE01b)

test('the seven DE01b cards come from real read states', () => {
  const of = (id) => cardStates(rowOf(id), CARDS, scopeCell);
  assert.deepEqual(of(1), ['normal']);
  assert.deepEqual(of(2), ['low_confidence']);
  assert.deepEqual(of(3), ['missing'], 'Team not returned, Geographic not expected');
  assert.deepEqual(of(4), ['locked']);
  assert.deepEqual(of(5), ['stale'], '18 days is past the Standard SLA');
  assert.deepEqual(of(6), ['passed'], 'a passed card is never also stale');
  assert.deepEqual(of(7), ['unassigned']);
  assert.deepEqual(of(8), ['normal'], 'an unrecorded stage start is never stale');
  const seen = new Set([1, 2, 3, 4, 5, 6, 7].flatMap(of));
  assert.deepEqual([...seen].sort(), [...CARD_STATES].sort());
  assert.deepEqual(cardStates(rowOf(1, null), CARDS, scopeCell), ['normal'], 'scores still reading make no state');
});

test('three status families: company, my process and transaction, each its own field and shape', () => {
  const f = familiesOf(rowOf(1));
  assert.deepEqual([f.company.word, f.process.word, f.transaction.word], ['Not recorded', 'Screening', 'Raising']);
  assert.match(f.company.title, /does not carry the company’s stage/);
  assert.equal(familiesOf(rowOf(6)).process.word, 'Passed');
});

// ---------------------------------------------------------------- mounted

function harness() {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n ? (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '') : '');
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const where = (fn) => walk(container).filter((n) => fn(props(n)));
  const render = async (el) => { await act(async () => root.render(h(MemoryRouter, null, el))); };
  const close = async () => { await act(async () => root.unmount()); restore(); };
  return { byId, where, text, props, render, close };
}

test('mounted card: every DE01 field, the families as three shapes, the states drawn, and Open, Move to… and Compare without drag', async () => {
  const t = harness();
  const moves = [];
  const picks = [];
  const card = (row, extra = {}) => h(DealCard, { row, cards: CARDS, picked: [], onPick: (id) => picks.push(id), onMove: (r, s) => moves.push([r.id, s]), busy: false, ...extra });
  try {
    await t.render(h('div', null, rows().map((r) => h(React.Fragment, { key: r.id }, card(r)))));
    const c1 = t.byId('dealflow-card-1');
    assert.equal(t.props(c1)['data-states'], 'normal');
    assert.match(t.text(c1), /Acme Robotics.*Robotics.*Place not recorded.*CO.*Not recorded.*Screening.*Raising.*Invited by the studio.*€1.5M · SAFE.*Team.*Strong· High.*Market.*Fair· Medium.*Fit to my thesis.*6 days in stage.*NA.*Open.*Move to….*Compare/s);
    assert.equal(t.props(t.byId('dealflow-card-1-team'))['aria-label'], 'Team: Strong, high confidence');
    assert.ok(t.byId('dealflow-card-1-strip'), 'the score strip');
    // Three families, three shapes, never the same pill.
    const shapes = ['company', 'process', 'transaction'].map((k) => t.props(t.byId(`dealflow-card-1-${k}`)));
    assert.deepEqual(shapes.map((p) => p['data-family']), ['company', 'process', 'transaction']);
    assert.equal(new Set(shapes.map((p) => p.className)).size, 3);
    assert.match(shapes[0].className, /\brounded\b.*uppercase/);
    assert.match(shapes[1].className, /rounded-full/);
    assert.match(shapes[2].className, /border-l-\[3px\]/);
    // Each state is drawn.
    for (const [id, states] of [[2, 'low_confidence'], [3, 'missing'], [4, 'locked'], [5, 'stale'], [6, 'passed'], [7, 'unassigned']]) {
      assert.equal(t.props(t.byId(`dealflow-card-${id}`))['data-states'], states, `card ${id}`);
    }
    assert.equal(t.text(t.byId('dealflow-card-2-flag-low_confidence')), 'Low confidence');
    assert.equal(t.text(t.byId('dealflow-card-5-flag-stale')), 'Stale');
    assert.match(t.props(t.byId('dealflow-card-5')).className, /border-amber-300/);
    assert.equal(t.text(t.byId('dealflow-card-6-flag-passed')), 'Passed');
    assert.match(t.props(t.byId('dealflow-card-6')).className, /border-dashed/);
    assert.equal(t.text(t.byId('dealflow-card-7-flag-unassigned')), 'Unassigned');
    assert.equal(t.byId('dealflow-card-1-flag-unassigned'), undefined);
    // Absences: a word and its own mark, never 0.
    assert.equal(t.text(t.byId('dealflow-card-3-team')), 'Not scored');
    assert.equal(t.text(t.byId('dealflow-card-3-geographic')), 'Not expected yet');
    assert.equal(t.text(t.byId('dealflow-card-4-team')), 'Locked');
    const marks = ['dealflow-card-3-team', 'dealflow-card-3-geographic', 'dealflow-card-4-team'].map((id) => t.byId(id).childNodes.map((n) => t.props(n)['data-mark']).find(Boolean));
    assert.deepEqual(marks, ['missing', 'not_expected', 'locked']);
    for (const id of [3, 4]) assert.doesNotMatch(t.text(t.byId(`dealflow-card-${id}`)).replace(/€1\.5M|\d+ days?/g, ''), DIGIT, `card ${id} draws no figure`);
    // Open is a door only where can_open says.
    assert.equal(t.props(t.byId('dealflow-card-open-1')).href, '/deals/1');
    assert.equal(t.props(t.byId('dealflow-card-open-7'))['aria-disabled'], 'true');
    // Move to… and Compare.
    await act(async () => { t.props(t.byId('dealflow-move-1')).onChange({ target: { value: 'diligence' } }); });
    assert.deepEqual(moves, [['1', 'diligence']]);
    await act(async () => { t.props(t.byId('dealflow-tick-1')).onChange({ target: { checked: true } }); });
    assert.deepEqual(picks, ['1']);
  } finally { await t.close(); }

  // A phone card is never dragged, and Move to… still offers every other stage at 44px.
  const p = harness();
  try {
    await p.render(card(rowOf(1), { draggable: false }));
    assert.equal(p.props(p.byId('dealflow-card-1')).draggable, false);
    const move = p.byId('dealflow-move-1');
    assert.deepEqual(move.childNodes.slice(1).map((o) => p.props(o).value), moveTargets('screening'));
    assert.match(p.props(move).className, /max-sm:min-h-\[44px\]/);
    assert.match(p.props(p.byId('dealflow-card-open-1')).className, /max-sm:min-h-\[44px\]/);
  } finally { await p.close(); }
});

test('mounted shared score: each family a different mark and style; the compact cell keeps its confidence as a dot', async () => {
  const t = harness();
  try {
    const cells = {
      value: scopeCell(scoresOf(BATCH(), 1), 'team'),
      missing: scopeCell(scoresOf(BATCH(), 3), 'team'),
      not_recorded: scopeCell(scoresOf(BATCH(), 3), 'pmf'),
      not_expected: scopeCell(scoresOf(BATCH(), 3), 'geographic'),
      unreadable: scopeCell(scoresOf({ items: [{ deal_id: 1, scopes: [sc('team', null, null, 'unreadable')] }] }, 1), 'team'),
      locked: scopeCell(scoresOf(BATCH(), 4), 'team'),
      not_shared: scopeCell(scoresOf(BATCH(), 99), 'team'),
    };
    await t.render(h('div', null, Object.entries(cells).map(([k, cell]) => h(ScopeScore, { key: k, cell, label: 'Team', testId: `s-${k}` })),
      h(ScopeScore, { cell: cells.value, label: 'Team', words: false, testId: 's-dot' })));
    const absent = Object.keys(cells).filter((k) => k !== 'value');
    const markOf = (k) => t.byId(`s-${k}`).childNodes.map((n) => t.props(n)['data-mark']).find(Boolean);
    assert.deepEqual(absent.map(markOf), absent, 'one mark per absence');
    assert.equal(new Set(absent.map((k) => t.props(t.byId(`s-${k}`)).className)).size, absent.length, 'no two absences styled alike');
    for (const k of Object.keys(cells)) assert.equal(t.props(t.byId(`s-${k}`))['data-family'], k);
    assert.equal(t.text(t.byId('s-value')), 'Strong· High');
    assert.equal(t.text(t.byId('s-dot')), 'Strong', 'the dot carries the confidence');
    assert.equal(t.props(t.byId('s-dot'))['aria-label'], 'Team: Strong, high confidence');
  } finally { await t.close(); }
});

test('wiring: the board and the phone draw DealCard; the table and peek share ScopeScore; dark pairs on light classes', () => {
  const dir = 'frontend/src/pages/investor/dealflow/';
  const board = read(`${dir}FlowBoard.jsx`);
  assert.equal((board.match(/<DealCard /g) || []).length, 2, 'the desktop column and the phone tab');
  assert.match(read(`${dir}FlowCells.jsx`), /return <ScopeScore cell=\{scopeCell\(scores, scope\)\}/);
  for (const f of ['DealCard.jsx', 'ScopeScore.jsx']) {
    const src = read(dir + f);
    for (const m of src.matchAll(/className=(?:"|\{`|`)([^"`]*)/g)) {
      for (const light of ['bg-white', 'border-gray-300', 'text-gray-600', 'text-gray-700']) {
        if (new RegExp(`(^|\\s)${light}(\\s|$)`).test(m[1])) assert.match(m[1], /dark:/, `${f}: ${light} needs a dark pair`);
      }
      if (/(^|\s)hover:(bg|text|border)-/.test(m[1])) assert.match(m[1], /dark:hover:/, `${f}: a light hover needs its dark pair`);
    }
    assert.doesNotMatch(src, /window\.(alert|confirm|open)|dangerouslySetInnerHTML/, f);
  }
  assert.match(read(`${dir}README.md`), /DealCard\.jsx/);
});
