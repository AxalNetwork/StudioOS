/**
 * D321 — the Founder and Investor Studio homes say when a read failed, count
 * the Lab's milestones from what the Worker sends, and never draw a zero or a
 * "Not recorded" in place of either.
 *
 * The homes themselves cannot be imported here: they mount PersonalAdvisor,
 * whose imports reach Worker modules. The cards and stat groups they draw live
 * in founderStudioCards.jsx and investorStudioParts.jsx, and are rendered here
 * with the props the homes pass them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { DeckRows, LabRows, MetricRow, RaiseProgress, StudioCard, deckSummary, labSummary, raisePercent } from '../src/pages/founder/founderStudioCards.jsx';
import { Row, StatGroup, number, quickStats } from '../src/pages/investor/investorStudioParts.jsx';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const draw = (el) => renderedText(renderToStaticMarkup(createElement(MemoryRouter, null, el)));
const card = (props, child) => draw(createElement(StudioCard, { title: 'Pitch deck', icon: Sparkles, to: '/x', action: 'Open', ...props }, child));
const row = createElement(MetricRow, { name: 'Version', result: null });

// ── Founder: a failed read is Unreadable, and nothing else ──────────────────

test('a founder card whose read failed says so, offers a retry, and draws no rows', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(StudioCard, { title: 'Pitch deck', icon: Sparkles, to: '/x', action: 'Open', error: 'boom', claim: 'This is not a claim that no deck exists.', onRetry: () => {} }, row)));
  const text = renderedText(html);
  assert.match(text, /Pitch deck could not be read\. This is not a claim that no deck exists\./);
  assert.match(html, /role="alert"/);
  assert.match(text, /Retry/);
  assert.doesNotMatch(text, /Not recorded/, 'a failed read never draws its rows as not recorded');
});

test('a failed project read is not an absent project: no "create a startup" prompt', () => {
  // When listProjects fails, `project` stays null, so every project card is
  // both errored and empty. The error wins.
  const text = card({ error: 'boom', claim: 'c', empty: true }, row);
  assert.match(text, /could not be read/);
  assert.doesNotMatch(text, /Select or create a startup/);
});

test('a founder card that read fine draws its rows, and an absent value as not recorded', () => {
  const text = card({}, row);
  assert.doesNotMatch(text, /could not be read/);
  assert.match(text, /Version\s*Not recorded/);
});

// ── Founder: the Lab counts what the Worker sends ───────────────────────────

const state = {
  active: true,
  week: 2,
  days_remaining: 17,
  milestones: [
    { key: 'project_created', week: 1, completed_at: '2026-09-01' },
    { key: 'customer_interview_logged_1', week: 1, completed_at: '2026-09-02' },
    { key: 'okrs_created', week: 2, completed_at: '2026-09-09' },
  ],
};

test('labSummary counts completed milestones, all and this week, from the milestone list', () => {
  assert.deepEqual(labSummary(state), { active: true, week: 2, completed: 3, completedThisWeek: 1, daysRemaining: 17 });
});

test('labSummary never turns an absent list or field into a zero', () => {
  const s = labSummary({ active: true, week: 2 });
  assert.equal(s.completed, null);
  assert.equal(s.completedThisWeek, null);
  assert.equal(s.daysRemaining, null, 'a missing days_remaining is not 0 days');
  assert.equal(labSummary({ active: true, week: 2, days_remaining: null }).daysRemaining, null);
  assert.equal(labSummary({ active: true, milestones: [] }).completedThisWeek, null, 'no week, no per-week count');
  assert.equal(labSummary({ active: true, week: 1, milestones: [] }).completed, 0, 'an empty list read fine is a real zero');
  assert.deepEqual(labSummary({ active: false, milestones: state.milestones }), { active: false });
  assert.equal(labSummary(null), null);
});

test('the Lab card draws the counts, and the week total it is not sent as not recorded', () => {
  const text = draw(createElement(LabRows, { lab: labSummary(state) }));
  assert.match(text, /Week 2\s*1 done this week/);
  assert.match(text, /Milestones completed\s*3/);
  assert.match(text, /Days remaining\s*17/);
  assert.match(text, /Of this week's deliverables\s*Not recorded/);
  assert.doesNotMatch(text, /\b0 completed\b/);
});

test('an account with no active sprint says so rather than drawing empty rows', () => {
  const text = draw(createElement(LabRows, { lab: labSummary({ active: false }) }));
  assert.match(text, /No active Lab sprint/);
  assert.doesNotMatch(text, /Not recorded/);
});

// ── Founder: the Deck and Raise cards read what the Worker sends ─────────

const NOW = Date.parse('2026-09-27T12:00:00Z');
const versions = [{ id: 41, version: 4, created_at: '2026-09-20 09:00:00' }, { id: 40, version: 3, created_at: '2026-09-01 09:00:00' }];
const engagement = {
  shares: [{ id: 2, created_at: '2026-09-21 10:00:00' }, { id: 1, created_at: '2026-09-02 10:00:00' }],
  views: [
    { id: 9, created_at: '2026-09-26 10:00:00' },
    { id: 8, created_at: '2026-09-22 10:00:00' },
    { id: 7, created_at: '2026-09-10 10:00:00' },
  ],
};

test('deckSummary reads the newest version, its slides, its links and this week\'s views', () => {
  const d = deckSummary({ versions, detail: { slides: [{}, {}, {}] }, engagement, now: NOW });
  assert.equal(d.id, 41);
  assert.equal(d.version, 4);
  assert.equal(d.slides, 3);
  assert.equal(d.shareLinks, 2);
  assert.equal(d.lastSharedAt.toISOString(), '2026-09-21T10:00:00.000Z', 'SQLite UTC, newest link');
  assert.equal(d.viewsThisWeek, 2, 'views older than seven days are not this week');
});

test('deckSummary keeps an unanswered source absent, and a source with nothing a real zero', () => {
  const d = deckSummary({ versions, now: NOW });
  assert.equal(d.slides, null);
  assert.equal(d.shareLinks, null);
  assert.equal(d.viewsThisWeek, null);
  const e = deckSummary({ versions, detail: { slides: [] }, engagement: { shares: [], views: [] }, now: NOW });
  assert.equal(e.slides, 0);
  assert.equal(e.shareLinks, 0);
  assert.equal(e.viewsThisWeek, 0);
  assert.equal(deckSummary({ versions: [] }), null, 'no version, no deck');
});

test('the Deck card draws each figure, and a failed engagement read as Unreadable in place of its rows', () => {
  const deck = deckSummary({ versions, detail: { slides: [{}, {}] }, engagement, now: NOW });
  const ok = draw(createElement(DeckRows, { deck }));
  assert.match(ok, /Version\s*v4/);
  assert.match(ok, /Slides\s*2/);
  assert.match(ok, /Last shared\s*2 links · /);
  assert.match(ok, /Viewed\s*2× this week/);
  const failed = draw(createElement(DeckRows, { deck: deckSummary({ versions, detail: { slides: [] }, now: NOW }), engagementError: 'boom', onRetry: () => {} }));
  assert.match(failed, /Deck engagement could not be read\./);
  assert.doesNotMatch(failed, /Last shared|Viewed/);
  const noSlides = draw(createElement(DeckRows, { deck: deckSummary({ versions, engagement, now: NOW }), detailError: 'boom', onRetry: () => {} }));
  assert.match(noSlides, /The slide count could not be read\./);
  assert.doesNotMatch(noSlides, /Slides/);
  const unshared = draw(createElement(DeckRows, { deck: deckSummary({ versions, detail: { slides: [] }, engagement: { shares: [], views: [] }, now: NOW }) }));
  assert.match(unshared, /Last shared\s*Not shared yet/);
});

test('raisePercent is the committed share of a real target, else absent', () => {
  assert.equal(raisePercent(450000, 1500000), 30);
  assert.equal(raisePercent('450000', '1500000'), 30);
  assert.equal(raisePercent(0, 1500000), 0, 'nothing committed against a real target is 0%');
  assert.equal(raisePercent(null, 1500000), null);
  assert.equal(raisePercent(450000, null), null);
  assert.equal(raisePercent(450000, 0), null, 'no target, no share');
  assert.equal(raisePercent('', 100), null);
  const text = draw(createElement(RaiseProgress, { pct: null }));
  assert.match(text, /Of target\s*Not recorded/);
  assert.match(renderToStaticMarkup(createElement(RaiseProgress, { pct: 130 })), /width:100%/, 'the bar stops at full');
});

test('the founder home reads the newest version\'s slides and engagement, and passes their failures', () => {
  const code = codeOnly(read('../src/pages/founder/FounderStudioHome.jsx'));
  assert.match(code, /api\.deckGet\(latestDeckId\)/);
  assert.match(code, /api\.deckEngagement\(latestDeckId\)/);
  assert.match(code, /<DeckRows deck=\{context\.deck\} detailError=\{failures\.deckDetail\} engagementError=\{failures\.engagement\} onRetry=\{again\} \/>/);
  assert.match(code, /<RaiseProgress pct=\{raisePercent\(context\.raise\?\.raised, activeRound\?\.target_amount\)\} \/>/);
});

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
    '../src/pages/founder/founderStudioCards.jsx',
    '../src/pages/investor/InvestorStudioHome.jsx',
    '../src/pages/investor/investorStudioParts.jsx',
  ]) {
    const code = codeOnly(read(rel));
    assert.doesNotMatch(code, /(\|\||\?\?)\s*0\b/, `${rel} falls back to 0`);
  }
});

test('the founder home passes each card its claim and a retry, and counts the Lab with labSummary', () => {
  const code = codeOnly(read('../src/pages/founder/FounderStudioHome.jsx'));
  const cards = [...code.matchAll(/<StudioCard\b[\s\S]*?>/g)].map((m) => m[0]);
  // Every card on this page is backed by a read, so every one takes the
  // failure, its claim and a retry. A card that hides itself when its read
  // fails (the subsidiaries card did) is the defect this pins.
  assert.ok(cards.length >= 8, `expected the home's cards, found ${cards.length}`);
  for (const c of cards) {
    assert.match(c, /error=\{failures\./, c.slice(0, 80));
    assert.match(c, /claim="This is not a claim that [^"]+"/, c.slice(0, 80));
    assert.match(c, /onRetry=\{again\}/, c.slice(0, 80));
  }
  assert.match(code, /const lab = labSummary\(context\.lab\)/);
  assert.match(code, /<LabRows lab=\{lab\} \/>/);
  assert.doesNotMatch(code, /completed_count/, 'the Lab never sends completed_count');
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

test('both homes draw the canvas context line: Studio, the role badge, and the date', () => {
  const founder = codeOnly(read('../src/pages/founder/FounderStudioHome.jsx'));
  const investor = codeOnly(read('../src/pages/investor/InvestorStudioHome.jsx'));
  assert.match(founder, /data-testid="text-founder-studio-title">Studio</);
  assert.match(founder, /data-testid="badge-founder-studio-role">Founder</);
  assert.match(founder, /data-testid="text-founder-studio-date">\{new Intl\.DateTimeFormat/);
  assert.match(investor, /data-testid="text-investor-studio-title">Studio</);
  assert.match(investor, /data-testid="badge-investor-studio-role">Investor</);
  assert.match(investor, /data-testid="text-investor-studio-date">\{new Intl\.DateTimeFormat/);
});
