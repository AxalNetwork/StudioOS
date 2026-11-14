/**
 * D4860 part 5 (#4860, findings 12 and 13) — the shared HQ Platform strip.
 *
 * WHAT IT HOLDS:
 *   · the strip is grouped by domain in the overview's Detailed consoles
 *     groups and order (`CONSOLE_GROUPS`), so Platform has one map;
 *   · a console outside `/admin/platform` (Monitoring, Telegram) says so, by
 *     one rule the overview's consoles use too;
 *   · Overview carries the overall Platform health and each console its
 *     state, through the overview's own rule (`signals` folded with the
 *     Worker's detected incidents, then `platformHealth`): Healthy, Degraded,
 *     Unknown and Critical, and Unknown is never drawn as Healthy or left blank;
 *   · the strip reads once per window on the consoles, and not at all on the
 *     overview, where it shows the page's own reading.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_strip_d4860.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installAppDom, select } from './_appDom.mjs';
import { HQ_STRIPS, stripFor, stripGroupStart, outsidePlatform } from '../src/lib/hqStrips.js';
import {
  signals, platformHealth, stripStates, consoleState, CONSOLE_GROUPS,
} from '../src/pages/hq/platformOverviewModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
// The strip judges freshness on the real clock, so every fixture stamp is relative to this minute.
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000); // clock-ok: relative
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
const U = Symbol('unavailable');

/* ── fixtures (the shape platform_detected_d4860 uses) ───────────────── */

const triggers = () => Array.from({ length: 3 }, (_, i) => ({
  trigger_name: `*/${i + 5} * * * *`, name: `Job ${i + 1}`, state: 'ok', last_started_at: ago(7), status: 'ok', expected_at: ago(7), error: null,
}));

