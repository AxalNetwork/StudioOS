// D1253 (#2428) — the venture scorecard (SC1–SC22): the eleven scopes in one
// order with no Overall, the grades and the one Source-to-grade mapping, the
// band and risk words, the scope strip's bar rule (dashed for not enough, a dot
// for not expected, never a bar of zero), the pages and their addresses, and
// "Not read here yet" on every block no read carries.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/venture_scorecard_d1253.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import VentureScorecard, { ScopeStrip } from '../src/components/scoring/scorecard/Scorecard.jsx';
import ScoringMethodPage from '../src/pages/scoring/ScoringMethodPage.jsx';
import HqScoringPage from '../src/pages/scoring/HqScoringPage.jsx';
import {
  GRADES, METHOD, NOT_YET, SCOPES, SCOPE_LABELS, SOURCE_GRADE, WAITS, bandOf, barText, stripBar, unreadScopes,
} from '../src/components/scoring/scorecard/scorecardModel.js';
import { SCOPES as DEAL_FLOW_SCOPES } from '../src/pages/investor/dealflow/dealFlowModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('eleven scopes in the one order, no Overall, and Deal flow reads the same list', () => {
  assert.deepEqual(SCOPE_LABELS, ['Team', 'Market', 'Product-market fit', 'Technical', 'Traction', 'Financial', 'Risk', 'Geographic', 'Political and regulatory', 'Governance', 'Legal and IP']);
  assert.equal(SCOPES.find((s) => s.label === 'Product-market fit').key, 'pmf');
  assert.ok(!SCOPE_LABELS.includes('Overall'));
  assert.equal(DEAL_FLOW_SCOPES, SCOPE_LABELS, 'Deal flow does not keep its own copy');
});

test('grades and the one Source-to-grade mapping', () => {
  assert.deepEqual(GRADES.map((g) => [g.key, g.factor]), [['measured', 1], ['reviewed', 0.9], ['sourced', 0.7], ['stated', 0.4]]);
  assert.deepEqual(SOURCE_GRADE, { connector: 'measured', recorded: 'measured', signed: 'measured', document: 'sourced', typed: 'stated' });
});

test('bands at 70 and 40; Risk reads as a risk word; no value is no band', () => {
  assert.deepEqual([70, 69, 40, 39].map((v) => bandOf(v, 'team')), ['Strong', 'Fair', 'Fair', 'Weak']);
  assert.deepEqual([75, 50, 10].map((v) => bandOf(v, 'risk')), ['Low risk', 'Medium risk', 'High risk']);
  assert.equal(bandOf(null, 'team'), null);
  assert.equal(bandOf(undefined, 'team'), null);
});

test('the strip: height is the value, opacity the confidence; not enough is dashed, not expected a dot, unread a hairline', () => {
  assert.deepEqual(stripBar({ key: 'team', value: 100, confidence: 'high', state: 'scored' }), { kind: 'bar', height: 20, opacity: 1 });
  assert.deepEqual(stripBar({ key: 'team', value: 50, confidence: 'medium', state: 'scored' }), { kind: 'bar', height: 10, opacity: 0.6 });
  assert.equal(stripBar({ key: 'team', value: 50, confidence: 'low', state: 'scored' }).opacity, 0.3);
  assert.equal(stripBar({ key: 'team', value: null, confidence: null, state: 'not_enough' }).kind, 'dashed');
  assert.equal(stripBar({ key: 'team', value: 0, confidence: null, state: 'scored' }).kind, 'dashed', 'no confidence is never a bar');
  assert.equal(stripBar({ key: 'traction', state: 'not_expected' }).kind, 'dot');
  assert.equal(stripBar(undefined).kind, 'unread');
  assert.equal(barText({ key: 'team', value: 62, confidence: 'medium', state: 'scored', coverage: { present: 5, of: 6 } }), 'Team 62, Fair, medium confidence, 5 of 6 inputs');
  assert.equal(barText({ key: 'geographic', state: 'not_enough' }), 'Geographic: Not enough recorded');
  assert.equal(unreadScopes().length, 11);
  for (const [k, w] of Object.entries(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), k);
});

/* ------------------------------------------------------------------ *
 * Rendered
 * ------------------------------------------------------------------ */

