/**
 * D698 (#1660) — the Eadwyn AI rail.
 *
 * The rail draws the AIRail canvas (`design/canvases/integrated/AIRail.dc.html`):
 * "Eadwyn AI", the viewer's licence pill and the crumbs, the "Eadwyn | Manual"
 * switch, "Suggested for this page" and "All models" (since D769 PR 2, #2088,
 * the page's row of the Worker's matrix), the line "Eadwyn drafts; you send.", and the Usage box over the
 * allowance ledger. A founder on a founder page opens it on a phone as a
 * right panel; every other viewer keeps D405's sheet. The pick and the mode
 * live on the Worker (migration 465) with this browser as the cache.
 *
 * The numbers are the issue's tests. Pure rules are called directly; the rail
 * is rendered with react-dom/server, and mounted through the stub DOM
 * (`_contracts_dom.mjs`) where a click, an effect or the store must run, with
 * each read the rail makes replaced on its client object.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/airail_d698.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import WorkerRail, { MANUAL_LINE, SAFETY_LINE, RailUsage } from '../src/ui/WorkerRail.jsx';
import { ALL_MODELS, modelName, railView } from '../src/ui/railModels.js';
import { RailCrumbsProvider, RailPageProvider, useRailCrumbs, useRailOption, useSetRailCrumbs } from '../src/ui/railCrumbs.js';
import {
  __resetEadwynPanelForTest, eadwynPanelEvent, openEadwynPanel, useEadwynPanel,
} from '../src/ui/eadwynPanel.js';
import { EadwynButton } from '../src/ui/EadwynPanel.jsx';
import {
  __resetRailPrefsSyncForTest, railModelKey, readRailModel, syncRailPrefs, writeRailModel,
} from '../src/ui/railModelChoice.js';
import useAssistMode, { __resetAssistModeForTest } from '../src/hooks/useAssistMode.js';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import { ACCENT } from '../src/workspaces/shellConfig.js';
import { ASSIST_SURFACES } from '../src/ui/eadwynConfig.js';
import { api } from '../src/lib/api.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
import { railPrefsApi } from '../src/lib/api/railPrefs.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const RAIL = 'frontend/src/ui/WorkerRail.jsx';

const L70 = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const L8 = '@cf/meta/llama-3.1-8b-instruct-fp8';
const L3 = '@cf/meta/llama-3.2-3b-instruct';
const WHISPER = '@cf/openai/whisper-large-v3-turbo';
const NOVA = '@cf/deepgram/nova-3';
const GUARD = '@cf/meta/llama-guard-3-8b';
const RETIRED = '@cf/meta/llama-3.1-8b-instruct';

/**
 * Today's `/api/ai/pricing` `routes`, read from the router's own table, so
 * the suggestions are tested against what the Worker would answer.
 */
function routerPricing() {
  const src = read('cloudflare-worker/src/services/aiRouter.ts');
  const consts = new Map(
    [...src.matchAll(/const (SMALL_LLAMA|MID_LLAMA)\s*=\s*'(@cf\/[^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  const resolveId = (t) => { const x = t.trim(); return consts.has(x) ? consts.get(x) : x.replace(/^'|'$/g, ''); };
  const list = (chunk, field) => {
    const m = field.exec(chunk);
    return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean).map(resolveId) : [];
  };
  const body = src.slice(src.indexOf('export const ROUTE'));
  const table = body.slice(0, body.indexOf('\n};\n'));
  const entries = [...table.matchAll(/^ {2}([a-z_]+):\s*\{/gm)];
  const routes = {};
  for (let i = 0; i < entries.length; i += 1) {
    const chunk = table.slice(entries[i].index, i + 1 < entries.length ? entries[i + 1].index : table.length);
    const model = /model:\s*([A-Z_]+|'[^']+')/.exec(chunk);
    routes[entries[i][1]] = { model: resolveId(model[1]), fallback_chain: list(chunk, /fallbackChain:\s*\[([^\]]*)\]/), alternates: list(chunk, /alternates:\s*\[([^\]]*)\]/) };
  }
  return { ok: true, prices: {}, audio_prices: {}, routes };
}
const PRICING = routerPricing();

/**
 * D769 PR 2 (#2088): `GET /api/ai/rail` as the Worker answers it, built from
 * the Worker's own matrix (`railMatrix.json`), so the rail is tested against
 * the rows a run resolves from. Each model is priced at a stub rate.
 */
const MATRIX = JSON.parse(read('cloudflare-worker/src/services/ai/railMatrix.json'));
const STUB_PRICE = { cost: { tokens_in: 0.293, tokens_out: 2.253 }, billed: { tokens_in: 0.36625, tokens_out: 2.81625 } };
function railAnswer(page, option, { pick = null, mode = null, picks = {} } = {}) {
  const row = MATRIX.rows.find((r) => r.pageKey.toLowerCase() === String(page).toLowerCase());
  if (!row) return Object.assign(new Error('The rail has no models for that page.'), { status: 404, code: 'unknown_page' });
  const view = (r) => r.models.map((m) => ({ ...m, name: modelName(m.id), price: STUB_PRICE }));
  const opts = MATRIX.options.filter((o) => o.pageKey === row.pageKey);
  const open = option ? opts.find((o) => o.optionKey === option) : null;
  return {
    ok: true,
    page: row.pageKey,
    crumbs: [...row.pageKey.split(' · '), ...(option ? [open?.optionLabel ?? option] : [])],
    kind: (open ?? row).kind,
    models: view(open ?? row),
    options: opts.map((o) => ({ key: o.optionKey, label: o.optionLabel, kind: o.kind, handler: o.handler, models: view(o), pick: picks[o.optionKey] ?? null })),
    pick,
    mode,
    billing: 'cost',
    guard: { model: GUARD, every_run: true },
  };
}
/** The rail on a route, under the shell's page provider (D768), as App.jsx mounts it. */
const onPage = (path, child, role = 'founder') => h(MemoryRouter, { initialEntries: [path] }, h(RailPageProvider, { role }, child));
const cardIds = (m) => m.nodes().map((n) => String(m.pr(n)['data-testid'] || '')).filter((id) => id.startsWith('card-worker-rail-model-'));

const BUDGET = {
  licence: 'founder:growth', daily_microusd: 1000000, monthly_microusd: 5000000,
  day_spend_microusd: 420000, month_spend_microusd: 3100000, balance_microusd: 10000000,
  day_reserved_microusd: 20000, month_reserved_microusd: 30000, topup_reserved_microusd: 20000,
  held_for_review: [],
};
const TOPUP = { configured: true, state: 'ready', product: { price_id: 'price_TestTopUp1', currency: 'usd', unit_amount: 1000 } };
const SPEND = { recorded: true, month: { spend_usd: 3.1, calls: 12 }, by_task: [] };
/** D769: a rate card as `GET /api/ai/rates` answers on `main`, before D760. */
const RATES = {
  ok: true,
  models: [
    { id: L70, name: 'Llama 3.3 70B', in_per_1m_usd: 0.293, out_per_1m_usd: 2.253 },
    { id: L8, name: 'Llama 3.1 8B', in_per_1m_usd: 0.152, out_per_1m_usd: 0.287 },
    { id: GUARD, name: 'Llama Guard 3 8B', in_per_1m_usd: 0.484, out_per_1m_usd: 0.03 },
    { id: WHISPER, name: 'Whisper Large v3 Turbo', per_audio_minute_usd: 0.0005 },
    { id: NOVA, name: 'Nova-3', per_audio_minute_usd: 0.0052 },
  ],
};

/**
 * Replace every read the rail makes. `over` swaps one; each value is either a
 * value to answer with or an Error to reject with. Returns the PUTs seen.
 */
function stubReads(over = {}) {
  const calls = { setMode: [], setModel: [], read: 0, page: [], setPagePick: [] };
  const answer = (v) => () => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  const real = {
    myAiSpend: api.myAiSpend, aiPricing: api.aiPricing, mine: aiBudgetApi.mine, topUp: aiBudgetApi.topUp, rates: aiBudgetApi.rates,
    read: railPrefsApi.read, setMode: railPrefsApi.setMode, setModel: railPrefsApi.setModel,
    page: railPrefsApi.page, setPagePick: railPrefsApi.setPagePick,
  };
  api.myAiSpend = answer('spend' in over ? over.spend : SPEND);
  api.aiPricing = answer('pricing' in over ? over.pricing : PRICING);
  aiBudgetApi.mine = answer('budget' in over ? over.budget : BUDGET);
  aiBudgetApi.topUp = answer('topUp' in over ? over.topUp : TOPUP);
  // D769: the rail reads the rate card for its prices.
  aiBudgetApi.rates = answer('rates' in over ? over.rates : RATES);
  railPrefsApi.read = () => { calls.read += 1; return answer('prefs' in over ? over.prefs : { ok: true, modes: {}, models: {} })(); };
  railPrefsApi.setMode = (section, mode) => { calls.setMode.push([section, mode]); return Promise.resolve({ ok: true }); };
  railPrefsApi.setModel = (section, task, model) => {
    calls.setModel.push([section, task, model]);
    return over.setModel ? over.setModel(section, task, model) : Promise.resolve({ ok: true });
  };
  // D769 PR 2: the page's row. `over.rail(page, option)` answers instead of the matrix.
  railPrefsApi.page = (page, option) => {
    calls.page.push([page, option ?? null]);
    const v = over.rail ? over.rail(page, option) : railAnswer(page, option);
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  };
  railPrefsApi.setPagePick = (page, model, option) => {
    calls.setPagePick.push([page, model, option ?? null]);
    return Promise.resolve({ ok: true });
  };
  calls.restore = () => {
    Object.assign(api, { myAiSpend: real.myAiSpend, aiPricing: real.aiPricing });
    Object.assign(aiBudgetApi, { mine: real.mine, topUp: real.topUp, rates: real.rates });
    Object.assign(railPrefsApi, { read: real.read, setMode: real.setMode, setModel: real.setModel, page: real.page, setPagePick: real.setPagePick });
  };
  return calls;
}

/** A whole Storage: the stub DOM's has no `key()` or `length`, a browser's does. */
function fullStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
}

