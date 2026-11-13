/**
 * D4860 part 4 (#4860) — the Platform overview reads the incidents the Worker
 * detects (D4854, `health` on the summary) and uses ONE severity rule, the
 * Worker's.
 *
 * WHAT IT HOLDS:
 *   · the page's thresholds are the Worker's (`services/platformHealth.ts`);
 *   · a summary with no `health` (an older Worker) reads Not recorded, never 0;
 *   · zero, one and several detected incidents: the count, the list, the
 *     queue items at the Worker's severity, each with its console and runbook;
 *   · a detected incident replaces the page's own item for its signal, so the
 *     same signal never reads Critical in the strip and High in the list;
 *   · a signal the Worker could not judge is named, not counted as healthy;
 *   · published incidents stay apart, and the "#4854" not-yet sentences are gone.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_detected_d4860.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installAppDom, select } from './_appDom.mjs';
import {
  signals, platformHealth, attention, detectedIncidents,
  DLQ_HIGH, WEBHOOK_REFUSED_RUN, WEBHOOK_CRITICAL_RUN, WEBHOOK_SILENCE_HOURS,
} from '../src/pages/hq/platformOverviewModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
// The page reads the real clock itself, so every fixture stamp is relative to this minute.
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000); // clock-ok: relative
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
const U = Symbol('unavailable');
const RUNBOOK = 'documentation/operations/PLATFORM_OBSERVABILITY.md';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const triggers = () => Array.from({ length: 3 }, (_, i) => ({
  trigger_name: `*/${i + 5} * * * *`, name: `Job ${i + 1}`, state: 'ok', last_started_at: ago(7), status: 'ok', expected_at: ago(7), error: null,
}));

/** A healthy summary: every core signal read and fine, the webhook delivering. */
function summary(over = {}) {
  return {
    integrations: { available: true, total: 2, unhealthy: 0, providers: [{ provider: 'slack', by_status: { connected: 2 } }] },
    jobs: { available: true, grace_minutes: 10, failing: 0, stale: 0, never: 0, triggers: triggers() },
    monitoring: {
      dlq: { available: true, total: 0, legacy: 0, mirror: 0 },
      incidents: { available: true, window_days: 7, count: 2, basis: 'Entered for the status page.' },
    },
    broadcast: { telegram: { available: true, token_configured: true, channels: [] }, x: { available: true, client_configured: true } },
    switches: { available: true, items: [] },
    integration_keys: { available: true, managed: 0, db_readable: true, counts: { env: 0, db: 0, unset: 0, unreadable: 0 }, items: [], last_set_available: true, notes: [] },
    github_sync: { target: { configured: true }, window: { available: true, window_hours: 24, synced: 1, failed: 0 }, recent: { available: true, items: [] } },
    payments_catalog: {
      publishable: { configured: true, mode: 'live' },
      catalog: { available: true, products: { all: 2, active: 2 }, prices: { all: 2, active: 2 }, last_written_at: ago(60) },
      webhook: { available: true, window_hours: 24, deliveries: 4, not_2xx: 0,
        last: { status_code: 200, latency_ms: 30, at: ago(20) }, last_success: { status_code: 200, at: ago(20) }, last_failure: null,
        consecutive_failures: 0, consecutive_failures_capped: false, hours: [], basis: 'Read from the request log.' },
    },
    ...over,
  };
}

const remediation = (kind) => ({
  webhook: { surface: { label: 'Payments › Stripe connection', href: '/admin/platform/payments/stripe' }, runbook: { label: 'Runbook: the Stripe webhook is refusing or silent', doc: `${RUNBOOK}#72-the-stripe-webhook-is-refusing-or-silent` } },
  dlq: { surface: null, runbook: { label: 'Runbook: dead letters are waiting', doc: `${RUNBOOK}#73-dead-letters-are-waiting` } },
  meeting_bot: { surface: { label: 'Platform › Meeting bots', href: '/admin/platform/meeting-bots' }, runbook: { label: 'Runbook: the meeting bot is not starting', doc: `${RUNBOOK}#75-the-meeting-bot-is-not-starting` } },
}[kind]);
const incident = (key, kind, severity, title, since = ago(90)) => ({
  key, kind, severity, title, detail: `${title}.`, since, observed_at: NOW.toISOString(), remediation: remediation(kind),
});
const health = (state, detected, extra = {}) => ({
  state, observed_at: NOW.toISOString(), detected, unknown: [], not_detected: [{ signal: 'Meeting bot staged diagnostics', reason: 'Kept per run in R2 with no index.' }],
  published: { available: true, count: 2, window_days: 7, manual: true, note: 'Entered by hand.' }, telemetry: null, webhook: null, thresholds: {}, ...extra,
});

