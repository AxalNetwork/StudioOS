/**
 * D5757 (#5757, finding 16 of #4860) — HQ · Platform's scope switcher.
 *
 * WHAT IS RENDERED. The real `PlatformPage` in `_appDom.mjs`'s document,
 * inside a MemoryRouter at `/admin/platform` or `/admin/platform?scope=<code>`,
 * with the Worker stubbed: the three HQ-wide reads, the build route, and
 * D5786's two scope routes, each answering a fixture shaped as the route
 * answers (`services/platformScope.ts`). The model is also run on its own.
 *
 * WHAT IT HOLDS:
 *   · HQ-wide is the default: no scoped read is made, the HQ-wide overview and
 *     its detail zones are drawn, and the switcher lists each subsidiary as a
 *     link to `?scope=<code>`;
 *   · under a subsidiary scope only that subsidiary's reading is drawn: the
 *     HQ-wide overview and detail zones are not, scheduled jobs and dead
 *     letters are named unreadable with the read's reason, and the HQ-only
 *     signals are named and not drawn;
 *   · two subsidiaries read differently, each from its own route;
 *   · a scope with no reading is Unknown, never Healthy, and a missing traffic
 *     figure is Not recorded, never 0; a true zero stays 0;
 *   · a refused scope says so from `err.code` (D258), never the message;
 *   · the switcher is links, with no handler, and its hovers keep dark variants.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_scope_d5757.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installAppDom, select } from './_appDom.mjs';
import {
  scopeFromSearch, scopeHref, scopeHealth, signalRows, scopeOptions, scopeReadFailure, scopeCoverage,
} from '../src/pages/hq/platformScopeModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000); // clock-ok: relative
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
const U = Symbol('unavailable');

/* ── fixtures, in the shape `readScope` answers ──────────────────────── */

const SRC = {
  live: 'the branch itself, over its service binding (health RPC)',
  check: 'licence_deployments (D1): the last health check Deployments stored (D452)',
  traffic: 'Analytics Engine, rows coded with the branch (blob6)',
};
const UNAVAILABLE_SIGNALS = [
  { signal: 'Scheduled jobs', reason: 'A branch fires its own scheduled triggers into its own run history. No branch read returns that history to HQ, so it is not judged here.' },
  { signal: 'Dead letters', reason: 'A branch drains its own queue into its own dead-letter tables. No branch read returns that backlog to HQ, so it is not judged here.' },
];
const HQ_ONLY = ['Telemetry probe', 'Stripe webhook', 'Integrations', 'Broadcast', 'HQ overrides', 'Integration keys', 'Payments catalogue', 'Promo codes', 'GitHub sync', 'Meeting bot starts', 'Published incidents']
  .map((signal) => ({ signal, reason: `HQ's own ${signal.toLowerCase()}.` }));
const WINDOW = { from: '2026-10-18T00:00:00Z', to: '2026-11-17T00:00:00Z', window_minutes: 43200 };

function reading(code, over = {}) {
  const base = {
    scope: { kind: 'subsidiary', code, licence_uid: `lic-${code}`, registry_status: 'live', bound: true },
    observed_at: NOW.toISOString(),
    state: 'healthy',
    detected: [],
    unknown: [],
    signals: {
      live_health: { availability: 'ready', observed_at: NOW.toISOString(), source: SRC.live, reason: null, db_ok: true, deploy_version: 'v2026.11.3', licence_status: 'active' },
      stored_check: { availability: 'ready', observed_at: ago(30), source: SRC.check, reason: null, ok: true, checked_at: ago(30) },
      traffic: { availability: 'ready', observed_at: NOW.toISOString(), source: SRC.traffic, reason: null, window: WINDOW, hits: 4210, errors_5xx: 3, error_rate_pct: 0.07, p95_ms: 180, avg_latency_ms: 60 },
    },
    unavailable: UNAVAILABLE_SIGNALS,
    hq_only: HQ_ONLY,
  };
  return { ...base, ...over, signals: { ...base.signals, ...(over.signals || {}) } };
}