function summary(over = {}) {
  return {
    integrations: { available: true, total: 2, unhealthy: 0, providers: [{ provider: 'slack', by_status: { connected: 2 } }] },
    jobs: { available: true, grace_minutes: 10, failing: 0, stale: 0, never: 0, triggers: triggers() },
    monitoring: {
      dlq: { available: true, total: 0, legacy: 0, mirror: 0 },
      incidents: { available: true, window_days: 7, count: 0, basis: 'Entered for the status page.' },
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

const TELEMETRY_UP = { available: true, rows: [], window_minutes: 60, range: null, as_of: ago(2) };
const DEPS = { registry_available: true, deployments: [] };

/** An integration in error: Degraded, never Critical. */
const degraded = () => summary({ integrations: { available: true, total: 3, unhealthy: 1, providers: [{ provider: 'calendly', by_status: { error: 1, connected: 2 } }] } });
/** The Worker detected ten refused webhook deliveries in a row: Critical (D4854's rule). */
const critical = () => summary({
  health: {
    state: 'critical', observed_at: NOW.toISOString(), unknown: [], not_detected: [], published: null, telemetry: null, webhook: null, thresholds: {},
    detected: [{ key: 'webhook:refused', kind: 'webhook', severity: 'critical', title: 'Stripe webhook refused 10 in a row', detail: 'Ten refusals.', since: ago(30), observed_at: NOW.toISOString(),
      remediation: { surface: { label: 'Payments › Stripe connection', href: '/admin/platform/payments/stripe' }, runbook: null } }],
  },
});

const states = (data, { deps = DEPS, traffic = TELEMETRY_UP } = {}) =>
  stripStates({ data, deps, traffic, now: NOW, observed: { summary: NOW }, UNAVAILABLE: U });
/** The overview's own judgement of the same reads, as PlatformOverview draws it. */
const overview = (data, { deps = DEPS, traffic = TELEMETRY_UP } = {}) => {
  const sigs = signals({ data, deps, traffic, now: NOW, observed: { summary: NOW }, UNAVAILABLE: U });
  return { sigs, health: platformHealth(sigs, { summaryDown: data === U, loading: data === null }) };
};

/* ── the model: one rule, four states ───────────────────────────────── */

test('healthy: Overview reads Healthy and no console carries a state', () => {
  const s = states(summary());
  assert.equal(s.byRoute['/admin/platform'], 'Healthy');
  for (const route of ['/monitoring', '/admin/platform/payments', '/admin/telegram', '/admin/platform/switches']) {
    assert.equal(s.byRoute[route], null, route);
  }
});

test('degraded: an integration in error lowers Overview to Degraded', () => {
  const s = states(degraded());
  assert.equal(s.byRoute['/admin/platform'], 'Degraded');
  // Telemetry that did not answer is Unknown on Monitoring, and Overview is Degraded, not Healthy.
  const t = states(summary(), { traffic: U });
  assert.equal(t.byRoute['/monitoring'], 'Unknown');
  assert.equal(t.byRoute['/admin/platform'], 'Degraded');
});

test('unknown: an unreadable summary is Unknown on Overview and on every console it judges, never blank', () => {
  // Mutation checked: `summaryDown ? 'Unknown' : null` in consoleState → null; Telegram's state is blank.
  const s = states(U);
  assert.equal(s.byRoute['/admin/platform'], 'Unknown');
  for (const route of ['/admin/platform/payments', '/admin/telegram', '/admin/platform/switches']) {
    assert.equal(s.byRoute[route], 'Unknown', route);
  }
  // No route the strip carries ever reads Healthy as a console state: Healthy draws nothing.
  for (const data of [summary(), degraded(), critical(), U]) {
    for (const [route, v] of Object.entries(states(data).byRoute)) {
      if (route !== '/admin/platform') assert.notEqual(v, 'Healthy', route);
    }
  }
  // Still reading is Reading, which is not Healthy either.
  assert.equal(states(null).byRoute['/admin/platform'], 'Reading');
});

test('critical: the Worker\'s critical incident reads Critical on Overview and on Payments', () => {
  const s = states(critical());
  assert.equal(s.byRoute['/admin/platform'], 'Critical');
  assert.equal(s.byRoute['/admin/platform/payments'], 'Critical');
  // The AI budget trip is the page's own Critical: on Overview and on Switches, its console here.
  const trip = summary({ switches: { available: true, items: [{ key: 'ai_budget_trip', label: 'AI budget', state: 'on', writable: false }] } });
  assert.equal(states(trip).byRoute['/admin/platform'], 'Critical');
  assert.equal(states(trip).byRoute['/admin/platform/switches'], 'Critical');
});

test('one rule: the strip says what the overview says, for every state', () => {
  // Mutation checked: stripStates computing its own health (any non-Healthy signal → Degraded) → Critical case differs.
  for (const [data, opts] of [[summary(), {}], [degraded(), {}], [critical(), {}], [U, {}], [summary(), { traffic: U }], [summary(), { deps: U }]]) {
    const o = overview(data, opts);
    const s = states(data, opts);
    assert.equal(s.byRoute['/admin/platform'], o.health.state);
    for (const [, links] of CONSOLE_GROUPS) {
      for (const [, to, key] of links) if (key) assert.equal(s.byRoute[to], consoleState(o.sigs, key, { summaryDown: data === U }), to);
    }
  }
});

/* ── the map: grouped by domain, ownership said ─────────────────────── */

test('the strip is grouped by domain in the overview\'s groups and order, each group contiguous', () => {
  // Mutation checked: Telegram's group set to 'Infrastructure' → the group check below fails.
  const items = HQ_STRIPS.Platform;
  assert.deepEqual(items[0], { label: 'Overview', route: '/admin/platform' }, 'Overview leads, ungrouped');
  const consoleGroup = new Map(CONSOLE_GROUPS.flatMap(([g, links]) => links.map(([, to]) => [to.split('#')[0], g])));
  for (const i of items.slice(1)) {
    assert.ok(i.group, `${i.label} has no group`);
    if (consoleGroup.has(i.route)) assert.equal(i.group, consoleGroup.get(i.route), i.label);
  }
  const runs = items.slice(1).map((i) => i.group).filter((g, n, a) => g !== a[n - 1]);
  assert.equal(new Set(runs).size, runs.length, 'a group is split');
  const order = CONSOLE_GROUPS.map(([g]) => g);
  assert.deepEqual(runs, order.filter((g) => runs.includes(g)), 'the groups are not in the overview\'s order');
  // The literal links in the shell are in the same order (the D285 guard holds labels too).
  const app = read('frontend/src/App.jsx');
  const block = app.slice(app.indexOf('<HqSubNavStrip label="Platform">'), app.indexOf('</HqSubNavStrip>', app.indexOf('<HqSubNavStrip label="Platform">')));
  assert.deepEqual([...block.matchAll(/<StripLink to="([^"]+)">/g)].map((m) => m[1]), items.map((i) => i.route));
  // A group's name is drawn before its first item only.
  assert.equal(stripGroupStart('/admin/platform'), null);
  assert.equal(stripGroupStart('/monitoring'), 'Infrastructure');
  assert.equal(stripGroupStart('/admin/platform/topology'), null);
  assert.equal(stripGroupStart('/admin/platform/payments'), 'Payments');
  assert.equal(stripGroupStart('/admin/telegram'), 'Integrations');
  for (const i of [...HQ_STRIPS.Licences, ...HQ_STRIPS.Content]) assert.equal(stripGroupStart(i.route), null, i.route);
});

test('ownership: Monitoring and Telegram are Platform\'s, at addresses outside it, and say so; Integration keys is its own row', () => {
  // Mutation checked: outsidePlatform reduced to `route.startsWith('/admin/platform')` → '/admin/platformx' reads inside.
  const outside = HQ_STRIPS.Platform.filter((i) => outsidePlatform(i.route)).map((i) => i.label);
  assert.deepEqual(outside, ['Monitoring', 'Telegram']);
  assert.equal(outsidePlatform('/admin/platform'), false);
  assert.equal(outsidePlatform('/admin/platformx'), true);
  assert.equal(outsidePlatform('/admin/integration-keys#github'), true);
  // They still light Platform's row, and Integration keys does not (the owner's ruling of 2026-10-20).
  assert.equal(stripFor('/monitoring'), 'Platform');
  assert.equal(stripFor('/admin/telegram'), 'Platform');
  assert.equal(stripFor('/admin/integration-keys'), null);
});

/* ── mounted: the strip in the DOM, with the Worker stubbed ─────────── */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mountStrip({ path, data, label = 'Platform', calls }) {
  const fetch = async (input) => {
    const url = String(input?.url || input);
    await null;
    if (/\/api\/admin\/platform\/summary(\?|$)/.test(url)) { calls.summary += 1; return data === U ? json({ detail: 'down' }, 500) : json(data); }
    if (/\/api\/admin\/deployments(\?|$)/.test(url)) { calls.deps += 1; return json(DEPS); }
    if (/\/api\/monitoring\/analytics\/traffic-by-branch/.test(url)) { calls.traffic += 1; return json(TELEMETRY_UP); }
    if (/\/api\/auth\/me(\?|$)/.test(url)) return json({ id: 9106, role: 'admin', is_super_admin: 1 });
    return json({});
  };
  const dom = installAppDom({ fetch, url: `http://localhost${path}` });
  localStorage.setItem('user', JSON.stringify({ id: 9106, role: 'admin', is_super_admin: 1, name: 'HQ' }));
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { default: HqSubNavStrip, StripLink } = await import('../src/components/HqSubNavStrip.jsx');
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  const root = createRoot(host);
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  const links = HQ_STRIPS[label].map((i) => React.createElement(StripLink, { key: i.route, to: i.route }, i.label));
  const settle = async () => { for (let n = 0; n < 20; n += 1) await act(() => new Promise((r) => setImmediate(r))); };
  try {
    await act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(HqSubNavStrip, { label }, links)));
    });
    await settle();
  } finally {
    console.error = error;
    console.warn = warn;
  }
  const text = (n) => String(n?.textContent || '').replace(/\s+/g, ' ').trim();
  const linkTo = (to) => [...host.querySelectorAll('a')].find((a) => a.getAttribute('href') === to);
  return {
    host, text, linkTo, act, settle,
    stateOf: (to) => linkTo(to)?.querySelector('[data-testid="hq-strip-state"]')?.getAttribute('data-status') ?? null,
    groups: () => select(host, '[data-testid="hq-strip-group"]').map(text),
    async close() { await act(async () => root.unmount()); dom.timers.clear(); dom.restore(); },
  };
}

