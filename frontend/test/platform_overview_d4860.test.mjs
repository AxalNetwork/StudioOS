/**
 * D4860 (#4860) — HQ · Platform v2's overview, held to the canvas's
 * priorities and its warning states.
 *
 * WHAT IS RENDERED. The real `PlatformPage`, mounted in `_appDom.mjs`'s
 * document inside a MemoryRouter, with effects running and every request
 * answered by a stub of the Worker: the platform summary, the deployments
 * registry, traffic by branch and the build route each answer a fixture
 * shaped as those routes answer, and anything else answers `{}`. The page
 * reads, settles, and the DOM is read back. The model's rules are also run
 * on their own, for the states a page fixture would make noisy.
 *
 * WHAT IT HOLDS (the issue's acceptance, "browser-grounded regression
 * coverage"):
 *   · health first, Needs attention second, then core systems; the old cron
 *     band no longer leads, and the detail zones come after the overview;
 *   · telemetry unavailable → Degraded (or Unknown), never Healthy;
 *   · webhook silence is Stale, never Healthy, though "0 not 2xx";
 *   · an unbound channel is a warning in the queue;
 *   · an unset optional key is not a problem: no queue item names it;
 *   · Critical outranks everything, and an empty queue with unknown signals
 *     is not an all-clear.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_overview_d4860.test.mjs
 */
import test, { beforeEach } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { waitUntil } from './_waitUntil.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installAppDom, select } from './_appDom.mjs';
import {
  signals, platformHealth, attention, webhookHealth, switchRows, keyLevels, channelState,
  coverage, CONSOLE_GROUPS, PREVIEW_CONSOLES, SEVERITIES, STATUS,
} from '../src/pages/hq/platformOverviewModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
// D5504: only the business Date clock is scoped; scheduling remains real.
const NOW = new Date('2026-11-07T14:20:00Z');
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: NOW }));
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
const H = 60;
const D = 24 * H;
const U = Symbol('unavailable');

/* ── fixtures: the live-state examples in the brief ─────────────────── */

