/**
 * D4854 (#4854) — the Health zone on HQ · Platform.
 *
 * What is pinned: the state in words and a symbol; each detected incident with its severity, since, observed time
 * and its remediation links (the console, and the runbook on the repository); unknown signals listed; missing
 * telemetry drawn as unreadable with a retry, never as zero; published incidents shown apart, as entered by hand;
 * an unreadable summary is unknown, not healthy.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_health_4854.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { HealthPanel, runbookHref, telemetryLine } from '../src/pages/hq/PlatformPage.jsx';
import { GUIDE_PREFIX } from '../src/lib/integrationKeys.js';

const PAGE = readFileSync(resolve(process.cwd(), 'frontend/src/pages/hq/PlatformPage.jsx'), 'utf8');
const render = (props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(HealthPanel, props)));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const TEL_OK = { status: 'healthy', binding_present: true, read_configured: true, answered: true, last_event_at: '2026-11-07 11:59:00', events_in_window: 1200, window_hours: 24, last_successful_read_at: '2026-11-07T12:00:00.000Z', coverage: 'HQ reads the shared dataset.', reason: null };
const WEBHOOK = {
  key: 'webhook:failures', kind: 'webhook', severity: 'high', title: 'The Stripe webhook refused 4 deliveries in a row',
  detail: 'Last success 2026-11-07 08:00:00.', since: '2026-11-07 09:00:00', observed_at: '2026-11-07T12:00:00.000Z',
  remediation: { surface: { label: 'Payments › Stripe connection', href: '/admin/platform/payments/stripe' }, runbook: { label: 'Runbook: the Stripe webhook is refusing or silent', doc: 'documentation/operations/PLATFORM_OBSERVABILITY.md#72-the-stripe-webhook-is-refusing-or-silent' } },
};
const base = (over = {}) => ({
  state: 'healthy', observed_at: '2026-11-07T12:00:00.000Z', detected: [], unknown: [], telemetry: TEL_OK,
  published: { available: true, count: 2, window_days: 30, manual: true, note: 'Published incidents are entered by hand.' },
  not_detected: [{ signal: 'Branch Worker and database health', reason: 'Read by Deployments.' }],
  ...over,
});

test('healthy: the state in words, nothing detected, telemetry current, published apart', () => {
  const t = text(render({ health: base() }));
  assert.match(t, /● Healthy nothing detected/);
  assert.match(t, /Telemetry Readable, current · last event 2026-11-07 11:59 · 1,200 requests in 24h · last good read 2026-11-07 12:00 · write binding present/);
  assert.match(t, /Published incidents 2 in 30 days, entered by hand/);
  assert.match(t, /Not detected here: Branch Worker and database health/);
  assert.doesNotMatch(t, /could not be read/);
});

test('a detected incident: severity, since and observed, with the console and the runbook', () => {
  const html = render({ health: base({ state: 'degraded', detected: [WEBHOOK] }) });
  const t = text(html);
  assert.match(t, /▲ Degraded 1 detected/);
  assert.match(t, /The Stripe webhook refused 4 deliveries in a row High/);
  assert.match(t, /Detected · since 2026-11-07 09:00 · observed 2026-11-07 12:00/);
  assert.match(html, /href="\/admin\/platform\/payments\/stripe"/);
  assert.match(html, new RegExp(`href="${GUIDE_PREFIX.replace(/[.]/g, '\\.')}operations/PLATFORM_OBSERVABILITY\\.md#72-the-stripe-webhook-is-refusing-or-silent"`));
  assert.match(t, /Published incidents 2 in 30 days/, 'published stays apart from what is detected');
});

test('missing telemetry is unreadable with a retry, never zero; stale is said as stale', () => {
  const down = { ...TEL_OK, status: 'not_configured', answered: false, last_event_at: null, events_in_window: null, last_successful_read_at: null };
  const t = text(render({ health: base({ state: 'degraded', telemetry: down }), onRetry: () => {} }));
  assert.match(t, /Read not configured · last event not recorded · last good read not recorded/);
  assert.doesNotMatch(t, /0 requests/, 'an unread count is never drawn as zero');
  assert.match(t, /Telemetry could not be read\. Traffic, latency and errors are unknown, not zero\. Retry/);
  const stale = text(render({ health: base({ telemetry: { ...TEL_OK, status: 'stale' } }), onRetry: () => {} }));
  assert.match(stale, /Readable, but stale/);
  assert.doesNotMatch(stale, /Retry/);
  assert.equal(telemetryLine(null), 'Telemetry health was not reported.');
});

test('unknown signals are listed, and an unreadable summary is unknown rather than healthy', () => {
  const t = text(render({ health: base({ state: 'unknown', unknown: [{ signal: 'Dead letters', reason: 'DLQ down.' }] }) }));
  assert.match(t, /\? Unknown nothing detected · 1 could not be judged/);
  assert.match(t, /Dead letters: DLQ down\./);
  assert.match(text(render({ unreadable: true })), /its health is unknown, not healthy/);
  assert.match(text(render({ health: { state: 'mystery' } })), /its health is unknown, not healthy/);
  assert.match(text(render({ health: base({ published: { available: false, reason: 'The incident table could not be read.', manual: true, note: 'n' } }) })), /Published incidents The incident table could not be read\./);
});

test('runbookHref builds the repository link; the zone is mounted first and passes its reads', () => {
  assert.equal(runbookHref('documentation/operations/X.md#a'), `${GUIDE_PREFIX}operations/X.md#a`);
  assert.equal(runbookHref(''), null);
  assert.equal(runbookHref(undefined), null);
  const first = PAGE.indexOf('<Zone title="Health"');
  assert.ok(first > 0 && first < PAGE.indexOf('<Zone title="Keys and connections"'), 'Health is the first zone');
  assert.match(PAGE, /<Zone title="Health"[^>]*reads=\{\[reads\.telemetry, reads\.cron_streaks, reads\.webhook_health\]\}/);
  assert.match(PAGE, /<HealthPanel [^>]*health=\{ready \? data\.health : null\} onRetry=\{load\}/);
});