function resetStores() {
  __resetEadwynPanelForTest();
  __resetAssistModeForTest();
  __resetRailPrefsSyncForTest();
}

/** Mount through the stub DOM: `by(testid)`, `all(testid)`, `click`, `text`. */
async function mount(el, { reads, storage = {} } = {}) {
  resetStores();
  const restore = installDocument();
  fullStorage();
  for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, JSON.stringify(v));
  const stub = stubReads(reads);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(document.body);
  const all = (id) => nodes().filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, all, pr, settle, stub, nodes,
    text: (n = document.body) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async act(fn) { await act(async () => { await fn(); }); await settle(); },
    async render(next) { await act(async () => { root.render(next); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); stub.restore(); restore(); resetStores(); },
  };
}

const viewing = (shellRole, child) => h(ViewModeContext.Provider, { value: { shellRole } }, child);
const ssr = (el) => renderToStaticMarkup(el);
const deskNote = (name) => ASSIST_SURFACES.workspace.desks[name]?.fills;

// ── 16 · Removed ──────────────────────────────────────────────────────

test('16 · removed (PR 1): D402\'s inherited card and railInheritance.js are gone', () => {
  assert.equal(existsSync(resolve(process.cwd(), 'frontend/src/ui/railInheritance.js')), false,
    'railInheritance.js still exists');
  const code = codeOnly(read(RAIL));
  assert.doesNotMatch(code, /railInheritance/, 'the rail still works out an inherited view');
  assert.doesNotMatch(code, /INHERITED/, 'the rail still draws an INHERITED card');
});

test('16 · removed (PR 2): no rail draws an id, an estimate, a receipt or the old blocks', async () => {
  // D769 (D720 §1) reverses one half of this: the rail draws each model's
  // price now (`airail_d720_rail.test.mjs`), so the rate patterns (`/ M`,
  // `per audio minute`, a three-decimal dollar figure) are no longer banned.
  // An id, an estimate, a receipt and the retired blocks still are.
  const banned = /@cf\/|≈|Last run|This page this month|Model · this page|INHERITED|Drafts only/;
  // A server render, and a mounted rail with every read answered.
  assert.doesNotMatch(ssr(h(WorkerRail, { workspace: 'Validate' })), banned);
  const m = await mount(onPage('/validate/problem-discovery', h(WorkerRail, { workspace: 'Validate', note: deskNote('Validate') })));
  try {
    const all = m.text();
    assert.match(all, /Suggested for this page/);
    assert.doesNotMatch(all, banned);
  } finally { await m.unmount(); }
});

// ── 9 · Header and pill ───────────────────────────────────────────────

test('9 · the rail reads "Eadwyn AI" with the Eadwyn mark, never "Worker AI"', () => {
  const html = ssr(h(WorkerRail, { workspace: 'Build' }));
  assert.match(html, /<img src="\/eadwyn-ai\.png"[^>]*class="fwr-mark"/);
  assert.match(html, /<span class="fwr-title-text">Eadwyn AI<\/span>/);
  assert.match(html, /aria-label="Eadwyn AI · Build"/);
  assert.match(html, /Collapse the Eadwyn AI rail/);
  assert.doesNotMatch(html, /Worker AI/);
});

test('9 · the pill names the viewer\'s licence, in the app\'s colours; exploring draws none', () => {
  const pill = (shellRole) => {
    const html = ssr(viewing(shellRole, h(WorkerRail, { workspace: 'Home', role: 'founder' })));
    const m = /<span class="fwr-pill" style="([^"]*)"[^>]*data-testid="text-worker-rail-profile">([^<]*)<\/span>/.exec(html);
    return m ? { style: m[1], word: m[2] } : null;
  };
  const WORDS = { founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', super_admin: 'HQ', admin: 'Admin', branch_admin: 'Admin' };
  for (const [role, word] of Object.entries(WORDS)) assert.equal(pill(role)?.word, word, role);
  assert.equal(pill('exploring'), null, 'exploring draws a pill');
  // The app's colours, not the canvas's (AIR:77 swaps advisor and partner).
  assert.match(pill('advisor').style, new RegExp(`--fwr-pill-ink-light:${ACCENT.advisor.deep}`));
  assert.match(pill('advisor').style, new RegExp(`--fwr-pill-ink-dark:${ACCENT.advisor.deepDark}`));
  assert.match(pill('partner').style, new RegExp(`--fwr-pill-ink-light:${ACCENT.partner.deep}`));
  assert.match(pill('partner').style, new RegExp(`--fwr-pill-bg-light:${ACCENT.partner.tint}`));
});

