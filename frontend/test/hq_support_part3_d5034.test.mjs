/**
 * D5034 (#5034) part 3 — Eadwyn's Support steps on the rail, the matrix's
 * operator names, subsidiary figures dated when older than HQ's, and the
 * offline state. Rendered from props, and the page's wiring read from source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import { supportRailSteps, branchFreshness, offlineText, queueOverview } from '../src/pages/hq/support/supportWorkspaceModel.js';
import { FreshnessLine, OfflineBanner, SupportHeader, SubsidiariesLine, BranchesWorkspace } from '../src/pages/hq/support/SupportWorkspaces.jsx';
import { DecisionSheetView } from '../src/pages/hq/support/DecisionSheet.jsx';
import { mergeSupport, TenantMatrix, MATRIX_COLUMNS, UNAVAILABLE } from '../src/pages/hq/HqSupportPage.jsx';
import RailSteps from '../src/ui/RailSteps.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE = codeOnly(readFileSync(resolve(root, 'frontend/src/pages/hq/HqSupportPage.jsx'), 'utf8'));
const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const text = renderedText;

const fig = (value, partial = false) => ({ value, partial });

// ─────────────────────────────────────────────────────────── Eadwyn ──

test('Eadwyn shows this page’s next steps, each linking to where the work is, and acts on nothing', () => {
  const overview = { state: 'active', pastSla: fig(2), dueSoon: fig(3, true), subsidiaries: { state: 'partial', unread: ['Axal VC Spain'] } };
  const steps = supportRailSteps({ overview, recorded: [{ uid: 'a', pushed: { ok: false } }], distribution: { state: 'incomplete', current: 2, total: 3 } });
  assert.equal(steps.title, 'For Support');
  assert.equal(steps.state, 'ready');
  assert.deepEqual(steps.items.map((s) => [s.key, s.tone, s.to]), [
    ['past', 'act', '/admin/hq-support?tab=queue'],
    ['due', 'info', '/admin/hq-support?tab=queue'],
    ['delivery', 'act', '/admin/hq-support?tab=delivery'],
    ['policy', 'act', '/admin/hq-support?tab=policy'],
    ['branches', 'info', '/admin/hq-support?tab=branches'],
  ]);
  assert.match(steps.items[1].text, /^3\+ due soon\./, 'a floor lost its plus on the rail');
  assert.match(steps.items[2].text, /1 decision recorded at HQ but not delivered\./);
  assert.match(steps.items[3].text, /applied on 2 of 3 subsidiaries/);
  assert.match(steps.items[4].text, /Not read: Axal VC Spain\./);
  assert.match(steps.foot, /changes nothing\. You record every decision\./);
  const html = render(RailSteps, { steps, title: steps.title });
  assert.match(text(html), /For Support · 5/);
  assert.match(html, /href="\/admin\/hq-support\?tab=delivery"/);
});

test('the rail never turns an unknown into nothing: failed, loading, all clear and HQ clear are four states', () => {
  assert.equal(supportRailSteps({ failed: true }).state, 'unavailable');
  assert.match(supportRailSteps({ failed: true }).text, /unknown, not none/);
  assert.equal(supportRailSteps({ overview: { state: 'loading' } }).state, 'loading');
  const clear = queueOverview({
    escalations: { available: true, complete: true, count: 0, bands: { ok: 0, due_soon: 0, past: 0 }, items: [] },
    tickets: { available: true, buckets: { hq_held: { count: 0, bands: { past: 0, due_soon: 0 }, items: [] }, admin_product: { count: 0, bands: { past: 0, due_soon: 0 }, items: [] } } },
    branch_tickets: { lines: [] },
  });
  assert.deepEqual(supportRailSteps({ overview: clear, recorded: [] }), { title: 'For Support', state: 'empty', text: 'Nothing is waiting at HQ, and every source answered.' });
  // Open work that is all on time is not "all clear": the rail says only that no step is needed.
  const onTime = supportRailSteps({ overview: { state: 'active', pastSla: fig(0), dueSoon: fig(0), subsidiaries: { state: 'zero' } }, recorded: [] });
  assert.deepEqual(onTime, { title: 'For Support', state: 'empty', text: 'Nothing on this page needs a step from you.' });
  const hqClear = { state: 'hq_clear', pastSla: fig(0), dueSoon: fig(0), subsidiaries: { state: 'failed' } };
  const s = supportRailSteps({ overview: hqClear, recorded: [] });
  assert.equal(s.state, 'ready', 'an unread subsidiary was called all clear on the rail');
  assert.deepEqual(s.items.map((i) => i.key), ['branches']);
});

test('the page hands the rail its steps, so the model list and prices give way to Support’s work', () => {
  assert.ok(PAGE.includes('steps={railSteps}'));
  assert.ok(PAGE.includes('const railSteps = supportRailSteps({ overview, recorded, distribution, failed, onRetry: load });'));
});

// ─────────────────────────────────────────────────────────── matrix ──

test('the matrix is Queues by subsidiary, with a caption, column headers and its reasons behind a disclosure', () => {
  assert.deepEqual(MATRIX_COLUMNS, ['Subsidiary', 'Escalations', 'Customer tickets on HQ', 'Subsidiary admin tickets']);
  const matrix = { available: true, rows: [
    { key: 'hq', kind: 'hq', label: 'HQ', escalations: { value: null, why: 'does_not_apply', reason: 'HQ raises no escalation to itself.' }, hq_held: { value: 2 }, about_admin: { value: null, why: 'does_not_apply', reason: 'Subsidiary administrators.' } },
  ] };
  const html = render(TenantMatrix, { matrix });
  assert.match(html, /<caption class="sr-only">Open items by subsidiary and queue/);
  assert.match(html, /<details[^>]*data-testid="hq-support-matrix-explain"><summary[^>]*>What each cell means<\/summary>/);
  assert.match(text(html), /HQ raises no escalation to itself\./, 'a reason is no longer in the page at all');
  assert.doesNotMatch(html, /Tenant × queue/);
});

// ─────────────────────────────────────────────────────────── stale ──

test('subsidiary figures older than HQ’s read are dated, never mixed in silently', () => {
  assert.equal(branchFreshness('2026-11-09T09:00:00Z', '2026-11-09T09:00:00Z'), null);
  assert.equal(branchFreshness('2026-11-09T09:00:00Z', null), null);
  const late = branchFreshness('2026-11-09T09:05:00Z', '2026-11-09T08:30:00Z');
  assert.equal(late.text, 'Subsidiary figures are from the 08:30 UTC read; the latest subsidiary read did not complete.');
  const asking = branchFreshness('2026-11-09T09:05:00Z', '2026-11-09T08:30:00Z', { asking: true });
  assert.match(asking.text, /asking each subsidiary again…$/);
  const line = render(FreshnessLine, { freshness: late, onRetry() {} });
  assert.match(line, /role="status"/);
  assert.match(text(line), /StaleSubsidiary figures are from the 08:30 UTC read/);
  assert.match(text(line), /Retry/);
  assert.match(text(render(SubsidiariesLine, { line: { state: 'open', text: '3 of 3 responding' }, freshness: late })), /08:30 UTC read/);
  const cards = [{ code: 'fr', label: 'Axal VC France', state: 'connected', open: 2, past: 0, oldest: '3h' }];
  const br = render(BranchesWorkspace, { data: {}, cards, branchState: 'ready', freshness: asking, onRetry() {} });
  assert.match(text(br), /asking each subsidiary again…/);
  assert.doesNotMatch(text(br), /Retry/, 'a retry is offered while the subsidiaries are already being asked');
});

test('mergeSupport says which read the branch parts are from, the older one included', () => {
  const local = { read_at: '2026-11-09T09:05:00Z', escalations: {}, tickets: {}, sla_policy: {} };
  const full = { read_at: '2026-11-09T08:30:00Z', branch_tickets: { lines: [] }, sla_policy: {} };
  const merged = mergeSupport(local, full);
  assert.equal(merged.branchReadAt, '2026-11-09T08:30:00Z');
  assert.equal(merged.data.read_at, '2026-11-09T09:05:00Z');
  assert.equal(mergeSupport(local, null).branchReadAt, null);
  assert.equal(mergeSupport(local, UNAVAILABLE).branchReadAt, null);
  assert.ok(PAGE.includes('const freshness = branchFreshness(ready?.read_at, branchReadAt, { asking: branchBusy });'));
});

// ────────────────────────────────────────────────────────── offline ──

test('offline: the last read stays and says which it is; Refresh and recording wait for the connection', () => {
  assert.equal(offlineText('14:30'), "You're offline. Showing the 14:30 UTC read. Decisions can't be recorded until you reconnect.");
  assert.match(offlineText(null), /Showing the last read\./);
  const banner = render(OfflineBanner, { text: offlineText('14:30') });
  assert.match(banner, /role="status"/);
  const head = render(SupportHeader, { readAt: '14:30', sources: 'x', onRefresh() {}, offline: true });
  assert.match(head, /disabled=""[^>]*data-testid="hq-support-refresh"|data-testid="hq-support-refresh"[^>]*disabled=""/);
  const item = { uid: 'e1', branch_code: 'fr', kind: 'other', subject: 'Other', sla: 'ok', age_hours: 2 };
  const sheet = render(DecisionSheetView, { item, phase: 'decide', outcome: 'answered', reason: 'Granted.', offline: true, onChoose() {}, onReason() {}, onSubmit() {}, onClose() {} });
  assert.match(sheet, /disabled=""[^>]*data-testid="hq-support-sheet-submit"/);
  assert.match(text(sheet), /You're offline: this decision can't be recorded until you reconnect\. What you typed stays here\./);
  const online = render(DecisionSheetView, { item, phase: 'decide', outcome: 'answered', reason: 'Granted.', onChoose() {}, onReason() {}, onSubmit() {}, onClose() {} });
  assert.doesNotMatch(online, /hq-support-sheet-offline/);
  // The page: the banner, the sheet's flag, and a submit that sends nothing offline.
  assert.ok(PAGE.includes('{!online && <OfflineBanner text={offlineText(readAt)} />}'));
  assert.ok(PAGE.includes('offline={!online}'));
  assert.ok(PAGE.includes('if (busy || offline) return;'), 'a decision is sent while offline');
});