const TELEMETRY_UP = { available: true, rows: [], window_minutes: 60, range: null, as_of: '2026-11-07 14:20:00' };
const DEPS = { registry_available: true, deployments: [] };
const BUILD = { commit: '8f3a2c1d4e5f60718293a4b5c6d7e8f901234567', environment: 'production', deployed_at: null };

const run = (data, { traffic = TELEMETRY_UP, deps = DEPS } = {}) => {
  const sigs = signals({ data, deps, traffic, now: NOW, observed: { summary: NOW }, UNAVAILABLE: U });
  return { sigs, health: platformHealth(sigs, { summaryDown: data === U, loading: data === null }), items: attention(sigs) };
};
const sig = (r, k) => r.sigs.find((s) => s.key === k);

/* ── the real page, mounted with the Worker stubbed ─────────────────── */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mountPage(data) {
  const fetch = async (input) => {
    const url = String(input?.url || input);
    await null;
    if (/\/api\/admin\/platform\/summary(\?|$)/.test(url)) return json(data);
    if (/\/api\/admin\/deployments(\?|$)/.test(url)) return json(DEPS);
    if (/\/api\/monitoring\/analytics\/traffic-by-branch/.test(url)) return json(TELEMETRY_UP);
    if (/\/api\/admin\/platform-build(\?|$)/.test(url)) return json(BUILD);
    if (/\/api\/auth\/me(\?|$)/.test(url)) return json({ id: 9106, role: 'admin', is_super_admin: 1 });
    return json({});
  };
  const dom = installAppDom({ fetch, url: 'http://localhost/admin/platform' });
  localStorage.setItem('user', JSON.stringify({ id: 9106, role: 'admin', is_super_admin: 1, name: 'HQ' }));
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const PlatformPage = (await import('../src/pages/hq/PlatformPage.jsx')).default;
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  const root = createRoot(host);
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  try {
    await act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin/platform'] }, React.createElement(PlatformPage)));
    });
    for (let i = 0; i < 20; i += 1) await act(() => new Promise((r) => setImmediate(r)));
  } finally {
    console.error = error;
    console.warn = warn;
  }
  const byTestId = (id) => select(host, `[data-testid="${id}"]`);
  return {
    byTestId,
    text: (n = host) => String(n.textContent || '').replace(/\s+/g, ' ').trim(),
    attr: (n, a) => n.getAttribute(a),
    async close() { await act(async () => root.unmount()); dom.timers.clear(); dom.restore(); },
  };
}

/* ── the tests ───────────────────────────────────────────────────────── */

test('the page uses the Worker\'s thresholds', () => {
  // Mutation checked: WEBHOOK_CRITICAL_RUN back to 3 → the first equality fails.
  const ts = read('cloudflare-worker/src/services/platformHealth.ts');
  const worker = (name) => Number(ts.match(new RegExp(`export const ${name} = (\\d+);`))?.[1]);
  assert.equal(WEBHOOK_CRITICAL_RUN, worker('WEBHOOK_FAILURE_CRITICAL'));
  assert.equal(WEBHOOK_REFUSED_RUN, worker('WEBHOOK_FAILURE_STREAK'));
  assert.equal(DLQ_HIGH, worker('DLQ_HIGH'));
  // #4860 Q4 = B: one silence threshold, 24 h, on both.
  assert.equal(WEBHOOK_SILENCE_HOURS, worker('WEBHOOK_SILENCE_HOURS'));
});

test('without detected incidents, the page\'s own reading is on the Worker\'s scale: a backlog is never Critical', () => {
  // Mutation checked: the DLQ status restored to Critical at 100 → health reads Critical.
  const data = summary({ monitoring: { dlq: { available: true, total: 140, legacy: 40, mirror: 100 }, incidents: { available: true, window_days: 7, count: 0 } } });
  const r = run(data);
  assert.equal(sig(r, 'dlq').status, 'Degraded');
  assert.equal(r.items.find((i) => i.signal === 'dlq').severity, 'High');
  assert.equal(r.health.state, 'Degraded');
  // Five refusals in a row: High and Degraded; ten: Critical.
  const refused = (n) => {
    const d = summary();
    d.payments_catalog.webhook = { ...d.payments_catalog.webhook, not_2xx: n, last: { status_code: 500, latency_ms: 9, at: ago(1) }, consecutive_failures: n };
    return run(d);
  };
  assert.equal(sig(refused(5), 'webhook').status, 'Degraded');
  assert.equal(refused(5).items.find((i) => i.signal === 'webhook').severity, 'High');
  assert.equal(sig(refused(10), 'webhook').status, 'Critical');
  assert.equal(refused(10).health.state, 'Critical');
});