const strip = await import('../src/lib/platformStrip.js');
const fresh = () => { strip.resetPlatformStrip(); return { summary: 0, deps: 0, traffic: 0 }; };

test('mounted: groups, the HQ mark, and each state as a symbol and a word', async () => {
  // Mutation checked: the group span dropped from StripLink → no group names; ElsewhereInHq dropped → no HQ mark;
  // the link no longer `relative` → the containment check fails.
  for (const [data, overall, payments] of [[summary(), 'Healthy', null], [degraded(), 'Degraded', null], [critical(), 'Critical', 'Critical'], [U, 'Unknown', 'Unknown']]) {
    const calls = fresh();
    const m = await mountStrip({ path: '/admin/platform/storage', data, calls });
    try {
      assert.deepEqual(m.groups(), ['Infrastructure', 'Payments', 'AI', 'Integrations', 'Controls', 'Product']);
      assert.equal(m.stateOf('/admin/platform'), overall, `Overview for ${overall}`);
      assert.equal(m.stateOf('/admin/platform/payments'), payments, `Payments for ${overall}`);
      const ov = m.linkTo('/admin/platform');
      assert.match(m.text(ov), new RegExp(`Platform health: ${overall}`), 'the state is read out in words');
      if (overall === 'Unknown') {
        assert.equal(m.stateOf('/admin/telegram'), 'Unknown', 'a console the unreadable summary judges is Unknown, not blank');
        assert.ok(ov.querySelector('[data-status="Unknown"]').className.includes('border-dashed'), 'Unknown keeps its own dashed look');
        assert.ok(!ov.querySelector('[data-status="Unknown"]').className.includes('emerald'), 'Unknown is not drawn in the healthy tone');
      }
      for (const to of ['/monitoring', '/admin/telegram']) assert.ok(Boolean(m.linkTo(to).querySelector('[data-testid="hq-elsewhere"]')), `${to} has no HQ mark`);
      assert.equal(Boolean(m.linkTo('/admin/platform/storage').querySelector('[data-testid="hq-elsewhere"]')), false, 'a Platform address carries the HQ mark');
      assert.equal(m.linkTo('/admin/platform/storage').getAttribute('aria-current'), 'page');
      // The browser check found it: sr-only text is absolutely placed, and a link that is not
      // `relative` lets it escape the strip's scroller, so the page scrolled sideways at 1280 and 390.
      for (const to of ['/admin/platform', '/admin/telegram']) {
        assert.ok(m.linkTo(to).className.split(/\s+/).includes('relative'), `${to} lets its screen-reader text escape the strip`);
      }
    } finally { await m.close(); }
  }
});