const triggers = (state = 'ok') => Array.from({ length: 6 }, (_, i) => ({
  trigger_name: `*/${i + 5} * * * *`, name: `Job ${i + 1}`, state, last_started_at: ago(7), status: 'ok', expected_at: ago(7), error: null,
}));
const SWITCHES = [
  { key: 'eadwyn_off', label: 'Eadwyn off', state: 'off', set_by: 'operator', effect: 'Eadwyn answers every message with a notice.', writable: true, deploy: 'off',
    operator: { available: true, thrown: false, reason: 'test window', set_by_user_id: 1, set_by_name: 'HQ', set_at: ago(3 * D), revision: 2 } },
  { key: 'eadwyn_rerank_off', label: 'Eadwyn question reranking off', state: 'off', set_by: 'deploy', effect: '…' },
  { key: 'ai_budget_trip', label: 'AI budget trip', state: 'off', set_by: 'runtime', effect: 'Every AI call on the platform is refused.' },
  { key: 'session_charging', label: 'Session charging', state: 'off', set_by: 'deploy', effect: 'Priced sessions are charged through Stripe.' },
  { key: 'stripe_tax', label: 'Stripe Tax', state: 'off', set_by: 'deploy', effect: '…' },
  { key: 'cf_queue', label: 'Cloudflare Queue', state: 'on', set_by: 'deploy', effect: '…' },
  { key: 'market_sources_live', label: 'Live market sources', state: 'on', set_by: 'deploy', effect: '…', count: { on: 6, of: 24 } },
  { key: 'diligence_connectors_live', label: 'Live diligence connectors', state: 'off', set_by: 'deploy', effect: '…', count: { on: 0, of: 9 } },
];
const KEYS = ['slack', 'hubspot', 'salesforce', 'docusign', 'linkedin', 'calendly', 'stripe', 'carta', 'github', 'vercel', 'crunchbase', 'affinity', 'telegram', 'gcip'];
const UNSET = new Set(['docusign', 'linkedin', 'crunchbase', 'affinity', 'gcip']);
function summary(over = {}) {
  const base = {
    integrations: { available: true, total: 9, unhealthy: 1, providers: [
      { provider: 'calendly', by_status: { error: 1 } }, { provider: 'stripe', by_status: { connected: 4 } },
      { provider: 'slack', by_status: { connected: 2 } }, { provider: 'hubspot', by_status: { connected: 2 } }] },
    jobs: { available: true, grace_minutes: 10, failing: 0, stale: 0, never: 0, triggers: triggers() },
    monitoring: {
      dlq: { available: true, total: 0, legacy: 0, mirror: 0 },
      incidents: { available: true, window_days: 7, count: 0, basis: 'Entered for the status page.' },
    },
    broadcast: {
      telegram: { available: true, token_configured: true, members_reason: 'Not asked of Telegram.', channels: [
        { id: 1, label: 'Founders', audience: 'founder', state: 'ready', sent_count: 3, last_sent_at: ago(D), last_test_at: ago(2 * H), last_error: null },
        { id: 2, label: 'Advisors', audience: 'advisor', state: 'unbound', sent_count: 0, last_sent_at: null, last_test_at: null, last_error: null },
      ] },
      x: { available: true, client_configured: false, accounts: 0, enabled_accounts: 0 },
    },
    switches: { available: true, items: SWITCHES },
    integration_keys: {
      available: true, managed: 14, db_readable: true, db_reason: null,
      counts: { env: 8, db: 1, unset: 5, unreadable: 0 },
      items: KEYS.map((k) => ({ provider_key: k, state: UNSET.has(k) ? 'unset' : 'env', last_set_at: null, last_set_basis: UNSET.has(k) ? null : 'no_record' })),
      last_set_available: true, last_set_reason: 'Dated by the console.', notes: [],
    },
    github_sync: {
      target: { token_set: true, repo: 'acme/repo', configured: true },
      window: { available: true, window_hours: 24, synced: 3, failed: 0, lag: { value: null, reason: 'Not recorded.' } },
      recent: { available: true, items: [{ ticket_id: 9, issue_number: 41, status: 'synced', error: null, attempted_at: ago(4 * H) }] },
      recent_note: 'A ticket keeps only its latest attempt.',
    },
    payments_catalog: {
      publishable: { configured: true, masked: 'pk_live_••••', mode: 'live' },
      catalog: { available: true, stripe_mode: 'live', products: { all: 18, active: 15 }, prices: { all: 37, active: 31 },
        other_mode: { mode: 'test', products: 0 }, unknown_mode: { products: 0 }, sync_state: 'not_recorded', unreadable_price_rows: 0,
        last_written_at: ago(8 * H), sync_basis: 'Nothing schedules a sync.' },
      // Silence: the newest delivery is four days old, nothing in 24 h, and so "0 not 2xx".
      webhook: { available: true, window_hours: 24, deliveries: 0, not_2xx: 0,
        last: { status_code: 200, latency_ms: 41, at: ago(4 * D + 15 * H) },
        last_success: { status_code: 200, at: ago(4 * D + 15 * H) },
        last_failure: { status_code: 404, at: ago(15 * D) },
        consecutive_failures: 0, consecutive_failures_capped: false, hours: [], basis: 'Read from the request log.' },
      storefront_note: 'Each deployment reads its own mirror.',
    },
    promo_codes: { available: true, total: 0, counts: { active: 0, inactive: 0, expired: 0, exhausted: 0 }, items: [], truncated: false, caveats: [] },
  };
  return { ...base, ...over };
}
const TELEMETRY_DOWN = { available: false, reason: 'Analytics Engine returned no rows since 4 Nov 02:00 UTC.' };
const TELEMETRY_UP = { available: true, rows: [{ branch: 'hq', hits: 600, p95_ms: 80, error_rate_pct: 0 }], window_minutes: 60, range: null, as_of: '2026-11-07 14:20:00' };
const DEPS = { registry_available: true, deployments: [] };
const BUILD = { commit: '8f3a2c1d4e5f60718293a4b5c6d7e8f901234567', commit_basis: 'Stamped.', environment: 'production', deployed_at: null, deployed_at_reason: 'Not recorded.' };

/** The page's own reads, as one call of the model. */
const run = (data, { traffic = TELEMETRY_DOWN, deps = DEPS, now = NOW } = {}) => {
  const sigs = signals({ data, deps, traffic, now, observed: { summary: now }, UNAVAILABLE: U });
  return { sigs, health: platformHealth(sigs, { summaryDown: data === U, loading: data === null }), items: attention(sigs) };
};

