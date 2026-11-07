// #4741 (S1 audit 2026-11-06, finding 1): #4510 built AdsTab but no code ever mounted it, so
// /grow/distribution/ads fell through to "Coming in this module soon" with growAdsApi and the
// mounted Worker route GET /api/grow/ads left with no caller. This proves the real route mounts
// AdsTab, that its own creatives Ask (reusing #4488/#4512's quote/run/accept contract) is wired,
// and guards every other Distribution tab against the same regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import { mutationCheck } from './_form_d695.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
import { DISTRIBUTION_TABS } from '../src/pages/cycles/distribution/distributionModel.js';
import { readRouteMap } from '../../scripts/lib/routeMap.mjs';
const h = React.createElement;
const source = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');

const adsData = {
  campaign: { uid: 'c1', name: 'Launch push', status: 'active', budget_cents: 10000, starts_on: '2026-09-01', ends_on: '2026-11-30' },
  targeting: null, can_write: true,
  channels: [{ uid: 'g1', name: 'Google Search', utm_source: 'google', planned_budget_cents: 6000, budget_type: 'lifetime', starts_on: null, ends_on: null, months: [],
    spend_cents: null, spend_reason: 'Not recorded: no complete campaign date window', leads: null, leads_source: 'Contacts · UTM source', leads_reason: null,
    clicks: null, seven_day_spend_cents: null, cost_per_lead_cents: null, cost_per_lead_reason: 'Not recorded: spend is monthly; seven-day spend is not recorded',
    budget_reached: false, budget_reached_reason: null }],
  period: { since: '2026-10-01T00:00:00.000Z', until: '2026-11-07T00:00:00.000Z' }, mercury_visible: false,
};
async function mountedAds(Component) {
  const before = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => {
    const path = String(url); calls.push(path);
    const result = path.includes('/auth/me') ? { id: 1, role: 'founder' }
      : path.includes('/cycles/grow/campaigns?') ? { campaigns: [{ uid: 'c1', name: 'Launch push' }] }
      : path.includes('/cycles/grow/campaigns/c1/creatives') ? { creatives: [] }
      : path.includes('/grow/ads?') ? adsData
      : path.includes('/cycles/grow/modules/distribution/form-options') ? { can_write: true }
      : {};
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let m;
  try {
    m = await mountContracts(h(AuthProvider, null, h(RailPageProvider, { role: 'founder' }, h(Component, { cycle: 'grow', slug: 'distribution', tab: 'ads' }))), '/grow/distribution/ads?project_id=7', { id: 1, role: 'founder' });
    await m.flush(); await m.flush();
    assert.match(m.text(), /Budget planner · Launch push/);
    assert.match(m.text(), /Google Search/);
    assert.doesNotMatch(m.text(), /Coming in this module soon/);
    assert.ok(calls.some((p) => p.includes('/grow/ads?') && p.includes('project=7') && p.includes('campaign=c1')));
    assert.equal(calls.some((p) => /\/cycles\/grow\/modules\/distribution(?:\?|$)/.test(p)), false);
  } finally { if (m) await m.unmount(); globalThis.fetch = before; __resetEadwynPanelForTest(); }
}
test('Ads is a real tab: AdsTab mounts inside the cycle shell and Coming in this module soon never shows; mount mutation caught', async () => {
  await mutationCheck(source('pages/cycles/CycleRoute.jsx'), 'pages/cycles/CycleRoute.jsx', (m) => mountedAds(m.default), [
    ["if (distributionTab === 'ads' && projectStatus === 'ready')", "if (false && distributionTab === 'ads' && projectStatus === 'ready')"],
  ]);
});
test("the ads branch is also in the DistributionTabs body-vs-ComingSoon switch; removing it from that list fails", async () => {
  await mutationCheck(source('pages/cycles/CycleRoute.jsx'), 'pages/cycles/CycleRoute.jsx', (m) => mountedAds(m.default), [
    ["['channels', 'inbox', 'calendar', 'prospects', 'ads'].includes(distributionTab)", "['channels', 'inbox', 'calendar', 'prospects'].includes(distributionTab)"],
  ]);
});
test('the mount supplies projectId and aiOff, never a stray onAskCreatives prop the component ignores', () => {
  const src = source('pages/cycles/CycleRoute.jsx');
  assert.match(src, /<AdsTab projectId=\{projectId\} aiOff=\{!fillsOn\} \/>/);
});

// ---- the creatives Ask reuses #4488/#4512's quote/run/accept contract (D4490's "integration still pending" line) ----
async function creativesAsk(Component) {
  if (!Component) ({ default: Component } = await import('../src/pages/cycles/distribution/AdsTab.jsx'));
  const before = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url); const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body });
    if (path.includes('/cycles/grow/campaigns?')) return new Response(JSON.stringify({ campaigns: [{ uid: 'c1', name: 'Launch push' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.includes('/cycles/grow/campaigns/c1/creatives')) return new Response(JSON.stringify({ creatives: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.includes('/grow/ads?')) return new Response(JSON.stringify(adsData), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/grow/distribution/ask/quote')) return new Response(JSON.stringify({ estimate: { hold_microusd: 5000, model: 'fixture' }, sources: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let m;
  try {
    m = await mountContracts(h(Component, { projectId: 7 }), '/grow/distribution/ads?project_id=7');
    await m.flush(); await m.flush();
    // AskButtonView's visible text is always "Ask" (AskButton.jsx); "Draft 4 creatives" is a
    // sibling <p>, not the button's own text, so the real Ask button is found by its default
    // testid and by being the LAST one — it is the one JSX render emits after all four
    // per-placement Asks (AdsTab.jsx: the placements loop, then "Draft 4 creatives" and its own).
    const asks = m.nodes().filter((n) => n.tagName === 'BUTTON' && m.props(n)?.['data-testid'] === 'ask-eadwyn');
    assert.equal(asks.length, 5, 'one Ask per empty placement (4), plus the draft-all one');
    const draftAll = asks.at(-1);
    assert.ok(!m.props(draftAll).disabled, 'the draft-all Ask is enabled once onAskCreatives is wired');
    await act(async () => { m.props(draftAll).onClick({ stopPropagation() {} }); });
    await m.flush(); await m.flush();
    assert.match(m.text(), /DISTRIBUTION · SOURCES AND PREVIEW/, 'the real #4488/#4512 Ask panel opened');
    assert.match(m.text(), /Draft for this campaign/);
    assert.ok(calls.some((c) => c.path.endsWith('/grow/distribution/ask/quote') && c.body?.campaign_uid === 'c1' && c.body?.target === 'campaign' && Array.isArray(c.body?.kinds) && c.body.kinds.length === 4 && c.body.kinds.every((k) => k.kind === 'ad_creative')));
    return calls;
  } finally { if (m) await m.unmount(); globalThis.fetch = before; }
}
test("onAskCreatives opens the real creatives Ask, scoped to the selected campaign and every placement", async () => { await creativesAsk(); });
test('removing the Ask mount, or quoting the wrong campaign/target, fails the creatives-Ask wiring', async () => {
  const src = source('pages/cycles/distribution/AdsTab.jsx').replace("import './ads.css';", '');
  await mutationCheck(src, 'pages/cycles/distribution/AdsTab.jsx', (m) => creativesAsk(m.default), [
    ['{askOpen&&!aiOff&&data?<DistributionAskIntent', '{false&&askOpen&&!aiOff&&data?<DistributionAskIntent'],
    ['campaignUid={uid} target="campaign"', 'campaignUid={uid} target="form"'],
    ['<DistributionAskIntent projectId={projectId} campaignUid={uid}', '<DistributionAskIntent projectId={projectId} campaignUid={null}'],
  ]);
});

// ---- guard: every Distribution tab is accounted for; a built tab never falls through to ComingSoon ----
test('every tab in DISTRIBUTION_TABS is either mounted or on the explicit not-built-yet allowlist; neither list may go stale', () => {
  const src = source('pages/cycles/CycleRoute.jsx');
  const arrayMatch = src.match(/\[((?:'[a-z]+', ?)*'[a-z]+')\]\.includes\(distributionTab\) && projectStatus === 'ready' \? body/);
  assert.ok(arrayMatch, 'the mounted-tab array must be found verbatim in the ComingSoon switch');
  const mounted = new Set(arrayMatch[1].split(',').map((s) => s.trim().replace(/'/g, '')));
  assert.match(src, /distributionTab === 'overview' \|\| projectStatus !== 'ready' \? body/);
  assert.match(src, /distributionTab === 'campaigns' \? <CampaignsTab/);
  // D4491 (#4778) and D4495 (#4777) mounted Results and Newsletter in their own branches of the switch.
  assert.match(src, /distributionTab === 'results' \? <ResultsTab/);
  assert.match(src, /distributionTab === 'newsletter' \? <NewsletterTab/);
  mounted.add('overview'); mounted.add('campaigns'); mounted.add('results'); mounted.add('newsletter');
  // Every tab in distributionModel.js has a built screen now. A tab added there without one goes
  // here, and keeps showing "Coming in this module soon" until a task builds it.
  const NOT_BUILT_YET = new Set();
  for (const { key } of DISTRIBUTION_TABS) {
    if (NOT_BUILT_YET.has(key)) assert.ok(!mounted.has(key), `${key} has no screen yet; it must keep showing Coming in this module soon, not be added to the mounted set without a screen`);
    else assert.ok(mounted.has(key), `${key} has a built screen but falls through to <ComingSoon /> — mount it in CycleRoute.jsx's distribution switch`);
  }
  for (const key of NOT_BUILT_YET) {
    const guess = key[0].toUpperCase() + key.slice(1);
    assert.ok(!existsSync(new URL(`../src/pages/cycles/distribution/${guess}Tab.jsx`, import.meta.url)), `${key} now has a screen (${guess}Tab.jsx) — mount it and move it off the allowlist above`);
  }
});

// ---- optional item-3 coverage: every built-screen Distribution route has a route-map row ----
test('every mounted Distribution screen route (routes/growDistribution.jsx) appears in the route map', () => {
  const map = readRouteMap();
  for (const path of ['/grow/distribution/channels', '/grow/distribution/campaigns', '/grow/distribution/campaigns/new', '/grow/distribution/campaigns/:uid', '/grow/distribution/calendar', '/grow/distribution/ads', '/grow/distribution/newsletter', '/grow/distribution/prospects', '/grow/distribution/inbox', '/grow/distribution/results']) {
    assert.ok(map.includes(path), `${path} has no route-map row`);
  }
  assert.ok(map.includes('/api/grow/distribution/ask'), 'the Distribution Ask has no route-map row');
});