test('webhook silence is a Low note and does not lower health on its own', () => {
  // Mutation checked: the `note` exclusion removed from platformHealth → Degraded.
  const d = summary();
  d.payments_catalog.webhook = { ...d.payments_catalog.webhook, deliveries: 0, last: { status_code: 200, latency_ms: 30, at: ago(30 * 60) } };
  const r = run(d);
  assert.equal(sig(r, 'webhook').status, 'Stale');
  assert.equal(r.items.find((i) => i.signal === 'webhook').severity, 'Low');
  assert.equal(r.health.state, 'Healthy');
});

test('no `health` on the summary reads Not recorded, never 0', async () => {
  // Mutation checked: detectedIncidents returning { available: true, items: [] } for an
  // absent health → the not-recorded line disappears and "None detected" shows.
  assert.equal(detectedIncidents(null), null);
  assert.equal(detectedIncidents(summary()).available, false);
  assert.equal(detectedIncidents(summary({ health: { state: 'nonsense', detected: [] } })).available, false);
  const page = await mountPage(summary());
  try {
    assert.equal(page.byTestId('hq-incidents-not-recorded').length, 1);
    assert.equal(page.byTestId('hq-incidents-none').length, 0);
    assert.equal(page.byTestId('hq-detected-count').length, 0, 'the Infrastructure block counted incidents nobody reported');
    assert.match(page.text(page.byTestId('hq-incidents-published')[0]), /2 in the last 7 d, entered by hand/);
  } finally { await page.close(); }
});

test('zero detected incidents: None detected, and 0 in the Infrastructure block', async () => {
  const page = await mountPage(summary({ health: health('healthy', []) }));
  try {
    assert.equal(page.byTestId('hq-incidents-none').length, 1);
    assert.equal(page.text(page.byTestId('hq-detected-count')[0]), '0');
    assert.equal(page.byTestId('hq-incidents-item').length, 0);
    assert.equal(page.byTestId('hq-attention-detected').length, 0);
    assert.equal(page.attr(page.byTestId('hq-platform-health')[0], 'data-health'), 'Healthy');
  } finally { await page.close(); }
});