/* ── the real page, mounted with the Worker stubbed ─────────────────── */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mountPage({ data = summary(), traffic = TELEMETRY_DOWN, deps = DEPS, build = BUILD } = {}) {
  const asked = [];
  const fetch = async (input) => {
    const url = String(input?.url || input);
    asked.push(url);
    await null;
    if (/\/api\/admin\/platform\/summary(\?|$)/.test(url)) return data === U ? json({ detail: 'down' }, 503) : json(data);
    if (/\/api\/admin\/deployments(\?|$)/.test(url)) return json(deps);
    if (/\/api\/monitoring\/analytics\/traffic-by-branch/.test(url)) return json(traffic);
    if (/\/api\/admin\/platform-build(\?|$)/.test(url)) return json(build);
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
    await waitUntil(() => {
      const attention = select(host, '[data-testid="hq-needs-attention"]')[0];
      return asked.some(url => url.includes('/api/admin/platform-build'))
        && attention && !String(attention.textContent || '').includes('Reading every signal');
    }, { label: 'Platform overview source reads', advance: () => act(async () => { await nextTurn(); }),
      describe: () => host.textContent });
  } catch (error) {
    try { await act(async () => root.unmount()); }
    finally { dom.timers.clear(); dom.restore(); }
    throw error;
  } finally {
    console.error = error;
    console.warn = warn;
  }
  const byTestId = (id) => select(host, `[data-testid="${id}"]`);
  const html = () => host.innerHTML ?? '';
  return {
    asked, host, byTestId, html,
    text: (n = host) => String(n.textContent || '').replace(/\s+/g, ' ').trim(),
    attr: (n, a) => n.getAttribute(a),
    async close() { await act(async () => root.unmount()); dom.timers.clear(); dom.restore(); },
  };
}

test('D5504: silence crosses the exact UTC threshold across calendar and offset transitions', () => {
  for (const stamp of ['2026-01-31T23:59:59Z', '2028-02-29T23:59:59Z', '2026-12-31T23:59:59Z', '2026-03-08T01:59:59-05:00', '2026-11-01T01:59:59-04:00']) {
    const last = new Date(stamp);
    const payments = { publishable: { configured: true }, webhook: { available: true, deliveries: 1, not_2xx: 0, window_hours: 24, consecutive_failures: 0,
      last: { at: last.toISOString(), status_code: 200 } } };
    const states = [-1, 0, 1].map(delta => webhookHealth(payments, new Date(last.getTime() + 24 * 60 * 60 * 1000 + delta)).state);
    assert.deepEqual(states, ['Healthy', 'Stale', 'Stale'], stamp);
  }
});

test('D5504: the mounted page observes the scoped business clock', async () => {
  const page = await mountPage();
  try { assert.match(page.text(page.byTestId('hq-platform-version')[0]), /Observed 14:20 UTC/); }
  finally { await page.close(); }
});

/** Document order of the first element carrying each test id. */
function order(page, ids) {
  const all = select(page.host, '[data-testid]').map((n) => n.getAttribute('data-testid'));
  return ids.map((id) => all.indexOf(id));
}

test('the page reads its four sources and leads with health, then Needs attention, then core systems', async () => {
  // Mutation checked: Needs attention moved above the health header → the order fails;
  // the overview mounted after the detail zones → hq-platform-detail-h comes first and it fails.
  const page = await mountPage();
  try {
    for (const p of ['/api/admin/platform/summary', '/api/admin/deployments', '/api/monitoring/analytics/traffic-by-branch', '/api/admin/platform-build']) {
      assert.ok(page.asked.some((u) => u.includes(p)), `the page did not read ${p}`);
    }
    const at = order(page, ['hq-platform-health', 'hq-needs-attention', 'hq-active-controls', 'hq-core-systems', 'hq-operational-activity', 'hq-console-groups', 'hq-platform-detail-h']);
    assert.ok(at.every((i) => i >= 0), `a section is missing: ${at}`);
    for (let i = 1; i < at.length; i += 1) assert.ok(at[i - 1] < at[i], `section ${i} is out of order: ${at}`);
    // The cron sentence no longer leads: no band above the health header carries it.
    const first = page.text().indexOf('Platform health');
    assert.ok(first >= 0);
    assert.ok(page.text().slice(0, first).indexOf('declared triggers') < 0, 'the cron line still leads the page');
    // Version context in the header, from the build route and the release.
    assert.match(page.text(page.byTestId('hq-platform-version')[0]), /Commit 8f3a2c1/);
    assert.match(page.text(page.byTestId('hq-platform-version')[0]), /Environment production/);
  } finally { await page.close(); }
});