test('9 · /account\'s rail keeps the founder accent for an investor viewer, and shows "Investor"', () => {
  // `/account` (SettingsPage) mounts the rail with role="founder" for every viewer.
  assert.match(codeOnly(read('frontend/src/pages/SettingsPage.jsx')), /<WorkerRail\s+workspace="Account"[\s\S]*?role="founder"/);
  const html = ssr(viewing('investor', h(WorkerRail, { workspace: 'Account', role: 'founder' })));
  assert.match(html, new RegExp(`<aside class="fwr"[^>]*style="--fwr-accent-light:${ACCENT.founder.deep}`));
  assert.match(html, />Investor<\/span>/);
  // Outside the view-mode provider the role prop stands in for the viewer.
  assert.match(ssr(h(WorkerRail, { workspace: 'Deals', role: 'investor' })), />Investor<\/span>/);
});

// ── 10 · Crumbs ───────────────────────────────────────────────────────

test('10 · crumbs come from the provider, a record view adds its title, and clearing drops it', async () => {
  let setCrumbs = null;
  let seen = null;
  function RecordView() { setCrumbs = useSetRailCrumbs(); seen = useRailCrumbs(); return null; }
  const m = await mount(h(RailCrumbsProvider, { section: 'Validate', module: 'Customer research' },
    h(WorkerRail, { workspace: 'Validate' }), h(RecordView)));
  try {
    const crumbs = () => m.text(m.by('text-worker-rail-crumbs'));
    assert.equal(crumbs(), 'Validate › Customer research');
    await m.act(() => setCrumbs({ record: 'Interview with Ana Torres' }));
    assert.equal(crumbs(), 'Validate › Customer research › Interview with Ana Torres');
    assert.deepEqual(seen, { section: 'Validate', module: 'Customer research', record: 'Interview with Ana Torres' });
    const last = m.nodes().filter((n) => m.pr(n).className === 'fwr-crumb').at(-1);
    assert.equal(m.pr(last)['data-last'], 'true', 'the last crumb is not the bold one');
    assert.equal(m.text(last), 'Interview with Ana Torres');
    await m.act(() => setCrumbs({ record: null }));
    assert.equal(crumbs(), 'Validate › Customer research');
  } finally { await m.unmount(); }
});

test('10 · CycleRoute provides the cycle and, on a module route, the module, around its frame', () => {
  const src = codeOnly(read('frontend/src/pages/cycles/CycleRoute.jsx'));
  assert.match(src, /const moduleName = slug \? \(def\?\.modules \|\| \[\]\)\.find\(\(m\) => m\.slug === slug\)\?\.name \|\| null : null;/);
  assert.match(src, /<RailCrumbsProvider section=\{name\} module=\{moduleName\}>\s*<RailFrame rail=\{rail\}/);
  assert.match(src, /<\/RailFrame>\s*<\/RailCrumbsProvider>/);
  // The props validate_fills_the_blanks matches stay in their order.
  assert.match(src, /<WorkerRail\s+workspace=\{name\}[\s\S]*?\n\s*fills\n\s*note=\{ASSIST_SURFACES\.workspace\.desks\[name\]\?\.fills\}/);
});

test('10 · without a provider the crumbs are the workspace alone, and the setter does nothing', () => {
  const html = ssr(h(WorkerRail, { workspace: 'Perks & Products' }));
  assert.match(html, /data-testid="text-worker-rail-crumbs"><span class="fwr-crumb" data-last="true">Perks &amp; Products<\/span><\/div>/);
  function Probe() { useSetRailCrumbs()({ record: 'x' }); return h('i', null, String(useRailCrumbs())); }
  assert.equal(ssr(h(Probe)), '<i>null</i>');
});

// ── 11 · The switch ───────────────────────────────────────────────────

// D769 (#2088; D720 §6) replaces D698's "Eadwyn | Manual" radiogroup, drawn
// only with `fills`, with "Turn off AI assistance on this page" on every page.
// PR 1 kept a page with fills off (Manual); PR 2 makes AI on by default on
// every page, and `fills` is a retired prop the rail no longer reads.

test('11 · with fills: the switch, AI on by default, the desk\'s sentence and the suggestions block', () => {
  resetStores();
  const html = ssr(h(WorkerRail, { workspace: 'Validate', fills: true, note: deskNote('Validate') }));
  assert.match(html, /role="switch" aria-checked="false"[^>]*data-testid="switch-worker-rail-ai-off"><span class="fwr-ai-switch-label">Turn off AI assistance on this page<\/span>/);
  assert.ok(!html.includes(MANUAL_LINE));
  assert.equal(MANUAL_LINE, 'Eadwyn won\u2019t suggest or draft on this page. Your work saves as usual.');
  assert.match(html, /data-ai="on" data-testid="worker-rail-suggestions"/);
  assert.match(html, /Suggested for this page/);
  assert.ok(html.includes(deskNote('Validate')));
  // `fills` decides nothing now (validate_fills_the_blanks holds the rest).
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /fills = false,|modeChoice/);
});

test('11 · turning AI off hides the suggestions and writes the mode to the Worker; on again shows them', async () => {
  const m = await mount(onPage('/validate/problem-discovery', h(WorkerRail, { workspace: 'Validate', fills: true, note: deskNote('Validate') })));
  try {
    assert.equal(m.text(m.by('text-worker-rail-mode')), deskNote('Validate'));
    await m.click('switch-worker-rail-ai-off');
    assert.equal(m.pr(m.by('worker-rail-suggestions'))['data-ai'], 'off');
    assert.equal(m.pr(m.by('switch-worker-rail-ai-off'))['aria-checked'], true);
    assert.equal(m.text(m.by('text-worker-rail-mode')), MANUAL_LINE);
    assert.deepEqual(cardIds(m), [], 'a card is drawn with AI off');
    assert.deepEqual(m.stub.setMode, [['validate', 'manual']]);
    await m.click('switch-worker-rail-ai-off');
    assert.deepEqual(m.stub.setMode.at(-1), ['validate', 'eadwyn']);
    assert.equal(m.text(m.by('text-worker-rail-mode')), deskNote('Validate'));
    assert.ok(cardIds(m).length > 0);
  } finally { await m.unmount(); }
});

test('11 · without fills: the switch is drawn, AI is on, and no "no switch" line', () => {
  resetStores();
  const build = ssr(h(WorkerRail, { workspace: 'Build' }));
  assert.match(build, /role="switch" aria-checked="false"[^>]*data-testid="switch-worker-rail-ai-off"/);
  assert.doesNotMatch(build, /No switch here|Nothing on this page fills a blank/);
  assert.match(build, /data-ai="on"/, 'a page with no fills starts with AI off');
  assert.ok(!build.includes(MANUAL_LINE));
  const research = ssr(h(WorkerRail, { workspace: 'Research' }));
  assert.ok(!research.includes(ASSIST_SURFACES.workspace.desks.Research.none), 'the "no switch" desk sentence is back');
  assert.match(research, /data-testid="switch-worker-rail-ai-off"/);
});