test('mounted: one read per window on the consoles; none on the overview, which publishes its own', async () => {
  // Mutation checked: the overview exception removed from usePlatformStrip → the overview mount reads the summary.
  const calls = fresh();
  const a = await mountStrip({ path: '/admin/platform/storage', data: degraded(), calls });
  await a.close();
  const b = await mountStrip({ path: '/admin/platform/payments', data: degraded(), calls });
  try {
    assert.deepEqual(calls, { summary: 1, deps: 1, traffic: 1 }, 'a second console in the window read again');
    assert.equal(b.stateOf('/admin/platform'), 'Degraded');
  } finally { await b.close(); }

  const onOverview = fresh();
  const c = await mountStrip({ path: '/admin/platform', data: summary(), calls: onOverview });
  try {
    assert.deepEqual(onOverview, { summary: 0, deps: 0, traffic: 0 }, 'the strip read on the overview');
    assert.equal(c.stateOf('/admin/platform'), 'Reading', 'before the page publishes, Overview reads Reading, not Healthy');
    // PlatformPage hands over its reads; a summary that failed there is Unknown here.
    const PAGE_U = Symbol('page unavailable');
    await c.act(async () => { strip.publishPlatformReads({ data: PAGE_U, deps: DEPS, traffic: TELEMETRY_UP, UNAVAILABLE: PAGE_U, at: NOW }); });
    await c.settle();
    assert.equal(c.stateOf('/admin/platform'), 'Unknown');
    // A read still loading is not published.
    await c.act(async () => { strip.publishPlatformReads({ data: summary(), deps: null, traffic: TELEMETRY_UP, UNAVAILABLE: PAGE_U, at: NOW }); });
    assert.equal(c.stateOf('/admin/platform'), 'Unknown');
  } finally { await c.close(); }
  assert.ok(read('frontend/src/pages/hq/PlatformPage.jsx').includes('publishPlatformReads({ data, deps, traffic, UNAVAILABLE, at: observed.summary })'),
    'PlatformPage no longer hands its reads to the strip');
});