const FR = reading('fr');
const DE = reading('de', {
  state: 'degraded',
  detected: [{
    key: 'branch:de', kind: 'branch', severity: 'medium', title: 'Branch de answered, but its database is failing',
    detail: 'The branch answered its health check and its database query failed.', since: NOW.toISOString(), observed_at: NOW.toISOString(),
    remediation: { surface: { label: 'Platform › Deployments', href: '/admin/platform' }, runbook: { label: 'Runbook: a branch is unhealthy or unchecked', doc: 'documentation/operations/RUNBOOK.md#76' } },
  }],
  signals: {
    live_health: { availability: 'ready', observed_at: NOW.toISOString(), source: SRC.live, reason: null, db_ok: false, deploy_version: 'v2026.11.1', licence_status: 'active' },
    traffic: { availability: 'ready', observed_at: NOW.toISOString(), source: SRC.traffic, reason: null, window: WINDOW, hits: 0, errors_5xx: 0, error_rate_pct: 0, p95_ms: null, avg_latency_ms: null },
  },
});
// Registered, unbound, never checked, traffic unread: D5786's `es` fixture.
const ES = reading('es', {
  scope: { kind: 'subsidiary', code: 'es', licence_uid: 'lic-es', registry_status: 'provisioning', bound: false },
  state: 'unknown',
  unknown: [
    { signal: 'Branch health', reason: 'The branch is provisioning in the registry, so it is not live to ask.' },
    { signal: 'Traffic', reason: 'Analytics Engine credentials are not configured.' },
  ],
  signals: {
    live_health: { availability: 'not_deployed', observed_at: null, source: SRC.live, reason: 'No service binding for this branch.', db_ok: null, deploy_version: null, licence_status: null },
    stored_check: { availability: 'unavailable', observed_at: null, source: SRC.check, reason: 'Deployments has never stored a check for this branch.', ok: null, checked_at: null },
    traffic: { availability: 'unavailable', observed_at: null, source: SRC.traffic, reason: 'Analytics Engine credentials are not configured.', window: null, hits: null, errors_5xx: null, error_rate_pct: null, p95_ms: null, avg_latency_ms: null },
  },
});
const SCOPES = {
  registry_available: true,
  scopes: [
    { kind: 'subsidiary', code: 'de', licence_uid: 'lic-de', registry_status: 'live', bound: true },
    { kind: 'subsidiary', code: 'es', licence_uid: 'lic-es', registry_status: 'provisioning', bound: false },
    { kind: 'subsidiary', code: 'fr', licence_uid: 'lic-fr', registry_status: 'live', bound: true },
  ],
};

/* ── the real page, with the Worker stubbed ──────────────────────────── */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mountPage({ at = '/admin/platform', scopes = SCOPES, readings = { fr: FR, de: DE, es: ES } } = {}) {
  const asked = [];
  const fetch = async (input) => {
    const url = String(input?.url || input);
    asked.push(url);
    await null;
    const one = url.match(/\/api\/admin\/platform\/scopes\/([^/?]+)/);
    if (one) {
      const code = decodeURIComponent(one[1]);
      if (code === 'hq') return json({ error: 'A scope is a branch code: a lowercase hostname label, never "hq".', code: 'invalid_scope' }, 400);
      return readings[code] ? json(readings[code]) : json({ error: 'No subsidiary is deployed or bound under that code.', code: 'unknown_scope' }, 404);
    }
    if (/\/api\/admin\/platform\/scopes(\?|$)/.test(url)) return scopes === U ? json({ detail: 'down' }, 503) : json(scopes);
    if (/\/api\/admin\/platform\/summary(\?|$)/.test(url)) return json({});
    if (/\/api\/admin\/deployments(\?|$)/.test(url)) return json({ registry_available: true, deployments: [] });
    if (/\/api\/monitoring\/analytics\/traffic-by-branch/.test(url)) return json({ available: false, reason: 'Not configured.' });
    if (/\/api\/auth\/me(\?|$)/.test(url)) return json({ id: 9106, role: 'admin', is_super_admin: 1 });
    return json({});
  };
  const dom = installAppDom({ fetch, url: `http://localhost${at}` });
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
      root.render(React.createElement(MemoryRouter, { initialEntries: [at] }, React.createElement(PlatformPage)));
    });
    for (let i = 0; i < 20; i += 1) await act(() => new Promise((r) => setImmediate(r)));
  } finally {
    console.error = error;
    console.warn = warn;
  }
  const byTestId = (id) => select(host, `[data-testid="${id}"]`);
  const text = (n = host) => String(n?.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    asked, host, byTestId, text,
    one: (id) => byTestId(id)[0],
    async close() { await act(async () => root.unmount()); dom.timers.clear(); dom.restore(); },
  };
}

/* ── the model ───────────────────────────────────────────────────────── */