// ── 12 to 15 · Suggestions, options, picks, all models ────────────────
// D769 PR 2 (#2088): D698's tables (`TASK_KIND`, `SUGGESTED`, the lines that
// held, each page's jobs) are retired. The models are the page's row of the
// Worker's matrix (`GET /api/ai/rail`, D764), generated from the same canvas.

test('All models is the new canvas\'s ten groups, and its ids are the router\'s', () => {
  const data = JSON.parse(read('design/incoming/airail-every-page-data/canvas.json'));
  // The canvas's names in its order; two router models it does not name close Conversation and writing.
  const EXTRAS = ['Llama 3.2 3B', 'Llama 3.1 8B Fast'];
  assert.deepEqual(ALL_MODELS.map(([g, rows]) => [g, rows.map(([n]) => n).filter((n) => !EXTRAS.includes(n))]),
    data.all_models.map((g) => [g.group, g.models]));
  assert.deepEqual(ALL_MODELS[0][1].slice(-2).map(([n]) => n), EXTRAS);
  // Every id ROUTE can send work to is a row, the retired 8B aside, and no row names a model ROUTE does not run.
  const src = read('cloudflare-worker/src/services/aiRouter.ts');
  const consts = new Map([...src.matchAll(/const ([A-Z_]+)\s*=\s*'(@cf\/[^']+)'/g)].map((m) => [m[1], m[2]]));
  const body = src.slice(src.indexOf('export const ROUTE'));
  const table = body.slice(0, body.indexOf('\n};\n'));
  const route = new Set([...table.matchAll(/'(@cf\/[^']+)'/g)].map((m) => m[1]));
  for (const [n, v] of consts) if (new RegExp(`\\b${n}\\b`).test(table)) route.add(v);
  route.delete(RETIRED);
  const listed = ALL_MODELS.flatMap(([, rows]) => rows.map(([, id]) => id)).filter(Boolean);
  assert.deepEqual([...listed].sort(), [...route].sort());
  assert.ok(listed.every((id) => modelName(id)), 'a row has no name');
});

test('12 · Customer research draws its row: Whisper, Nova-3, Flux and the 70B, in the matrix\'s order, with role and line', async () => {
  const m = await mount(onPage('/validate/customer-research', h(WorkerRail, { workspace: 'Validate' })));
  try {
    assert.deepEqual(m.stub.page, [['Founder · Validate · Customer research', null]]);
    assert.deepEqual(cardIds(m), [WHISPER, NOVA, '@cf/deepgram/flux', L70].map((id) => `card-worker-rail-model-${id.split('/').pop()}`));
    const whisper = m.by('card-worker-rail-model-whisper-large-v3-turbo');
    assert.equal(m.text(whisper), 'Whisper Large v3 Turbo Default Turns each recording into a transcript $0.293 in · $2.253 out per 1M tokens');
    // Four models: a choice, so each card is a radio, the default checked.
    assert.equal(m.pr(whisper).role, 'radio');
    assert.equal(m.pr(whisper)['aria-checked'], true);
    assert.equal(m.pr(m.by('card-worker-rail-model-nova-3'))['aria-checked'], false);
    assert.equal(m.text(m.by('text-worker-rail-model-note')), 'Remembered for this page. Switching changes nothing already accepted.');
  } finally { await m.unmount(); }
});

test('12 · a failed read is Unreadable with a retry; no page key, or no row, says "Not recorded" and why', async () => {
  const m = await mount(onPage('/validate/problem-discovery', h(WorkerRail, { workspace: 'Validate' })), { reads: { rail: () => new Error('down') } });
  try {
    const block = m.by('worker-rail-suggestions');
    assert.match(m.text(block), /could not be read/);
    assert.match(m.text(block), /Retry/);
    assert.ok(m.by('worker-rail-model-unreadable'));
    assert.deepEqual(cardIds(m), []);
  } finally { await m.unmount(); }
  const none = await mount(onPage('/validate/problem-discovery', h(WorkerRail, { workspace: 'Validate' })),
    { reads: { rail: () => Object.assign(new Error('no row'), { status: 404 }) } });
  try {
    assert.equal(none.text(none.by('text-worker-rail-model-none')), 'Not recorded. The rail\'s model list has no row for this page yet.');
    assert.equal(none.by('worker-rail-model-unreadable'), undefined, 'a page with no row reads as a failure');
  } finally { await none.unmount(); }
  // Off the canvas (D768's `offCanvas`), and outside the shell, nothing is read.
  const off = await mount(onPage('/account', h(WorkerRail, { workspace: 'Account' })));
  try {
    assert.deepEqual(off.stub.page, []);
    assert.equal(off.text(off.by('text-worker-rail-model-none')), 'Not recorded. This page has no row in the rail\'s model list.');
  } finally { await off.unmount(); }
  assert.match(ssr(h(WorkerRail, { workspace: 'Build' })), /data-testid="text-worker-rail-model-none">Not recorded\. This page has no row in the rail&#x27;s model list\.</);
});

test('12 · "Default" is the matrix\'s role word; the checked card is the member\'s pick, else the row\'s first', () => {
  const answer = railAnswer('Founder · Validate · Problem discovery');
  const ready = (over) => railView({ reading: { loading: false, data: { ...answer, ...over } }, page: answer.page });
  const v = ready({});
  assert.deepEqual(v.cards.map((c) => [c.name, c.role, c.checked]), [
    ['Llama 3.3 70B Fast', 'Default', true], ['GLM-4.7 Flash', 'Faster', false], ['GPT-OSS 120B', 'Deeper', false],
  ]);
  assert.equal(v.cards[0].line, 'Groups notes and quotes into themes');
  assert.deepEqual(ready({ pick: '@cf/openai/gpt-oss-120b' }).cards.map((c) => c.checked), [false, false, true]);
  // A pick the row does not offer is no pick; a pick made since the read wins.
  assert.equal(ready({ pick: 'm/gone' }).current, L70);
  assert.equal(railView({ reading: { loading: false, data: answer }, page: answer.page, pick: '@cf/zai-org/glm-4.7-flash' }).current, '@cf/zai-org/glm-4.7-flash');
  // A row of one offers no choice.
  const one = ready({ models: [answer.models[0]] });
  assert.equal(one.pickable, false);
});

test('13 · choosing a card stores the page\'s pick on the Worker and checks it at once', async () => {
  const m = await mount(onPage('/validate/problem-discovery', h(WorkerRail, { workspace: 'Validate' })));
  try {
    await m.click('card-worker-rail-model-gpt-oss-120b');
    assert.deepEqual(m.stub.setPagePick, [['Founder · Validate · Problem discovery', '@cf/openai/gpt-oss-120b', null]]);
    assert.equal(m.pr(m.by('card-worker-rail-model-gpt-oss-120b'))['aria-checked'], true);
    assert.equal(m.pr(m.by('card-worker-rail-model-llama-3.3-70b-instruct-fp8-fast'))['aria-checked'], false);
    assert.equal(m.stub.page.length, 2, 'the rail did not read the Worker\'s answer after the pick');
    assert.equal(readRailModel('Validate', 'validate_tag_pains'), null, 'the rail wrote the old per-task store');
  } finally { await m.unmount(); }
});

function OpenOption({ k, label }) { useRailOption(k, label); return null; }

test('14 · "On this page" lists the page\'s options; an open option moves the rail to its row, its label the last crumb', async () => {
  const path = '/validate/customer-research';
  const m = await mount(onPage(path, h(WorkerRail, { workspace: 'Validate' })));
  try {
    const rows = m.nodes().map((n) => String(m.pr(n)['data-testid'] || '')).filter((id) => id.startsWith('row-worker-rail-option-'));
    assert.deepEqual(rows, ['transcribe:interview', 'transcribe:session', 'transcribe:recording', 'summarise:session', 'structure:transcript', 'ask:transcript']
      .map((k) => `row-worker-rail-option-${k}`));
    assert.equal(m.text(m.by('row-worker-rail-option-ask:transcript')), 'Ask Kimi K2.6');
    assert.equal(m.pr(m.by('row-worker-rail-option-ask:transcript'))['data-open'], 'false');
  } finally { await m.unmount(); }
  const o = await mount(onPage(path, h(React.Fragment, null,
    h(RailCrumbsProvider, { section: 'Validate', module: 'Customer research' }, h(WorkerRail, { workspace: 'Validate' })),
    h(OpenOption, { k: 'ask:transcript', label: 'Ask' }))));
  try {
    assert.deepEqual(o.stub.page.at(-1), ['Founder · Validate · Customer research', 'ask:transcript']);
    assert.equal(o.text(o.by('text-worker-rail-crumbs')), 'Validate › Customer research › Ask');
    assert.equal(cardIds(o)[0], 'card-worker-rail-model-kimi-k2.6');
    assert.equal(o.pr(o.by('row-worker-rail-option-ask:transcript'))['data-open'], 'true');
    assert.equal(o.text(o.by('text-worker-rail-model-note')), 'Remembered for this option. Switching changes nothing already accepted.');
    await o.click('card-worker-rail-model-gpt-oss-120b');
    assert.deepEqual(o.stub.setPagePick.at(-1), ['Founder · Validate · Customer research', '@cf/openai/gpt-oss-120b', 'ask:transcript']);
  } finally { await o.unmount(); }
});

test('15 · all models: the canvas\'s groups in order, only the non-empty ones, the guard under Safety, no retired model', async () => {
  const answer = railAnswer('Founder · Validate · Problem discovery');
  const v = railView({ reading: { loading: false, data: answer }, page: answer.page });
  const titles = v.groups.map((g) => g.title);
  assert.deepEqual(titles, ['Conversation and writing', 'Reasoning', 'Code', 'Reading images and files', 'Search and ranking', 'Speech to text', 'Images', 'Safety']);
  const chips = v.groups.flatMap((g) => g.chips);
  const guard = chips.filter((c) => c.id === GUARD);
  assert.equal(guard.length, 1, 'Llama Guard is not listed once, under Safety');
  assert.equal(guard[0].pickable, false, 'the guard can be picked');
  assert.deepEqual(v.groups.at(-1).chips.map((c) => c.id), [GUARD]);
  assert.ok(!chips.some((c) => c.id === RETIRED), 'the retired 8B is a row');
  assert.ok(chips.every((c) => c.name && !c.name.includes('@cf/')), 'a row shows an id');
  assert.deepEqual(v.groups.find((g) => g.title === 'Speech to text').chips.map((c) => c.name), ['Whisper Large v3 Turbo', 'Whisper', 'Deepgram Nova-3']);
  // A row is pickable only where the page's row offers it.
  assert.deepEqual(chips.filter((c) => c.pickable).map((c) => c.id), [L70, '@cf/openai/gpt-oss-120b', '@cf/zai-org/glm-4.7-flash'].sort((x, y) => chips.findIndex((c) => c.id === x) - chips.findIndex((c) => c.id === y)));
  assert.deepEqual(chips.filter((c) => c.selected).map((c) => c.id), [L70]);
  // The guard is never a pick, even on a row that lists it.
  const withGuard = railView({ reading: { loading: false, data: { ...answer, models: [...answer.models, { id: GUARD, role: null, line: null }] } }, page: answer.page });
  assert.equal(withGuard.groups.at(-1).chips[0].pickable, false, 'a row that lists the guard makes it pickable');
  // Mounted: a pickable row is a button and picks for the page; others are not.
  const m = await mount(onPage('/validate/problem-discovery', h(WorkerRail, { workspace: 'Validate' })));
  try {
    await m.click('button-worker-rail-all-models');
    assert.equal(m.by('chip-worker-rail-model-glm-4.7-flash').tagName, 'BUTTON');
    assert.notEqual(m.by('chip-worker-rail-model-whisper').tagName, 'BUTTON');
    await m.click('chip-worker-rail-model-glm-4.7-flash');
    assert.deepEqual(m.stub.setPagePick.at(-1), ['Founder · Validate · Problem discovery', '@cf/zai-org/glm-4.7-flash', null]);
  } finally { await m.unmount(); }
});

test('11 · a pick and a mode set on another device are in place after a load', async () => {
  const prefs = { ok: true, modes: { validate: 'manual' }, models: {} };
  const rail = (page, option) => railAnswer(page, option, { pick: '@cf/zai-org/glm-4.7-flash' });
  const m = await mount(onPage('/validate/problem-discovery', h(WorkerRail, { workspace: 'Validate', note: deskNote('Validate') })), { reads: { prefs, rail } });
  try {
    assert.equal(m.stub.read, 1, 'the rail did not read the Worker\'s preferences');
    assert.equal(m.pr(m.by('switch-worker-rail-ai-off'))['aria-checked'], true, 'the stored mode did not reach the switch');
    assert.equal(m.text(m.by('text-worker-rail-mode')), MANUAL_LINE);
    await m.click('switch-worker-rail-ai-off');
    assert.equal(m.pr(m.by('card-worker-rail-model-glm-4.7-flash'))['aria-checked'], true, 'the stored pick is not the checked card');
  } finally { await m.unmount(); }
});

test('AI off: no card or row is drawn to pick; turning AI on makes them buttons', async () => {
  // D769 (D720 §6): D698 dimmed the list in Manual; with AI off the rail now
  // draws no suggestions at all.
  const m = await mount(onPage('/validate/problem-discovery', h(WorkerRail, { workspace: 'Validate' })), { storage: { 'assist_mode:validate': false } });
  try {
    assert.equal(m.by('card-worker-rail-model-llama-3.3-70b-instruct-fp8-fast'), undefined, 'a card is drawn with AI off');
    assert.ok(!m.nodes().some((n) => String(m.pr(n)['data-testid']).startsWith('chip-')));
    assert.equal(m.by('worker-rail-options'), undefined, 'the options are drawn with AI off');
    await m.click('switch-worker-rail-ai-off');
    assert.equal(m.by('card-worker-rail-model-llama-3.3-70b-instruct-fp8-fast').tagName, 'BUTTON');
  } finally { await m.unmount(); }
});

// ── 17 · Safety ───────────────────────────────────────────────────────

test('17 · every rail ends its safety line with "Eadwyn drafts; you send.", after the guard sentence', () => {
  // D769 (D720 §8): D763 part 2 made "Llama Guard 3 8B checks every run" true,
  // so the rail draws it again; `airail_d720_rail.test.mjs` holds its price and
  // its dependence on the Worker's `guard.every_run`.
  assert.equal(SAFETY_LINE, 'Eadwyn drafts; you send.');
  for (const ws of ['Validate', 'Build', 'Research', 'Deals', 'Learning']) {
    const html = ssr(h(WorkerRail, { workspace: ws }));
    assert.match(html, /data-testid="text-worker-rail-safety">Llama Guard 3 8B checks every run[^<]*\. Eadwyn drafts; you send\.</);
    assert.doesNotMatch(html, /screens|Screened/i);
  }
  assert.doesNotMatch(codeOnly(read(RAIL)), /safetyNote|desks\?\.\[workspace\]\?\.safety/, 'a desk safety sentence is back on the rail');
});

// ── 18 · Usage ────────────────────────────────────────────────────────

const usage = (over = {}) => ssr(h(RailUsage, { reading: { budget: BUDGET, product: TOPUP, loading: false, budgetError: false, productError: false, reload: () => {}, ...over } }));

test('18 · Usage: today and this month, what runs hold, the balance, the sentence and Add tokens', () => {
  const text = renderedText(usage());
  assert.match(text, /Today\s*\$0\.42 of \$1\.00\s*Resets at 00:00 UTC/);
  assert.match(text, /This month\s*\$3\.10 of \$5\.00\s*Resets on the 1st/);
  // The month's reserve plus the top-up reserve; the day's is inside the month's.
  assert.match(text, /Held by runs in progress\s*\$0\.05/);
  assert.match(text, /Top-up balance\s*\$10\.00/);
  assert.match(text, /Runs use your plan's allowance first, then your top-up balance\./);
  assert.match(usage(), /<a href="\/plans-and-pricing#token-packs"[^>]*>Add tokens<\/a>/);
  assert.match(usage(), /<div class="fwr-meter" role="presentation"><i style="width:42%"/);
  // A cap of 0 draws no bar.
  assert.doesNotMatch(usage({ budget: { ...BUDGET, daily_microusd: 0, day_spend_microusd: 0 } }), /width:0%|width:NaN/);
  assert.equal((usage({ budget: { ...BUDGET, daily_microusd: 0, day_spend_microusd: 0 } }).match(/fwr-meter/g) || []).length, 1);
});

test('18 · Usage: the top-up\'s three states, and every failed read is Unreadable, never $0.00', () => {
  // D750: unset and not_ready are configuration, so the line names no Retry.
  // D769 (D720 §11): Add tokens is drawn in every state, disabled unless a
  // pack is on sale.
  for (const product of [{ configured: false }, { configured: true, state: 'not_ready' }]) {
    assert.match(renderedText(usage({ product })), /Top-up isn't available yet\./);
    assert.match(usage({ product }), /<button type="button" class="fwr-add-tokens" disabled=""[^>]*>Add tokens<\/button>/);
    assert.doesNotMatch(usage({ product }), /href="\/plans-and-pricing|Retry|could not be read/);
  }
  assert.match(renderedText(usage({ productError: true })), /The AI top-up could not be read/);
  for (const bad of [{ budgetError: true }, { budget: null }, { budget: { ...BUDGET, held_for_review: undefined } }]) {
    const html = usage(bad);
    assert.match(renderedText(html), /could not be read/);
    assert.match(html, /Retry<\/button>/);
    assert.doesNotMatch(html, /\$0\.00/);
  }
});

test('18 · Usage: a hold waiting on HQ draws Runs paused as an alert; none draws neither', () => {
  const paused = usage({ budget: { ...BUDGET, held_for_review: [{ uid: 'r1', at: '2026-10-15 10:00:00', held_microusd: 1000, recorded_cost_microusd: 3000 }] } });
  assert.match(paused, /role="alert" data-testid="text-worker-rail-paused"><b>Runs paused<\/b><span>A run cost more than it held\. New runs wait while HQ checks the charge\.<\/span>/);
  assert.doesNotMatch(usage(), /Runs paused|A run cost more/);
});

// ── 19 · The phone, for a founder ─────────────────────────────────────

function PanelProbe({ out }) { out.panel = useEadwynPanel(); return null; }

test('19 · the panel serves a founder on a founder page: it opens with the label and holds the rail\'s body', async () => {
  const out = {};
  const m = await mount(viewing('founder', h(React.Fragment, null,
    h(WorkerRail, { workspace: 'Validate', role: 'founder' }), h(PanelProbe, { out }))));
  try {
    assert.equal(out.panel.available, true);
    assert.ok(m.by('button-worker-rail-fab'), 'a founder with no page button keeps the floating button');
    assert.match(m.pr(m.by('button-worker-rail-fab'))['aria-label'], /^Open Eadwyn AI · Validate · (Eadwyn|Manual)$/);
    await m.act(() => openEadwynPanel('Validate · Overview'));
    const panel = m.by('eadwyn-panel');
    assert.ok(panel, 'the panel did not open');
    const dialog = m.nodes().find((n) => m.pr(n).role === 'dialog');
    assert.equal(m.pr(dialog)['aria-label'], 'Eadwyn AI');
    assert.equal(m.pr(dialog)['aria-modal'], 'true');
    assert.equal(m.text(m.by('text-eadwyn-panel-label')), 'Validate · Overview');
    assert.equal(m.pr(m.by('button-eadwyn-panel-close'))['aria-label'], 'Close Eadwyn AI');
    assert.match(m.text(panel), /Suggested for this page[\s\S]*Usage/);
    assert.equal(m.all('worker-rail-sheet').length, 0, 'a founder got the sheet');
    // The floating button opens the panel, never the sheet.
    await m.act(() => eadwynPanelEvent({ type: 'close' }));
    await m.click('button-worker-rail-fab');
    assert.ok(m.by('eadwyn-panel'));
    assert.equal(m.text(m.by('text-eadwyn-panel-label')), 'Validate');
    assert.equal(m.all('worker-rail-sheet').length, 0);
  } finally { await m.unmount(); }
});

test('19 · the fallback label: "<section> · <module>", "<section> · Overview" on a cycle root', async () => {
  const label = async (module) => {
    const m = await mount(viewing('founder', h(RailCrumbsProvider, { section: 'Validate', module },
      h(WorkerRail, { workspace: 'Validate' }))));
    try { await m.click('button-worker-rail-fab'); return m.text(m.by('text-eadwyn-panel-label')); } finally { await m.unmount(); }
  };
  assert.equal(await label('Customer research'), 'Validate · Customer research');
  assert.equal(await label(null), 'Validate · Overview');
});

test('19 · a page\'s own button hides the floating button and opens the panel with its label', async () => {
  const m = await mount(viewing('founder', h(React.Fragment, null,
    h(WorkerRail, { workspace: 'Validate' }), h(EadwynButton, { label: 'Validate · Customer research' }))));
  try {
    const button = m.by('button-eadwyn-open');
    assert.equal(m.pr(button)['aria-label'], 'Open Eadwyn for this page');
    assert.equal(m.all('button-worker-rail-fab').length, 0, 'the floating button draws beside the page\'s own');
    await m.click('button-eadwyn-open');
    assert.equal(m.text(m.by('text-eadwyn-panel-label')), 'Validate · Customer research');
  } finally { await m.unmount(); }
});

test('19 · the panel closes on the scrim, the ×, Escape, a route change and widening', async () => {
  const out = {};
  const m = await mount(viewing('founder', h(React.Fragment, null,
    h(WorkerRail, { workspace: 'Build' }), h(PanelProbe, { out }))));
  try {
    for (const type of ['scrim', 'close', 'escape', 'route', 'desktop']) {
      await m.act(() => openEadwynPanel('Build'));
      assert.equal(out.panel.open, true);
      await m.act(() => eadwynPanelEvent({ type }));
      assert.equal(out.panel.open, false, `${type} left the panel open`);
      assert.equal(m.all('eadwyn-panel').length, 0);
    }
    // The scrim and the × are wired to those events.
    await m.act(() => openEadwynPanel('Build'));
    await m.click('button-eadwyn-panel-scrim');
    assert.equal(out.panel.open, false);
    await m.act(() => openEadwynPanel('Build'));
    await m.click('button-eadwyn-panel-close');
    assert.equal(out.panel.open, false);
  } finally { await m.unmount(); }
  // The route change and widening are the rail's own effects.
  const src = codeOnly(read(RAIL));
  assert.match(src, /if \(lastPath\.current !== pathname\) eadwynPanelEvent\(\{ type: 'route' \}\);/);
  assert.match(src, /window\.matchMedia\(PHONE_QUERY\)[\s\S]{0,160}if \(mq\.matches\) return;[\s\S]{0,120}eadwynPanelEvent\(\{ type: 'desktop' \}\)/);
  assert.match(codeOnly(read('frontend/src/ui/EadwynPanel.jsx')), /useEscapeClose\(\(\) => eadwynPanelEvent\(\{ type: 'escape' \}\)\)/);
});

test('19 · who the panel serves: a founder viewer of a founder rail, and no one else', async () => {
  for (const [shellRole, served] of [['founder', true], ['admin', false], ['super_admin', false], ['investor', false]]) {
    const out = {};
    // CycleRoute mounts the rail with role="founder" for every viewer.
    const m = await mount(viewing(shellRole, h(React.Fragment, null,
      h(WorkerRail, { workspace: 'Validate', role: 'founder', fills: true }), h(PanelProbe, { out }), h(EadwynButton, { label: 'Validate' }))));
    try {
      assert.equal(out.panel.available, served, `${shellRole}: available`);
      assert.equal(m.all('button-eadwyn-open').length, served ? 1 : 0, `${shellRole}: the page button`);
      assert.equal(out.panel.triggered, served, `${shellRole}: a trigger registered`);
      await m.act(() => openEadwynPanel('Validate'));
      assert.equal(out.panel.open, served, `${shellRole}: the panel opened`);
    } finally { await m.unmount(); }
  }
  assert.match(codeOnly(read('frontend/src/pages/cycles/CycleRoute.jsx')), /<WorkerRail[\s\S]*?role="founder"/);
});

// ── 20 · The phone, for other roles ───────────────────────────────────

test('20 · an investor, and an admin on a cycle page, keep the floating button and the sheet', async () => {
  for (const [shellRole, role] of [['investor', 'investor'], ['admin', 'founder']]) {
    const out = {};
    const m = await mount(viewing(shellRole, h(React.Fragment, null,
      h(WorkerRail, { workspace: 'Deals', role }), h(PanelProbe, { out }))));
    try {
      assert.ok(m.by('button-worker-rail-fab'), `${shellRole}: no floating button`);
      await m.click('button-worker-rail-fab');
      const sheet = m.by('worker-rail-sheet');
      assert.ok(sheet, `${shellRole}: no sheet`);
      assert.match(m.text(sheet), /^Eadwyn AI/);
      assert.equal(m.all('eadwyn-panel').length, 0, `${shellRole}: the panel opened`);
      assert.equal(out.panel.available, false);
    } finally { await m.unmount(); }
  }
});

// ── 21 · The preferences client ───────────────────────────────────────

test('21 · syncRailPrefs reads once per load, seeds both caches, and the server row wins', async () => {
  resetStores();
  const restore = installDocument();
  fullStorage();
  const stub = stubReads({ prefs: { ok: true, modes: { validate: 'manual' }, models: { validate: { validate_tag_pains: L3 } } } });
  try {
    localStorage.setItem(railModelKey('Validate', 'validate_tag_pains'), JSON.stringify(L8));
    localStorage.setItem(railModelKey('Grow', 'grow_theme_feedback'), JSON.stringify(L8));
    localStorage.setItem('assist_mode:build', JSON.stringify(true));
    let mode = null;
    function ModeProbe() { [mode] = useAssistMode('Validate'); return null; }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => { root.render(h(ModeProbe)); });
    assert.equal(mode, true, 'a page with no stored choice is not on (D720 §6)');
    await act(async () => { await syncRailPrefs(); });
    await act(async () => { await syncRailPrefs(); });
    assert.equal(stub.read, 1, 'the Worker was read twice in one load');
    assert.equal(readRailModel('Validate', 'validate_tag_pains'), L3, 'the local pick beat the server row');
    assert.equal(mode, false, 'the server mode did not reach the switch');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // A local value with no server row is written up, once.
    assert.deepEqual(stub.setModel, [['grow', 'grow_theme_feedback', L8]]);
    assert.deepEqual(stub.setMode, [['build', 'eadwyn']]);
    await act(async () => root.unmount());
  } finally { stub.restore(); restore(); resetStores(); }
});

test('21 · a failed read leaves the local values standing; a write PUTs; model_not_offered clears the pick', async () => {
  resetStores();
  const restore = installDocument();
  fullStorage();
  const refused = Object.assign(new Error('not offered'), { status: 400, code: 'model_not_offered' });
  const stub = stubReads({ prefs: new Error('signed out'), setModel: () => Promise.reject(refused) });
  try {
    localStorage.setItem(railModelKey('Validate', 'validate_tag_pains'), JSON.stringify(L8));
    assert.deepEqual(await syncRailPrefs(), { ok: false });
    assert.equal(readRailModel('Validate', 'validate_tag_pains'), L8);
    assert.deepEqual(stub.setModel, [], 'a failed read wrote local values up');
    writeRailModel('Validate', 'validate_tag_pains', L3);
    // Synchronous: the cache holds the pick before the PUT answers.
    assert.equal(readRailModel('Validate', 'validate_tag_pains'), L3);
    assert.equal(typeof readRailModel('Validate', 'validate_tag_pains'), 'string');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(stub.setModel, [['validate', 'validate_tag_pains', L3]]);
    assert.equal(readRailModel('Validate', 'validate_tag_pains'), null, 'a refused pick stayed in the cache');
    // A clear sends null, which deletes the row.
    writeRailModel('Validate', 'validate_tag_pains', null);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(stub.setModel.at(-1), ['validate', 'validate_tag_pains', null]);
  } finally { stub.restore(); restore(); resetStores(); }
});

test('21 · the hook keeps what validate_fills_the_blanks reads, and FillProposals is unchanged', () => {
  const hook = codeOnly(read('frontend/src/hooks/useAssistMode.js'));
  assert.match(hook, /railPrefsApi\.setMode\(sectionOf\(workspace\), next === true \? 'eadwyn' : 'manual'\)/);
  assert.match(hook, /export function seedAssistModes\(map\)/);
  const band = codeOnly(read('frontend/src/workspaces/FillProposals.jsx'));
  assert.match(band, /const model = task \? readRailModel\(workspace, task\) : null;/);
  assert.match(band, /writeRailModel\(workspace, kinds\[kind\]\.task, null\)/);
});

// ── 22 · Dark mode and docs ───────────────────────────────────────────

test('22 · every rule D698 adds with a colour has a .dark pair', () => {
  const css = read('frontend/src/ui/workerRail.css');
  const from = css.indexOf('D698 — THE AIRAIL CANVAS\'S BLOCKS');
  const to = css.indexOf('/* end D698 */');
  assert.ok(from > 0 && to > from, 'the D698 block is not marked');
  const block = css.slice(from, to);
  const darkAt = block.indexOf('/* The dark pairs for everything above. */');
  const light = block.slice(0, darkAt);
  const dark = block.slice(darkAt);
  const COLOUR = /(?:^|;|\{)\s*(?:color|background|background-color|border(?:-[a-z]+)?(?:-color)?|box-shadow|outline)\s*:[^;}]*(?:#|rgba?\(|var\(--d698|var\(--fwr-accent)/;
  let checked = 0;
  for (const m of light.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!COLOUR.test(`{${m[2]}`) || sels.startsWith('.fwr {') || sels === '.fwr') continue;
    for (const sel of sels.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (/:focus-visible|^button\.|\[data-dimmed|^\.fwr-dot > span$|fwr-title \.fwr-mark|\.fwr-meter/.test(sel)) continue;
      checked += 1;
      const pair = new RegExp(`\\.dark ${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[{,]`);
      assert.match(dark, pair, `${sel} has no .dark pair`);
    }
  }
  assert.ok(checked >= 25, `only ${checked} rules were checked — the parse is not matching`);
  assert.match(dark, /\.dark \.fwr \{\s*--d698-ink:/, 'the greys have no dark values');
});

test('22 · the panel is the canvas\'s: 300px, at most 88%, the scrim, above the tab bar and below the lightbox', () => {
  const css = read('frontend/src/ui/workerRail.css');
  assert.match(css, /\.ead-panel-layer \{ position: fixed; inset: 0; z-index: 60; \}/);
  assert.match(css, /\.ead-panel-scrim \{[^}]*background: rgba\(24, 24, 27, \.42\);/);
  assert.match(css, /\.ead-panel \{[^}]*width: 300px; max-width: 88%;/);
  assert.match(css, /\.ead-open \{[^}]*width: 40px; height: 40px;[^}]*border-radius: 12px;/);
  // One breakpoint, from one JS source (D-l).
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /RAIL_DESKTOP_QUERY|min-width: 1024px/);
  assert.match(src, /import \{ PHONE_QUERY \} from '\.\.\/workspaces\/lens\.jsx';/);
});

test('22 · the client names the three Worker routes, each path written out, with one api.js line', () => {
  // Each path is written out so the drift check (`check-api-drift.mjs`) reads
  // it and matches a mounted route in `routes/ai.ts`.
  const src = codeOnly(read('frontend/src/lib/api/railPrefs.js'));
  assert.match(src, /read: \(\) => request\('\/ai\/rail-preferences'\)/);
  assert.match(src, /setMode: \(section, mode\) =>\s+request\(`\/ai\/rail-preferences\/\$\{encodeURIComponent\(section\)\}`, \{\s+method: 'PUT'/);
  assert.match(src, /setModel: \(section, task, model\) =>\s+request\(`\/ai\/rail-preferences\/\$\{encodeURIComponent\(section\)\}\/\$\{encodeURIComponent\(task\)\}`, \{\s+method: 'PUT'/);
  const apiSrc = read('frontend/src/lib/api.js');
  assert.equal(apiSrc.split("export * from './api/railPrefs.js';").length - 1, 1, 'api.js has exactly one railPrefs.js line');
});

test('22 · check-regulated-wording passes, the panel is a listed surface, and the pill is not read as copy', async () => {
  const script = read('scripts/check-regulated-wording.mjs');
  assert.match(script, /'frontend\/src\/ui\/EadwynPanel\.jsx'/);
  // "Advisor" on the pill names a human licence. The scanner reads a literal
  // with no space as an identifier, so the one-word pill is not flagged and
  // needs no baseline entry (an entry for copy the scanner does not find
  // fails the check as stale); D698.md records the verdict instead.
  const { visibleText } = await import('../../scripts/check-regulated-wording.mjs');
  assert.ok(!visibleText(read(RAIL)).some((s) => /\badvis/i.test(s)), 'the rail\'s scanned copy names an advisor');
  assert.match(read(RAIL), /advisor: 'Advisor',/);
  const run = spawnSync(process.execPath, ['scripts/check-regulated-wording.mjs'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('the canvas moved to integrated/, unedited, and the old path is gone', () => {
  assert.equal(existsSync(resolve(process.cwd(), 'design/incoming/AIRail.dc.html')), false);
  assert.ok(existsSync(resolve(process.cwd(), 'design/canvases/integrated/AIRail.dc.html')));
  // D769 PR 2: the "AIRail · every page" export replaced D698's in place, under the name Cycle Overview imports.
  assert.equal(existsSync(resolve(process.cwd(), 'design/incoming/AIRail · every page.dc.html')), false);
  const canvas = read('design/canvases/integrated/AIRail.dc.html');
  for (const said of ['Turn off AI assistance on this page', 'Add tokens', 'Llama Guard 3 8B checks every run']) assert.ok(canvas.includes(said), `the integrated canvas is not the every-page export: no "${said}"`);
  assert.match(read('design/canvases/integrated/Cycle Overview.dc.html'), /dc-import name="AIRail"/);
  assert.ok(existsSync(resolve(process.cwd(), 'design/canvases/backlog/AIRail.dc.html')), 'the backlog copy the Founder Workspaces Canvas imports went too');
});

test('the new modules are exported through ui/index.js', () => {
  const index = read('frontend/src/ui/index.js');
  for (const line of [
    /export \{ EadwynPanel, EadwynButton \} from '\.\/EadwynPanel(\.jsx)?';/,
    /export \{ openEadwynPanel, closeEadwynPanel, useEadwynPanel, useEadwynTrigger \} from '\.\/eadwynPanel(\.js)?';/,
    /export \{ RailCrumbsProvider, useRailCrumbs, useSetRailCrumbs \} from '\.\/railCrumbs(\.js)?';/,
  ]) assert.match(index, line);
});
