/**
 * D4803 (#4803, slice 2) — Security v2's Resilience (SE09, SE11e) and AI
 * Safety (SE08, SE11f) workspaces, read the way a person reads them:
 *   - the pure models with payloads shaped like `admin_security.ts`'s
 *     `backup_dr` and `ai_safety`;
 *   - server renders of each workspace in its states.
 *
 * The rules under test: a backup is not a restore (the drill leads and its
 * state never comes from the heartbeat); a stale pass is Stale, not
 * Verified; unknown is not zero (an unreadable block says so, a measured zero
 * says it is one); "x of n", never a bare rate, with small samples named.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import {
  DRILL_STEPS, drillFacts, drillHeadline, durationOf, heartbeatState, pipeline, sizeOf, stepLabel, whenOf,
} from '../src/pages/hq/security/resilienceModel.js';
import ResilienceWorkspace from '../src/pages/hq/security/ResilienceWorkspace.jsx';
import {
  SMALL_SAMPLE, contentSafety, deliveryEnforcement, recentVerdicts, shortWhen, usageAnomalies,
} from '../src/pages/hq/security/aiSafetyModel.js';
import AiSafetyWorkspace from '../src/pages/hq/security/AiSafetyWorkspace.jsx';
import { MemoryRouter } from 'react-router-dom';
import { SecurityConsole, UNAVAILABLE } from '../src/pages/hq/SecurityPage.jsx';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const text = (el) => renderedText(html(el));

// ───────────────────────────────────────────────────────────── fixtures ──

const FAILED = () => ({
  available: true, state: 'last_run_failed', at: '2026-11-01T06:04:00Z', age_days: 8, fresh: true, stale_after_days: 35,
  step: 'restore', exit_code: 1, reason: 'wrangler d1 execute exited 1', duration_s: 252,
  backup_key: 'd1/2026-11-01.sql.gz', recovery_point: '2026-11-01T03:10:00Z', migration: '202611010600_x.sql', tables: 0,
  rpo_met: true, rto_met: null, run_id: '991',
});
const PASSED = (fresh = true) => ({
  available: true, state: 'last_run_passed', at: '2026-11-01T06:04:00Z', age_days: fresh ? 8 : 40, fresh, stale_after_days: 35,
  duration_s: 41, tables: 112, rpo_met: true, rto_met: true,
});
const HB = (over = {}) => ({
  available: true, fresh: true, age_hours: 3, stale_after_hours: 26, at: '2026-11-09T03:00:00Z',
  recovery_point: '2026-11-09T03:00:00Z', size_bytes: 48_200_000, source: 'gha', key: 'd1/2026-11-09.sql.gz', ...over,
});
const BACKUP = (drill) => ({ backup: HB(), kv: HB({ source: 'cron' }), drill, not_recorded: [] });

const AI = (over = {}) => ({
  available: true, window_days: 7,
  verdicts: { available: true, evaluated: 40, safe_count: 38, unsafe_count: 2, no_verdict_count: 1 },
  enforcement: { available: true, rules: [{ category: 'pii', turns: 2 }], blocked: 3, flagged: 1 },
  guard: { available: true, by_page: [
    { page: 'advisor', checks: 30, safe: 29, unsafe: 1, blocked_input: 1, withheld_output: 1, unavailable: 2 },
    { page: 'email', checks: 10, safe: 10, unsafe: 0, blocked_input: 0, withheld_output: 0, unavailable: 0 },
  ] },
  token_anomalies: { available: true, accounts_checked: 12, count: 1, multiple: 5, baseline_days: 14, window_hours: 24, how: 'Each account against its own average.', rows: [] },
  recent_verdicts: { available: true, window_days: 7, rows: [
    { at: '2026-11-09 15:02:00', page: 'advisor', verdict: 'unsafe', delivery: 'withheld_output' },
    { at: '2026-11-09 14:00:00', page: null, verdict: null, delivery: 'whatever' },
  ] },
  not_counted: [],
  ...over,
});

// ─────────────────────────────────────────────────────── resilience model ──

test('the pipeline marks the steps a failed drill ran, the step it failed at, and the ones it never reached', () => {
  assert.deepEqual(pipeline(FAILED()).map((s) => s.mark), ['done', 'done', 'done', 'failed', 'skipped', 'skipped']);
  assert.deepEqual(pipeline(PASSED()).map((s) => s.mark), DRILL_STEPS.map(() => 'done'));
  // A preview step fails after the smoke test: the main steps up to it are done, the rest unknown.
  assert.deepEqual(pipeline({ ...FAILED(), step: 'preview_smoke' }).map((s) => s.mark), ['done', 'done', 'done', 'done', 'done', 'unknown']);
  assert.ok(pipeline({ available: false }).every((s) => s.mark === 'unknown'), 'an unreadable drill drew marks');
  assert.equal(stepLabel('preview_smoke'), 'Preview smoke test');
  assert.equal(stepLabel('mystery'), 'mystery', 'an unknown step was hidden');
});

test('the headline: failed, stale, verified, never run and unreadable are each their own state', () => {
  const f = drillHeadline(FAILED());
  assert.equal(f.state, 'failed');
  assert.match(f.title, /failed at the restore step/);
  assert.match(f.line, /not verified restorable/);
  assert.equal(drillHeadline(PASSED()).state, 'verified');
  const stale = drillHeadline(PASSED(false));
  assert.equal(stale.state, 'stale', 'an old pass read as Verified');
  assert.equal(stale.verified, false);
  assert.equal(drillHeadline({ available: true, state: 'never_run' }).state, 'action_required');
  const u = drillHeadline({ available: false, state: 'invalid', reason: 'Bad marker.' });
  assert.equal(u.state, 'unavailable');
  assert.match(u.line, /this is not a pass/);
  assert.equal(drillHeadline(null).state, 'pending');
});

test('drill facts name the failed step, exit code and reason, and skip what was not recorded', () => {
  const rows = Object.fromEntries(drillFacts(FAILED()).map(([k, v]) => [k, v]));
  assert.equal(rows['Failed step'], 'restore · exit code 1');
  assert.equal(rows.Reason, 'wrangler d1 execute exited 1');
  assert.equal(rows.Duration, '4 min 12 s');
  assert.equal(rows['Tables restored'], '0', 'a measured zero tables was dropped');
  assert.equal(rows['Recovery point target (24 h)'], 'Met');
  assert.ok(!('Recovery time target (4 h)' in rows), 'an unrecorded RTO was drawn');
  assert.match(rows.Evidence, /run 991/);
  assert.deepEqual(drillFacts({ available: false }), []);
});

test('heartbeats: fresh, stale, never written and unreadable', () => {
  assert.equal(heartbeatState(HB()).state, 'healthy');
  assert.equal(heartbeatState(HB({ fresh: false, age_hours: 50 })).state, 'stale');
  assert.equal(heartbeatState({ available: false, state: 'never_written' }).state, 'action_required');
  const inv = heartbeatState({ available: false, state: 'invalid', reason: 'r' });
  assert.equal(inv.state, 'unavailable');
  assert.equal(inv.label, 'Not valid evidence');
  assert.equal(sizeOf(48_200_000), '48.2 MB');
  assert.equal(sizeOf(0), null);
  assert.equal(durationOf(41), '41 s');
  assert.equal(whenOf('2026-11-01T03:10:00Z'), 'Sun 1 Nov 2026, 03:10 UTC');
  assert.equal(whenOf('nope'), null);
});

// ─────────────────────────────────────────────────── resilience render ──

test('Resilience renders a failed drill first, with a green backup beside it that does not vouch for it', () => {
  const out = html(h(ResilienceWorkspace, { block: BACKUP(FAILED()) }));
  assert.match(out, /data-testid="res-drill" data-state="failed"/);
  assert.ok(out.indexOf('res-drill') < out.indexOf('res-backup'), 'the drill no longer leads');
  assert.match(out, /data-testid="res-backup" data-state="healthy"/);
  const t = renderedText(out);
  assert.match(t, /Restore drill failed at the restore step/);
  assert.match(t, /evidence of a backup, not of a restore/);
  assert.match(t, /No drill for KV/);
  assert.match(t, /The restore drill history could not be read/);
  assert.match(out, /data-mark="failed"/);
});

test('D5317: an empty history says Not recorded and recorded runs retain their own outcomes', () => {
  const block = BACKUP(FAILED());
  block.drill_history = { available: true, rows: [] };
  assert.match(text(h(ResilienceWorkspace, { block })), /No runs have been recorded in the history yet/);
  block.drill_history.rows = [
    { id: 'new', at: '2026-11-01T03:10:00Z', outcome: 'failed', step: 'restore', exit_code: 2, run_id: '101', reason: 'restore_failed' },
    { id: 'old', at: '2026-09-01T03:10:00Z', outcome: 'passed', fresh: false },
  ];
  const out = text(h(ResilienceWorkspace, { block }));
  assert.ok(out.indexOf('View run 101') < out.lastIndexOf('Stale'));
  assert.match(out, /Failed step.*Restore.*Exit code.*2.*restore_failed/i);
  assert.doesNotMatch(out, /Some restore drill records could not be read/);
  block.drill_history.partial = true;
  const partial = text(h(ResilienceWorkspace, { block, onRetry: () => {} }));
  assert.match(partial, /Some restore drill records could not be read/);
  assert.match(partial, /Retry/);
  assert.match(partial, /View run 101/);
});

test('Resilience unreadable says what is not claimed, and pending reads as reading', () => {
  assert.match(text(h(ResilienceWorkspace, { block: null, unreadable: true, onRetry: () => {} })), /not a claim that backups are healthy/);
  const pending = html(h(ResilienceWorkspace, { block: null }));
  assert.match(pending, /data-testid="res-drill" data-state="pending"/);
  assert.doesNotMatch(pending, /res-pipeline/, 'a pending drill drew a pipeline');
});

// ────────────────────────────────────────────────────────── AI model ──

test('content safety is x of n, a small sample is named, and an unsafe verdict is never Healthy', () => {
  const c = contentSafety(AI());
  assert.deepEqual([c.x, c.n, c.unsafe, c.state, c.small, c.noVerdict], [38, 40, 2, 'unknown', false, 1]);
  const small = contentSafety(AI({ verdicts: { available: true, evaluated: 2, safe_count: 2, unsafe_count: 0 } }));
  assert.equal(small.small, true);
  assert.equal(small.state, 'healthy');
  assert.equal(small.noVerdict, null, 'an unrecorded no-verdict count became a number');
  assert.equal(contentSafety(AI({ verdicts: { available: true, evaluated: SMALL_SAMPLE, safe_count: SMALL_SAMPLE, unsafe_count: 0 } })).small, false);
  assert.equal(contentSafety(AI({ verdicts: { available: true, evaluated: 0 } })).state, 'no_data_yet');
  assert.equal(contentSafety(AI({ enforcement: { available: false } })).rules, null, 'an unreadable rule breakdown read as no rules');
  const u = contentSafety(AI({ verdicts: { available: false, reason: 'No table.' } }));
  assert.deepEqual([u.state, u.reason], ['unavailable', 'No table.']);
});

test('delivery enforcement sums the router guard and keeps the legacy audit apart', () => {
  const d = deliveryEnforcement(AI());
  assert.deepEqual([d.checks, d.blocked, d.withheld, d.unavailableGuard, d.state, d.label], [40, 1, 1, 2, 'healthy', '2 enforced']);
  assert.deepEqual(d.legacy, { blocked: 3, flagged: 1 });
  const none = deliveryEnforcement(AI({ guard: { available: true, by_page: [{ checks: 5 }] } }));
  assert.deepEqual([none.state, none.label], ['measured_zero', 'None']);
  assert.equal(deliveryEnforcement(AI({ guard: { available: true, by_page: [] } })).state, 'no_data_yet');
  assert.equal(deliveryEnforcement(AI({ guard: { available: false, reason: 'r' } })).state, 'unavailable');
  // One unreadable table never zeroes the others.
  const split = AI({ guard: { available: false, reason: 'r' } });
  assert.equal(contentSafety(split).n, 40);
});

test('usage anomalies and recent verdicts in words', () => {
  const u = usageAnomalies(AI());
  assert.deepEqual([u.x, u.n, u.state, u.label], [1, 12, 'action_required', '1 flagged']);
  assert.equal(usageAnomalies(AI({ token_anomalies: { available: true, accounts_checked: 4, count: 0 } })).state, 'measured_zero');
  assert.equal(usageAnomalies(AI({ token_anomalies: undefined })).state, 'unavailable');
  const r = recentVerdicts(AI());
  assert.equal(r.state, 'ready');
  assert.deepEqual(r.rows[0], { at: '2026-11-09 15:02:00', feature: 'advisor', verdict: { state: 'unknown', word: 'Unsafe' }, delivery: 'Withheld from the user' });
  assert.deepEqual([r.rows[1].feature, r.rows[1].verdict.word, r.rows[1].delivery], ['Not recorded', 'No verdict', 'Not recorded']);
  assert.equal(recentVerdicts(AI({ recent_verdicts: { available: true, window_days: 7, rows: [] } })).state, 'empty');
  assert.equal(recentVerdicts(AI({ recent_verdicts: { available: false, reason: 'x' } })).rows, null);
  assert.equal(shortWhen('2026-11-06 15:02:00'), '6 Nov 15:02');
  assert.equal(shortWhen(null), null);
});

// ───────────────────────────────────────────────────────── AI render ──

test('AI Safety renders three x-of-n blocks, the HQ-only limit and the recent verdicts on both layouts', () => {
  const out = html(h(AiSafetyWorkspace, { block: AI() }));
  for (const id of ['ai-hq-only', 'ai-content-frac', 'ai-blocked-frac', 'ai-withheld-frac', 'ai-usage-frac', 'ai-recent-table']) {
    assert.match(out, new RegExp(`data-testid="${id}"`), `${id} is missing`);
  }
  const t = renderedText(out);
  assert.match(t, /38 of 40/);
  assert.match(t, /Legacy chat audit, counted apart: 3 turns blocked, 1 flagged/);
  assert.match(t, /2 calls ran while the guard was unavailable/);
  assert.doesNotMatch(t, /%/, 'a rate was drawn');
  assert.doesNotMatch(out, /ai-small-sample/);
  assert.match(html(h(AiSafetyWorkspace, { block: AI({ verdicts: { available: true, evaluated: 2, safe_count: 2, unsafe_count: 0 } }) })), /data-testid="ai-small-sample"/);
});

test('AI Safety: an unreadable block says it is not a zero, and the others still draw', () => {
  const out = html(h(AiSafetyWorkspace, { block: AI({ guard: { available: false, reason: 'Guard table missing.' } }) }));
  assert.match(out, /data-testid="ai-delivery" data-state="unavailable"/);
  assert.match(renderedText(out), /Guard table missing\. This is not a zero\./);
  assert.match(out, /data-testid="ai-content-frac"/);
  assert.match(text(h(AiSafetyWorkspace, { block: null, unreadable: true, onRetry: () => {} })), /not a claim that nothing was blocked or flagged/);
  assert.match(html(h(AiSafetyWorkspace, { block: AI({ recent_verdicts: { available: true, window_days: 7, rows: [] } }) })), /data-testid="ai-recent-empty"/);
});

const consoleHtml = (tab, data) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [`/admin/security?tab=${tab}`] },
    h(SecurityConsole, {
      tab, data, load: () => {}, feed: null, filter: 'all', setFilter: () => {},
      loadFeed: () => {}, sessionList: null, loadSessions: () => {}, onSessionAct: async () => ({}),
    })),
);

test('on the page, each workspace leads and keeps the previous zone behind "How this is measured"', () => {
  const data = { backup_dr: BACKUP(PASSED()), ai_safety: AI() };
  const res = consoleHtml('resilience', data);
  assert.match(res, /data-testid="resilience-workspace"/);
  assert.ok(res.indexOf('res-drill') < res.indexOf('res-how'), 'the drill does not lead');
  assert.ok(res.indexOf('res-how') < res.indexOf('hq-restore-drill'), 'the previous zone is not behind the disclosure');
  const ai = consoleHtml('ai-safety', data);
  assert.match(ai, /data-testid="ai-safety-workspace"/);
  assert.ok(ai.indexOf('ai-how') < ai.indexOf('hq-ai-safety'), 'the previous zone is not behind the disclosure');
});

test('an unreadable overview is said once on these workspaces, in their own words', () => {
  for (const [tab, words] of [['resilience', /backup and drill evidence/], ['ai-safety', /AI safety figures/]]) {
    const t = renderedText(consoleHtml(tab, UNAVAILABLE));
    // Before the disclosure: the workspace's own Unreadable, not the page banner as well.
    const lead = t.slice(0, t.indexOf('How this is measured'));
    assert.match(lead, words);
    assert.doesNotMatch(lead, /not a claim that nothing happened/, `${tab} drew the page banner as well`);
  }
});