test('telemetry unavailable degrades health, says why, and raises a queue item; it never reads Healthy', async () => {
  // Mutation checked: telemetry left out of the core signals → health reads Healthy for the
  // telemetry-only fixture and the second assertion fails.
  const page = await mountPage({ data: summary({ integrations: { available: true, total: 2, unhealthy: 0, providers: [{ provider: 'slack', by_status: { connected: 2 } }] } }) });
  try {
    const health = page.byTestId('hq-platform-health')[0];
    assert.notEqual(page.attr(health, 'data-health'), 'Healthy');
    assert.match(page.text(page.byTestId('hq-platform-confidence')[0]), /Confidence reduced: telemetry \(Analytics Engine returned no rows/);
    const items = page.byTestId('hq-attention-item').map((n) => page.text(n));
    assert.ok(items.some((t) => /Telemetry unavailable/.test(t)), 'telemetry unavailable is not in Needs attention');
    assert.match(page.text(page.byTestId('hq-system-infrastructure')[0]), /Telemetry\s*\?\s*Unavailable/);
  } finally { await page.close(); }
  // On its own, with everything else healthy and the webhook delivering: Degraded, not Healthy.
  const fresh = summary({ integrations: { available: true, total: 2, unhealthy: 0, providers: [] } });
  fresh.payments_catalog.webhook = { ...fresh.payments_catalog.webhook, deliveries: 4, last: { status_code: 200, latency_ms: 30, at: ago(20) } };
  fresh.broadcast.telegram.channels = fresh.broadcast.telegram.channels.slice(0, 1);
  assert.equal(run(fresh).health.state, 'Degraded');
  assert.equal(run(fresh, { traffic: TELEMETRY_UP }).health.state, 'Healthy');
  assert.equal(run(fresh, { traffic: U }).health.state, 'Degraded');
});

test('webhook silence is Stale, never Healthy, though nothing failed', async () => {
  // Mutation checked: the Stale branch of `webhookHealth` disabled → the silent fixture reads Healthy.
  const page = await mountPage();
  try {
    const status = page.byTestId('hq-webhook-health')[0];
    assert.equal(page.attr(status, 'data-status'), 'Stale');
    const items = page.byTestId('hq-attention-item').map((n) => page.text(n));
    assert.ok(items.some((t) => /Stripe webhooks silent/.test(t) && /No failures is not proof of health/.test(t)));
    assert.match(page.text(page.byTestId('hq-pay-webhook-health')[0]), /Health: Stale/);
  } finally { await page.close(); }
  const p = summary().payments_catalog;
  assert.equal(webhookHealth(p, NOW).state, 'Stale');
  const delivering = { ...p, webhook: { ...p.webhook, deliveries: 3, last: { status_code: 200, latency_ms: 30, at: ago(80) } } };
  assert.equal(webhookHealth(delivering, NOW).state, 'Healthy');
  const never = { ...p, webhook: { ...p.webhook, deliveries: 0, last: null, last_success: null, last_failure: null } };
  assert.equal(webhookHealth(never, NOW).state, 'Unknown', 'a webhook that never delivered is unproven, not healthy');
  const failing = { ...p, webhook: { ...p.webhook, deliveries: 12, not_2xx: 12, last: { status_code: 500, latency_ms: 9, at: ago(1) }, consecutive_failures: 12 } };
  assert.equal(webhookHealth(failing, NOW).state, 'Critical');
  const once = { ...failing, webhook: { ...failing.webhook, consecutive_failures: 1 } };
  assert.equal(webhookHealth(once, NOW).state, 'Degraded');
  assert.equal(webhookHealth({ webhook: { available: false, reason: 'The request log could not be read.' } }, NOW).state, 'Unknown');
});

test('an unbound channel is a warning in the queue, and configured is not verified', async () => {
  // Mutation checked: the unbound branch in `signals` removed → no item names the Advisors channel.
  const page = await mountPage();
  try {
    const items = page.byTestId('hq-attention-item');
    const unbound = items.find((n) => /Telegram Advisors channel unbound/.test(page.text(n)));
    assert.ok(unbound, 'an unbound channel raised no warning');
    assert.equal(page.attr(unbound, 'data-severity'), 'Low');
    assert.match(page.text(page.byTestId('hq-channel-verified-1')[0]), /Verification: Verified recently/);
  } finally { await page.close(); }
  assert.equal(channelState({ state: 'ready', last_test_at: null }, NOW), 'Configured');
  assert.equal(channelState({ state: 'ready', last_test_at: ago(6 * D) }, NOW), 'Verification stale');
  assert.equal(channelState({ state: 'ready', last_test_at: ago(2 * H), last_error: 'Forbidden' }, NOW), 'Error');
});

test('an unset optional key is not a problem; an unset recommended key is configuration', async () => {
  // Mutation checked: Optional keys raised as items → an item names "docusign"; the level map
  // emptied → gcip is Optional and the recommended item disappears.
  const page = await mountPage();
  try {
    const items = page.byTestId('hq-attention-item').map((n) => page.text(n));
    for (const k of ['docusign', 'linkedin', 'crunchbase', 'affinity']) {
      assert.ok(!items.some((t) => t.includes(k)), `the optional key ${k} was raised as a problem`);
    }
    const rec = items.find((t) => /1 recommended key not set/.test(t));
    assert.ok(rec && /gcip/.test(rec), 'the unset recommended key was not raised');
    assert.match(page.text(page.byTestId('hq-system-integrations')[0]), /Required keys\s*none declared/);
    assert.match(page.text(page.byTestId('hq-system-integrations')[0]), /Optional keys\s*6 \/ 10 set · the rest not configured/);
    assert.equal(page.text(page.byTestId('hq-key-level-docusign')[0]), 'Optional');
  } finally { await page.close(); }
  const lv = keyLevels(summary().integration_keys);
  assert.deepEqual([lv.Required.total, lv.Recommended.total, lv.Optional.total], [0, 4, 10]);
  // A configuration item never lowers health on its own.
  const fresh = summary({ integrations: { available: true, total: 2, unhealthy: 0, providers: [] } });
  fresh.payments_catalog.webhook = { ...fresh.payments_catalog.webhook, deliveries: 4, last: { status_code: 200, latency_ms: 30, at: ago(20) } };
  const r = run(fresh, { traffic: TELEMETRY_UP });
  assert.equal(r.health.state, 'Healthy');
  assert.ok(r.items.some((i) => i.severity === 'Low'), 'the configuration items were dropped rather than kept as Low');
});

test('the queue is most severe first, Critical leads, and every item links its console', () => {
  // Mutation checked: the sort removed → Low items precede the Critical one.
  const data = summary({ monitoring: { dlq: { available: true, total: 140, legacy: 40, mirror: 100 }, incidents: { available: true, window_days: 7, count: 0, basis: '' } } });
  data.payments_catalog.webhook = { ...data.payments_catalog.webhook, deliveries: 12, not_2xx: 12, last: { status_code: 500, latency_ms: 9, at: ago(1) }, consecutive_failures: 12 };
  const { items, health } = run(data);
  assert.equal(health.state, 'Critical');
  assert.equal(items[0].severity, 'Critical');
  const ranks = items.map((i) => SEVERITIES.indexOf(i.severity));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'the queue is not ordered by severity');
  for (const it of items) assert.match(it.link.to, /^\/(admin|monitoring)/, `${it.title} has no console`);
});