test('the panel draws the eleven scopes unread, the method door, and no number', () => {
  const out = html(h(VentureScorecard));
  for (const s of SCOPES) assert.ok(out.includes(`data-testid="scorecard-scope-${s.key}"`), s.key);
  assert.ok(out.includes(`href="${METHOD}"`));
  assert.ok(out.includes('data-testid="scorecard-wait-scores"') && out.includes('data-testid="scorecard-wait-weighting"'));
  assert.ok(!/>\s*0\s*</.test(out), 'no zero is drawn');
  const founder = html(h(VentureScorecard, { audience: 'founder' }));
  assert.ok(founder.includes('data-testid="scorecard-wait-sharing"') && !founder.includes('scorecard-wait-weighting'));
});

test('the strip: unread is one outlined strip read as Not read here yet; locked hides every bar', () => {
  const unread = html(h(ScopeStrip));
  assert.ok(unread.includes('data-testid="scope-strip-unread"') && unread.includes(`aria-label="Scorecard: ${NOT_YET}"`));
  const scored = html(h(ScopeStrip, { scopes: SCOPES.map((s, i) => ({ key: s.key, value: 50 + i, confidence: 'high', state: 'scored' })) }));
  assert.ok(scored.includes('data-testid="scope-strip"') && scored.includes('Team 50, Fair, high confidence'));
  const locked = html(h(ScopeStrip, { locked: true, scopes: SCOPES.map((s) => ({ key: s.key, value: 90, confidence: 'high', state: 'scored' })) }));
  assert.ok(locked.includes('data-testid="scope-strip-locked"') && !locked.includes('height:'), 'a locked strip draws no bar');
});

test('the method page draws the scopes and grades, and says model v1 is not published; HQ reads its part 6 blocks and waits on part 3', () => {
  const m = html(h(ScoringMethodPage));
  assert.match(m, /It is not published yet, so no venture carries a score from it today\./);
  for (const s of SCOPE_LABELS) assert.ok(m.includes(s), s);
  assert.match(m, /Measured<\/b> · 1\.0/);
  const hq = html(h(HqScoringPage));
  // D1259 (part 6) reads the model versions and the indices; only the fairness check still waits, on part 3.
  assert.ok(hq.includes('data-testid="scorecard-wait-fairness"'));
  for (const id of ['models', 'indices']) assert.ok(!hq.includes(`data-testid="scorecard-wait-${id}"`) && hq.includes(`data-testid="hq-scoring-${id}-loading"`), id);
  assert.match(hq, /HQ only/);
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the three routes, the deal tab, the deal flow column, HQ’s strip, the canvas and the docs', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/platform/scoring" element={guard(['admin'], hqOnly(<HqScoringPage />))} />`));
  assert.ok(app.includes(`<Route path="/scoring/method" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <ScoringMethodPage />)} />`));
  assert.ok(app.includes(`<Route path="/raise/scorecard" element={guard(labRoles(['admin', 'founder']), <FounderScorecardPage />)} />`));
  assert.ok(app.indexOf('path="/raise/scorecard"') < app.indexOf('path="/raise/:slug"'), 'the static path is declared before the module route');
  const deal = read('frontend/src/pages/DealRoomPage.jsx');
  assert.ok(deal.includes("{tab === 'scorecard' && <VentureScorecard />}"));
  assert.ok(!deal.includes("['scorecard', 'evidence'"), 'the scorecard tab is no longer a wait card');
  // D1240 (#3253): Deal flow's Scorecard column draws the strip from SCORING's batch.
  assert.ok(read('frontend/src/pages/investor/dealflow/FlowTable.jsx').includes('<ScopeStrip scopes={stripScopes(row.scores)} />'));
  assert.ok(read('frontend/src/lib/hqStrips.js').includes("['Scoring', '/admin/platform/scoring']"));
  assert.ok(app.includes('<StripLink to="/admin/platform/scoring">Scoring</StripLink>'), 'HQ’s Platform strip in the shell holds the door');
  for (const f of ['Venture Scorecard Page.dc.html', 'Venture scorecard · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Venture scorecard · Boards.dc.html').includes('name="Venture Scorecard Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1253.md'));
  assert.ok(existsSync('documentation/audits/VENTURE_SCORECARD_MAP_2026-10-26.md'));
});
