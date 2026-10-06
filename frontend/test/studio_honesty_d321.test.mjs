/**
 * D321 — the Investor Studio home says when a read failed, and never draws a
 * zero or a "Not recorded" in place of a failure.
 *
 * The founder half of D321 tested the 69dc42f3 founder cards
 * (`founderStudioCards.jsx`), retired with that body by D564; the founder
 * Studio's own states are pinned by `founder_studio_d564.test.mjs`.
 *
 * The home itself cannot be imported here: it mounts PersonalAdvisor, whose
 * imports reach Worker modules. The stat groups it draws live in
 * investorStudioParts.jsx, and are rendered here with the props it passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Row, StatGroup, number, quickStats } from '../src/pages/investor/investorStudioParts.jsx';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const draw = (el) => renderedText(renderToStaticMarkup(createElement(MemoryRouter, null, el)));

// ── Investor: Quick stats, one state per source ─────────────────────────────

const lifecycle = { counts: { watching: 4, dealrooms: 2 } };
const dashboard = { quick_stats: { ai_score_avg: 71 } };

test('quickStats: a failed dashboard read is unreadable, not not-recorded', () => {
  const q = quickStats({ dashboard: null, dashboardUnavailable: 'boom', lifecycle, dealCount: 0 });
  assert.equal(q.dealFlow.state, 'unreadable');
  assert.equal(q.lifecycle.state, 'ready');
});

test('quickStats: a dashboard still loading is loading, never a zero deal count', () => {
  const q = quickStats({ dashboard: undefined, lifecycle: undefined, dealCount: 0 });
  assert.equal(q.dealFlow.state, 'loading');
  assert.equal(q.lifecycle.state, 'loading');
});

test('quickStats: a failed lifecycle read is unreadable; a preview is withheld', () => {
  assert.equal(quickStats({ dashboard, lifecycle: null, dealCount: 3 }).lifecycle.state, 'unreadable');
  const p = quickStats({ previewing: true, dashboard: null, lifecycle: null, dealCount: 0 });
  assert.equal(p.dealFlow.state, 'withheld');
  assert.equal(p.lifecycle.state, 'withheld');
});

test('quickStats: a null count or average stays absent; it is not 0', () => {
  const q = quickStats({ dashboard: { quick_stats: { ai_score_avg: null } }, lifecycle: { counts: { watching: null } }, dealCount: 3 });
  const [, avg] = q.dealFlow.rows.find(([label]) => label === 'Avg AI match');
  const [, watching] = q.lifecycle.rows.find(([label]) => label === 'Watching');
  assert.equal(avg, null);
  assert.equal(watching, null);
});

test('number keeps an absent figure absent: null, undefined and empty are not 0', () => {
  assert.equal(number(null), null);
  assert.equal(number(undefined), null);
  assert.equal(number(''), null);
  assert.equal(number('abc'), null);
  assert.equal(number(0), 0, 'a real zero stays zero');
  assert.equal(number('7'), 7);
});

test('the investor home uses the shared number helper, not a local copy', () => {
  const code = codeOnly(read('../src/pages/investor/InvestorStudioHome.jsx'));
  assert.match(code, /import \{[^}]*\bnumber\b[^}]*\} from '\.\/investorStudioParts'/);
  assert.doesNotMatch(code, /const number =/);
});

test('an unreadable stat group draws one Unreadable line and none of its rows', () => {
  const group = quickStats({ dashboard: null, dashboardUnavailable: 'boom', lifecycle, dealCount: 0 }).dealFlow;
  const text = draw(createElement(StatGroup, { group, what: 'The deal-flow summary', claim: 'This is not a claim that no deal is in flow.', onRetry: () => {} }));
  assert.match(text, /The deal-flow summary could not be read\./);
  assert.match(text, /Retry/);
  assert.doesNotMatch(text, /Deals in flow|Not recorded|\b0\b/);
});

test('a readable stat group draws its figures, and an absent one as not recorded', () => {
  const group = quickStats({ dashboard: { quick_stats: {} }, lifecycle, dealCount: 3 }).dealFlow;
  const text = draw(createElement(StatGroup, { group, what: 'x', claim: 'y' }));
  assert.match(text, /Deals in flow\s*3/);
  assert.match(text, /Avg AI match\s*Not recorded/);
  assert.match(draw(createElement(Row, { label: 'IRR', value: null })), /IRR\s*Not recorded/);
});

// ── Both homes: the page wiring the pieces above depend on ─────────────────

test('neither home forces an absent figure to zero', () => {
  for (const rel of [
    '../src/pages/founder/FounderStudioHome.jsx',
    '../src/pages/founder/FounderStudioBody.jsx',
    '../src/pages/founder/founderStudioModel.js',
    '../src/pages/investor/InvestorStudioHome.jsx',
    '../src/pages/investor/investorStudioParts.jsx',
  ]) {
    const code = codeOnly(read(rel));
    assert.doesNotMatch(code, /(\|\||\?\?)\s*0\b/, `${rel} falls back to 0`);
  }
});

test('the investor home routes every failed read to Unreadable with a retry', () => {
  const code = codeOnly(read('../src/pages/investor/InvestorStudioHome.jsx'));
  assert.doesNotMatch(code, /<Status error>/, 'a failed read is not a plain status line');
  assert.match(code, /lifecycle === null \? <Unreadable what="The deal lifecycle"[^>]*onRetry=\{retryLifecycle\}/);
  assert.match(code, /dashboardUnavailable \? <Unreadable what="Scored opportunities"[^>]*onRetry=\{refreshContext\}/);
  assert.match(code, /failures\.portfolio \? <Unreadable [^>]*onRetry=\{retrySources\}/);
  assert.match(code, /failures\.events \? <Unreadable [^>]*onRetry=\{retrySources\}/);
  assert.match(code, /<StatGroup group=\{quick\.dealFlow\}[^>]*onRetry=\{refreshContext\}/);
  assert.match(code, /<StatGroup group=\{quick\.lifecycle\}[^>]*onRetry=\{retryLifecycle\}/);
});

test('Dashboard.jsx gives the investor home a lifecycle retry that re-reads the lifecycle', () => {
  const code = codeOnly(read('../src/pages/Dashboard.jsx'));
  const m = code.match(/onRetryLifecycle=\{\(\) => \{([\s\S]*?)\}\}/);
  assert.ok(m, 'onRetryLifecycle is passed');
  assert.match(m[1], /setInvestorLC\(undefined\)/, 'the retry shows loading, not the stale failure');
  assert.match(m[1], /api\.investorLifecycle\(\)/);
});

test('both homes draw the canvas context line: Studio, and the investor\'s role badge and date', () => {
  // The founder Studio's header is D564's canvas: Studio and the Lab phase.
  const founder = codeOnly(read('../src/pages/founder/FounderStudioBody.jsx'));
  const investor = codeOnly(read('../src/pages/investor/InvestorStudioHome.jsx'));
  assert.match(founder, /data-testid="text-founder-studio-title">Studio</);
  assert.match(founder, /data-testid="badge-founder-studio-phase">\{header\.phase\}/);
  assert.match(investor, /data-testid="text-investor-studio-title">Studio</);
  assert.match(investor, /data-testid="badge-investor-studio-role">Investor</);
  assert.match(investor, /data-testid="text-investor-studio-date">\{new Intl\.DateTimeFormat/);
});