test('mounted: the Content strip draws no group, no state and makes no read', async () => {
  // Mutation checked: the Platform states handed to every strip → the Content strip carries the HQ mark.
  const calls = fresh();
  const m = await mountStrip({ path: '/admin/articles', data: summary(), label: 'Content', calls });
  try {
    assert.deepEqual(m.groups(), []);
    assert.equal(Boolean(m.host.querySelector('[data-testid="hq-strip-state"]')), false, 'the Content strip carries a state');
    assert.equal(Boolean(m.host.querySelector('[data-testid="hq-elsewhere"]')), false, 'the Content strip carries the HQ mark');
    assert.deepEqual(calls, { summary: 0, deps: 0, traffic: 0 });
  } finally { await m.close(); }
});

test('the overview\'s Detailed consoles use the same two rules: the HQ mark, and Unknown when the summary is unread', async () => {
  // Mutation checked: ConsoleGroups not told the summary is down (by the overview, or to consoleState) → Telegram's link carries no state.
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { ConsoleGroups } = await import('../src/pages/hq/PlatformOverview.jsx');
  const html = (data) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(ConsoleGroups, { sigs: overview(data).sigs, summaryDown: data === U })));
  const linkHtml = (h, to) => h.split('<a ').find((a) => a.includes(`href="${to}"`)) || '';
  const down = html(U);
  assert.match(linkHtml(down, '/admin/telegram'), /data-status="Unknown"/);
  assert.doesNotMatch(linkHtml(html(summary()), '/admin/telegram'), /data-status=/, 'a healthy console carries no state');
  for (const to of ['/monitoring', '/admin/telegram', '/admin/integration-keys', '/admin/licences']) {
    assert.match(linkHtml(down, to), /data-testid="hq-elsewhere"/, `${to} has no HQ mark`);
  }
  assert.doesNotMatch(linkHtml(down, '/admin/platform/topology'), /hq-elsewhere/);
  // And the overview tells its consoles when the summary is down.
  const { default: PlatformOverview } = await import('../src/pages/hq/PlatformOverview.jsx');
  const page = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(PlatformOverview,
    { data: U, deps: DEPS, traffic: TELEMETRY_UP, build: null, observed: {}, now: NOW, UNAVAILABLE: U })));
  const consoles = page.slice(page.indexOf('data-testid="hq-console-groups"'));
  assert.match(linkHtml(consoles, '/admin/telegram'), /data-status="Unknown"/, 'the overview drew an unread console blank');
});