test('nothing wrong among what could be read is not an all-clear, and an unread summary is Unknown', async () => {
  // Mutation checked: the base-blind rule removed → jobs and DLQ unreadable reads Degraded.
  const blind = summary({ jobs: { available: false, reason: 'cron history unreadable' }, monitoring: { dlq: { available: false, reason: 'queue unreadable' }, incidents: { available: false } } });
  assert.equal(run(blind, { traffic: TELEMETRY_UP }).health.state, 'Unknown');
  assert.equal(run(U).health.state, 'Unknown');
  const page = await mountPage({ data: U, traffic: TELEMETRY_UP });
  try {
    assert.equal(page.attr(page.byTestId('hq-platform-health')[0], 'data-health'), 'Unknown');
    assert.match(page.text(page.byTestId('hq-platform-confidence')[0]), /Don't treat this as healthy/);
    assert.ok(page.byTestId('hq-attention-not-all-clear').length === 1, 'an empty queue over unknown signals read as an all-clear');
    assert.equal(page.byTestId('hq-attention-clear').length, 0);
  } finally { await page.close(); }
});

test('switches by business meaning, in three groups, never "off: off"', () => {
  // Mutation checked: SWITCH_WORDS.eadwyn_off.off set to "Off" → the Available assertion fails.
  const rows = switchRows({ available: true, items: SWITCHES });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.eadwyn_off.name, 'Eadwyn');
  assert.equal(by.eadwyn_off.state, 'Available');
  assert.equal(by.ai_budget_trip.state, 'Normal');
  assert.equal(by.session_charging.state, 'Disabled');
  assert.equal(by.stripe_tax.state, 'Disabled');
  assert.equal(by.cf_queue.state, 'Enabled');
  assert.equal(by.eadwyn_off.group, 'safety');
  assert.equal(by.ai_budget_trip.group, 'safety');
  assert.equal(by.cf_queue.group, 'deployment');
  for (const r of rows) {
    assert.ok(!/\boff\b/i.test(r.name), `${r.name} is still named for its off state`);
    assert.ok(r.state in STATUS, `${r.state} is not in the fixed vocabulary`);
  }
  const thrown = SWITCHES.map((s) => (s.key === 'eadwyn_off' ? { ...s, state: 'on', operator: { ...s.operator, thrown: true } } : s));
  const t = Object.fromEntries(switchRows({ available: true, items: thrown }).map((r) => [r.key, r]));
  assert.equal(t.eadwyn_off.group, 'override');
  assert.equal(t.eadwyn_off.state, 'Unavailable');
  assert.equal(switchRows({ available: false }), null);
});