test('the scope lives in the address: absent, empty or hq is HQ-wide', () => {
  // Mutation checked: the `hq` guard dropped → scopeFromSearch('?scope=hq') is 'hq' and the second assertion fails.
  assert.equal(scopeFromSearch(''), null);
  assert.equal(scopeFromSearch('?scope=hq'), null);
  assert.equal(scopeFromSearch('?scope='), null);
  assert.equal(scopeFromSearch('?scope=FR'), 'fr');
  assert.equal(scopeFromSearch(new URLSearchParams('scope=de')), 'de');
  assert.equal(scopeHref(null), '/admin/platform');
  assert.equal(scopeHref('fr'), '/admin/platform?scope=fr');
});

test('a scope with no reading is Unknown, never Healthy', () => {
  // Mutation checked: the "no signal answered" guard removed → the reading that claims healthy with
  // nothing ready reads Healthy and the third assertion fails; STATE_WORD defaulting to Healthy → the fourth fails.
  assert.equal(scopeHealth(null, { code: 'fr' }).state, 'Reading');
  assert.equal(scopeHealth(null, { code: 'fr', failed: 'The scoped reading did not answer.' }).state, 'Unknown');
  const blind = reading('fr', { signals: Object.fromEntries(Object.entries(ES.signals)) });
  assert.equal(blind.state, 'healthy');
  assert.equal(scopeHealth(blind, { code: 'fr' }).state, 'Unknown');
  assert.equal(scopeHealth(reading('fr', { state: 'fine' }), { code: 'fr' }).state, 'Unknown');
  const es = scopeHealth(ES, { code: 'es' });
  assert.equal(es.state, 'Unknown');
  assert.match(es.confidence, /branch health \(The branch is provisioning/);
  assert.match(es.confidence, /Don't treat this as healthy/);
  assert.equal(scopeHealth(FR, { code: 'fr' }).state, 'Healthy');
  assert.equal(scopeHealth(DE, { code: 'de' }).state, 'Degraded');
  assert.equal(scopeHealth(reading('fr', { state: 'critical' }), { code: 'fr' }).state, 'Critical');
});

test('missing traffic is Not recorded, never 0; a true zero stays 0', () => {
  // Mutation checked: `fig` returning `Number(v) || 0` → ES's requests read 0 and the first assertion fails;
  // traffic's not-ready branch dropped → ES's traffic reads Available and the status assertion fails.
  const es = Object.fromEntries(signalRows(ES).map((r) => [r.key, r]));
  assert.deepEqual(es.traffic.facts.map(([, v]) => v), [null, null, null]);
  assert.equal(es.traffic.status, 'Unknown');
  assert.equal(es.traffic.reason, 'Analytics Engine credentials are not configured.');
  assert.equal(es.live_health.status, 'Unknown');
  assert.equal(es.stored_check.status, 'Unknown');
  assert.equal(es.stored_check.reason, 'Deployments has never stored a check for this branch.');
  const de = Object.fromEntries(signalRows(DE).map((r) => [r.key, r]));
  assert.equal(de.traffic.status, 'Available');
  assert.equal(de.traffic.facts.find(([k]) => k === 'Requests')[1], 0);
  assert.equal(de.traffic.facts.find(([k]) => k === 'p95 latency')[1], null);
  assert.equal(de.live_health.status, 'Degraded');
  const fr = Object.fromEntries(signalRows(FR).map((r) => [r.key, r]));
  assert.equal(fr.live_health.status, 'Healthy');
  assert.equal(fr.traffic.facts.find(([k]) => k === 'Window')[1], '30 days');
  // A stored check older than the window is the Worker's Low note: Stale, not Healthy.
  const stale = reading('fr', { detected: [{ key: 'branch_check:fr', kind: 'branch', severity: 'low', title: 'Branch fr has not been checked in 24 hours', detail: '', since: ago(3000), observed_at: NOW.toISOString() }] });
  assert.equal(signalRows(stale).find((r) => r.key === 'stored_check').status, 'Stale');
});

test('the switcher list: unread is not empty, and a partial registry says so', () => {
  assert.equal(scopeOptions(null, U), null);
  const down = scopeOptions(U, U);
  assert.equal(down.available, false);
  assert.match(down.reason, /could not be read/);
  const partial = scopeOptions({ registry_available: false, registry_reason: 'Only bound branches are listed.', scopes: [{ code: 'fr', registry_status: null, bound: true }] }, U);
  assert.equal(partial.reason, 'Only bound branches are listed.');
  assert.deepEqual(partial.options.map((o) => [o.code, o.note]), [['fr', 'not in the registry']]);
  assert.equal(scopeOptions(SCOPES, U).options.find((o) => o.code === 'es').note, 'provisioning · not bound');
});

test('a refused scope is told by err.code, never by the message', () => {
  // Mutation checked: matching `err.message` instead → the code-less error carrying the word reads as refused.
  const coded = Object.assign(new Error('nope'), { code: 'unknown_scope' });
  assert.match(scopeReadFailure(coded, 'zz'), /No subsidiary is deployed or bound under "zz"/);
  assert.match(scopeReadFailure(Object.assign(new Error('x'), { code: 'invalid_scope' }), 'h_q'), /not a subsidiary code/);
  assert.equal(scopeReadFailure(new Error('unknown_scope'), 'zz'), 'The scoped reading did not answer.');
});

test('the rail under a scope reads back that scope only', () => {
  const lines = scopeCoverage(ES, 'es');
  assert.equal(lines[0], 'Scope: subsidiary es, health Unknown');
  assert.ok(lines.some((l) => /^Traffic: not read \(Analytics Engine credentials are not configured\)$/.test(l)));
  assert.ok(!lines.some((l) => /dead letters|declared triggers|promo/i.test(l)));
});

/* ── the mounted page ────────────────────────────────────────────────── */

test('HQ-wide is the default: no scoped read, the HQ overview and detail drawn, each subsidiary a link', async () => {
  // Mutation checked: the page reading a scope with none in the address (loadScope's `if (!scope)` guard
  // removed) → a /scopes/null request appears and the first assertion fails.
  const page = await mountPage();
  try {
    assert.ok(!page.asked.some((u) => /\/admin\/platform\/scopes\//.test(u)), 'a scoped reading was made with no scope');
    assert.ok(page.asked.some((u) => /\/admin\/platform\/scopes$/.test(u)), 'the switcher did not list the subsidiaries');
    assert.ok(page.one('hq-platform-overview'), 'the HQ-wide overview is missing');
    assert.ok(page.one('hq-platform-detail-h'), 'the HQ-wide detail zones are missing');
    assert.equal(page.byTestId('hq-platform-scoped').length, 0);
    assert.match(page.text(page.one('hq-platform-scope-current')), /Scope: HQ-wide/);
    assert.equal(page.one('hq-scope-option-hq').getAttribute('aria-current'), 'page');
    for (const code of ['de', 'es', 'fr']) {
      assert.equal(page.one(`hq-scope-option-${code}`).getAttribute('href'), `/admin/platform?scope=${code}`);
    }
    assert.match(page.text(page.one('hq-scope-option-es')), /provisioning · not bound/);
  } finally { await page.close(); }
});

test('under a subsidiary scope only its reading is drawn, and the HQ-only signals are named, not shown', async () => {
  // Mutation checked: the `!scope &&` around the HQ-wide overview removed → hq-platform-overview is drawn
  // under ?scope=fr and the third assertion fails.
  const page = await mountPage({ at: '/admin/platform?scope=fr' });
  try {
    assert.ok(page.asked.some((u) => /\/api\/admin\/platform\/scopes\/fr$/.test(u)), 'fr was not read from its own route');
    assert.equal(page.one('hq-platform-scoped').getAttribute('data-scope'), 'fr');
    assert.equal(page.byTestId('hq-platform-overview').length, 0, 'the HQ-wide overview is drawn under a subsidiary scope');
    assert.equal(page.byTestId('hq-platform-detail-h').length, 0, 'the HQ-wide detail zones are drawn under a subsidiary scope');
    assert.match(page.text(page.one('hq-platform-scope-current')), /Scope: Subsidiary fr/);
    assert.equal(page.one('hq-scope-option-fr').getAttribute('aria-current'), 'page');
    assert.equal(page.one('hq-scope-health').getAttribute('data-health'), 'Healthy');
    assert.match(page.text(page.one('hq-scope-signal-traffic')), /Requests\s*4,210/);
    assert.match(page.text(page.one('hq-scope-signal-live_health')), /Deploy version\s*v2026\.11\.3/);
    const unavailable = page.byTestId('hq-scope-unavailable-item').map((n) => page.text(n));
    assert.deepEqual(unavailable.map((t) => t.split(/\s*\?/)[0]), ['Scheduled jobs', 'Dead letters']);
    assert.ok(unavailable.every((t) => /Unreadable/.test(t) && /No branch read returns/.test(t)), 'an unavailable signal lost its reason');
    const hqOnly = page.text(page.one('hq-scope-hq-only'));
    for (const name of HQ_ONLY.map((h) => h.signal)) assert.ok(hqOnly.includes(name), `${name} is not named as HQ-only`);
    assert.equal(page.one('hq-scope-back').getAttribute('href'), '/admin/platform');
  } finally { await page.close(); }
});

test('two subsidiaries read differently, each from its own route', async () => {
  // Mutation checked: platformScopesApi.read ignoring its code (always reading fr) → de reads Healthy and fails.
  const page = await mountPage({ at: '/admin/platform?scope=de' });
  try {
    assert.ok(page.asked.some((u) => /\/scopes\/de$/.test(u)));
    assert.ok(!page.asked.some((u) => /\/scopes\/fr$/.test(u)), 'another subsidiary was read');
    assert.equal(page.one('hq-scope-health').getAttribute('data-health'), 'Degraded');
    assert.match(page.text(page.one('hq-scope-confidence')), /Branch de answered, but its database is failing/);
    assert.equal(page.one('hq-scope-signal-live_health').getAttribute('data-status'), 'Degraded');
    // A true zero from Analytics Engine stays 0.
    assert.match(page.text(page.one('hq-scope-signal-traffic')), /Requests\s*0\s*5xx errors/);
    const items = page.byTestId('hq-attention-item').map((n) => page.text(n));
    assert.ok(items.some((t) => /Branch de answered, but its database is failing/.test(t)), 'the incident is not in Needs attention');
  } finally { await page.close(); }
});

test('a subsidiary with no reading is Unknown, and its missing figures are Not recorded, never 0', async () => {
  // Mutation checked: the signal card drawing `v ?? 0` → ES's requests read 0 and the traffic assertion fails.
  const page = await mountPage({ at: '/admin/platform?scope=es' });
  try {
    assert.equal(page.one('hq-scope-health').getAttribute('data-health'), 'Unknown');
    assert.notEqual(page.one('hq-scope-health').getAttribute('data-health'), 'Healthy');
    const traffic = page.text(page.one('hq-scope-signal-traffic'));
    assert.match(traffic, /Requests\s*Not recorded/);
    assert.doesNotMatch(traffic, /Requests\s*0/);
    assert.match(traffic, /Analytics Engine credentials are not configured/);
    assert.ok(page.one('hq-attention-not-all-clear'), 'an empty queue with unknown signals read as an all-clear');
  } finally { await page.close(); }
});

test('a refused scope is Unknown with the refusal, and the list failing still offers HQ-wide', async () => {
  const page = await mountPage({ at: '/admin/platform?scope=zz', scopes: U });
  try {
    assert.equal(page.one('hq-scope-health').getAttribute('data-health'), 'Unknown');
    assert.match(page.text(page.one('hq-scope-confidence')), /No subsidiary is deployed or bound under "zz"/);
    assert.match(page.text(page.one('hq-scope-list-unread')), /could not be read\. This is not a claim that there are none/);
    assert.equal(page.one('hq-scope-option-hq').getAttribute('href'), '/admin/platform');
    assert.match(page.text(page.one('hq-scope-option-unlisted')), /zz is in the address but not in the list/);
    assert.equal(page.byTestId('hq-platform-overview').length, 0);
  } finally { await page.close(); }
});

test('the switcher is links with no handler, keeps dark hovers, and says no "advisor"', () => {
  for (const p of ['frontend/src/pages/hq/PlatformScope.jsx', 'frontend/src/pages/hq/platformScopeModel.js']) {
    const src = read(p);
    assert.doesNotMatch(src, /onClick=|onChange=|onSubmit=|<form|<button|<select/, `${p} grew a control`);
    assert.doesNotMatch(src.replace(/^\s*(\/\/|\*).*$/gm, ''), /advis|advice/i, `${p} says advisor or advice`);
  }
  const src = read('frontend/src/pages/hq/PlatformScope.jsx');
  for (const cls of src.match(/(['"`])[^'"`]*hover:bg-[^'"`]*\1/g) || []) {
    assert.match(cls, /dark:hover:bg-/, `a hover background has no dark variant: ${cls}`);
  }
  // The client calls D5786's two routes, through `request`, from its own module (never api.js).
  const client = read('frontend/src/lib/api/platformScopes.js');
  assert.match(client, /request\('\/admin\/platform\/scopes'\)/);
  assert.match(client, /request\(`\/admin\/platform\/scopes\/\$\{encodeURIComponent\(/);
  assert.doesNotMatch(read('frontend/src/lib/api.js'), /platform\/scopes/);
});