test('one detected incident replaces the page\'s own item for its signal, at the Worker\'s severity, with its runbook', async () => {
  // Mutation checked: `s.items = mine` removed from foldDetected → two webhook items in the queue.
  const data = summary({ health: health('degraded', [incident('webhook:failures', 'webhook', 'high', 'The Stripe webhook refused 4 deliveries in a row')]) });
  data.payments_catalog.webhook = { ...data.payments_catalog.webhook, not_2xx: 4, last: { status_code: 500, latency_ms: 9, at: ago(1) }, consecutive_failures: 4 };
  const r = run(data);
  const wh = r.items.filter((i) => i.signal === 'webhook');
  assert.equal(wh.length, 1);
  assert.equal(wh[0].severity, 'High');
  assert.equal(wh[0].detected, true);
  assert.equal(sig(r, 'webhook').status, 'Degraded');
  const page = await mountPage(data);
  try {
    const rows = page.byTestId('hq-attention-item').filter((n) => /refused 4 deliveries/.test(page.text(n)));
    assert.equal(rows.length, 1);
    assert.equal(page.attr(rows[0], 'data-severity'), 'High');
    const runbook = page.byTestId('hq-attention-runbook')[0];
    assert.match(page.attr(runbook, 'href'), /^https:\/\/github\.com\/AxalNetwork\/StudioOS\/blob\/main\/documentation\/operations\/PLATFORM_OBSERVABILITY\.md#72-/);
    assert.ok(page.text(rows[0]).includes('Open Payments › Stripe connection'));
    assert.equal(page.text(page.byTestId('hq-detected-count')[0]), '1');
    assert.match(page.text(page.byTestId('hq-incidents-summary')[0]), /1 detected · 1 High/);
  } finally { await page.close(); }
});

test('several detected incidents: Critical leads, a kind with no signal gets one, and no signal reads two severities', () => {
  // Mutation checked: the Critical upgrade in foldDetected removed → health reads Degraded.
  const data = summary({
    monitoring: { dlq: { available: true, total: 140, legacy: 40, mirror: 100 }, incidents: { available: true, window_days: 7, count: 0 } },
    health: health('critical', [
      incident('webhook:failures', 'webhook', 'critical', 'The Stripe webhook refused 12 deliveries in a row'),
      incident('dlq:backlog', 'dlq', 'high', '140 dead letters are waiting', null),
      incident('meeting_bot:start_failed', 'meeting_bot', 'medium', 'The meeting bot failed to start'),
    ]),
  });
  data.payments_catalog.webhook = { ...data.payments_catalog.webhook, not_2xx: 12, last: { status_code: 500, latency_ms: 9, at: ago(1) }, consecutive_failures: 12 };
  const r = run(data);
  assert.equal(r.health.state, 'Critical');
  assert.deepEqual(r.items.filter((i) => i.detected).map((i) => i.severity), ['Critical', 'High', 'Medium']);
  assert.equal(r.items[0].severity, 'Critical');
  assert.equal(sig(r, 'meeting_bot').status, 'Degraded');
  // The strip and the list agree, signal by signal.
  const word = { Critical: 'Critical', High: 'Degraded', Medium: 'Degraded' };
  for (const s of r.sigs.filter((x) => x.items.some((i) => i.detected))) {
    const worst = s.items.map((i) => i.severity).sort((a, b) => ['Critical', 'High', 'Medium', 'Low'].indexOf(a) - ['Critical', 'High', 'Medium', 'Low'].indexOf(b))[0];
    assert.equal(s.status, word[worst], `${s.name} reads ${s.status} in the strip and ${worst} in the list`);
  }
  // A DLQ item without a console links Monitoring, never nowhere.
  assert.equal(r.items.find((i) => i.key === 'dlq:backlog').link.to, '/monitoring');
});

test('the page never reads a covered signal Critical when the Worker detected nothing critical', () => {
  // Mutation checked: the covered-signal cap removed → the webhook reads Critical.
  // The page's own log read counts ten refusals; the Worker's streak read judged the run High.
  const data = summary({ health: health('degraded', [incident('webhook:failures', 'webhook', 'high', 'The Stripe webhook refused at least 9 deliveries in a row')]) });
  data.payments_catalog.webhook = { ...data.payments_catalog.webhook, not_2xx: 10, last: { status_code: 500, latency_ms: 9, at: ago(1) }, consecutive_failures: 10 };
  const r = run(data);
  assert.equal(sig(r, 'webhook').status, 'Degraded');
  assert.equal(r.health.state, 'Degraded');
  // A branch reported unhealthy is Degraded on both scales.
  const deps = { registry_available: true, deployments: [{ code: 'eu', live_state: 'ok', live: { db_ok: false, detail: 'D1 refused' } }] };
  const b = run(summary({ health: health('degraded', [{ ...incident('branch:eu', 'branch', 'medium', 'Branch eu reported unhealthy at its last check'), remediation: { surface: { label: 'Platform › Deployments', href: '/admin/platform' }, runbook: { label: 'Runbook', doc: `${RUNBOOK}#76` } } }]) }), { deps });
  assert.equal(sig(b, 'branches').status, 'Degraded');
});

test('a signal the Worker could not judge is named, and published incidents stay apart', async () => {
  const data = summary({ health: health('unknown', [], { unknown: [{ signal: 'Stripe webhook', reason: 'The request log could not be read.' }] }) });
  const page = await mountPage(data);
  try {
    assert.match(page.text(page.byTestId('hq-incidents-unknown')[0]), /Could not be judged Stripe webhook: The request log could not be read\./);
    assert.match(page.text(page.byTestId('hq-incidents-detected')[0]), /None detected, among the signals that could be judged/);
    assert.match(page.text(page.byTestId('hq-incidents-not-detected')[0]), /Meeting bot staged diagnostics/);
  } finally { await page.close(); }
});

test('the "#4854" not-yet sentences are gone', () => {
  const src = read('frontend/src/pages/hq/PlatformOverview.jsx');
  assert.doesNotMatch(src, /#4854/);
  assert.doesNotMatch(src, /nothing detects incidents/);
  assert.doesNotMatch(src, /<Status s="Not recorded" label="Not recorded" \/><\/KV>/);
});