test('capability coverage is read from the switch registry and the reads, and unread is not zero', () => {
  const rows = Object.fromEntries(coverage({ data: summary(), deps: DEPS, now: NOW, UNAVAILABLE: U }).map((r) => [r.key, r]));
  assert.equal(rows.market.value, '6 / 24');
  assert.equal(rows.diligence.value, '0 / 9');
  assert.equal(rows.integrations.value, '4');
  assert.equal(rows.broadcast.value, '1 / 3');
  assert.equal(rows.branches.value, '0');
  const blind = Object.fromEntries(coverage({ data: U, deps: U, now: NOW, UNAVAILABLE: U }).map((r) => [r.key, r]));
  for (const r of Object.values(blind)) assert.equal(r.value, null, `${r.name} read as a figure with nothing read`);
});

test('consoles are grouped by domain, routed, and Event syndication is Preview / Planned only', () => {
  const app = read('frontend/src/App.jsx');
  const routed = (to) => {
    const path = to.split('#')[0];
    return app.includes(`path="${path}"`) || read('frontend/src/lib/hqStrips.js').includes(`'${path}'`);
  };
  for (const [group, links] of CONSOLE_GROUPS) {
    for (const [label, to] of links) assert.ok(routed(to), `${group} › ${label} links ${to}, which nothing routes`);
    assert.ok(!links.some(([label]) => /syndication/i.test(label)), 'Event syndication sits among working consoles');
  }
  assert.deepEqual(PREVIEW_CONSOLES.map(([l]) => l), ['Event syndication']);
  assert.ok(routed(PREVIEW_CONSOLES[0][1]));
});

test('the overview is read-only, draws status as symbol and words, and keeps dark variants', () => {
  const src = read('frontend/src/pages/hq/PlatformOverview.jsx');
  assert.doesNotMatch(src, /onClick=|onSubmit=|<form|<button/, 'the overview grew a control');
  // Every status pill has its symbol (aria-hidden) and its words.
  assert.match(src, /<span aria-hidden="true">\{x\.sym\}<\/span>\s*<span>\{label \|\| s\}<\/span>/);
  for (const [s, v] of Object.entries(STATUS)) assert.ok(v.sym && v.tone, `${s} has no symbol or tone`);
  const model = read('frontend/src/pages/hq/platformOverviewModel.js');
  assert.doesNotMatch(model, /client_secret|secret_value|api_key_value/, 'the model reads key material');
});
