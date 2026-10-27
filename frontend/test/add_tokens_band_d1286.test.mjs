/**
 * D1286 (#3369, part 1 of #2452) — the "Your AI tokens" band complete: the
 * plan's allowance left and its reset day, each profile's line (CRP13), the
 * storage line from D1166's read, the allowance-then-tokens bar with every
 * part labelled, the auto-reload line from D794's read, the Super Admin's
 * pointer to HQ (CRP18), Add tokens disabled when nothing is on sale (CRP10),
 * and the phone and dark rules (CRP15, CRP16).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/add_tokens_band_d1286.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
import { usageApi } from '../src/lib/api/usage.js';
import { TOPUP_UNAVAILABLE } from '../src/lib/aiTokens.js';
import { TOKENS_BAND } from '../src/lib/sitePricing.js';
import { addState, autoReloadLine, planBlock, planNameFor, storageLine } from '../src/pages/tokensBandModel.js';
import { dayText, nextMonthStart } from '../src/pages/account/limitsModel.js';
import { installDocument } from './_contracts_dom.mjs';

const OCT = new Date('2026-10-20T12:00:00Z');
const ME = (over = {}) => ({
  licence: 'founder:growth', daily_capped: false, daily_microusd: 5_000_000, monthly_microusd: 5_000_000,
  day_spend_microusd: 0, month_spend_microusd: 1_870_000, day_reserved_microusd: 0, month_reserved_microusd: 30_000,
  balance_microusd: 3_400_000, topup_reserved_microusd: 0, held_for_review: [], ai_paused: false, ...over,
});
const NONE = { monthly_microusd: 0, daily_microusd: 0, month_spend_microusd: 0, month_reserved_microusd: 0 };
const ready = (body) => ({ status: 'ready', body });
const GB10 = 10 * 1024 ** 3;

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a founder on a paid plan: the plan by name, what is left of what, and the reset day', () => {
  const b = planBlock(ME(), { now: OCT });
  assert.deepEqual([b.state, b.eye, b.plan, b.lines], ['ok', TOKENS_BAND.included, 'Validate + Build', ['$3.10 of $5.00 left this month', 'Resets on 1 Nov']]);
  assert.equal(b.hq, false);
});

test('each profile says its own line, and names a plan only where the licence says which (CRP13)', () => {
  const inv = planBlock(ME({ licence: 'investor:free', ...NONE }), { now: OCT });
  assert.deepEqual([inv.eye, inv.plan, inv.lines], [TOKENS_BAND.yourPlan, 'Investor Basic', ['Investor Basic includes no AI allowance. Runs use your tokens.']]);
  const adv = planBlock(ME({ licence: 'advisor', monthly_microusd: 5_000_000, month_spend_microusd: 800_000, month_reserved_microusd: 0 }), { now: OCT });
  assert.deepEqual([adv.plan, adv.lines], ['Advisor Pro', ['$4.20 of $5.00 left this month', 'Resets on 1 Nov']]);
  const advFree = planBlock(ME({ licence: 'advisor', ...NONE }), { now: OCT });
  assert.deepEqual([advFree.plan, advFree.lines], [null, ['Your plan includes no AI allowance. Runs use your tokens.']], 'an advisor licence does not say which plan');
  const explorer = planBlock(ME({ licence: 'other', ...NONE }), { now: OCT });
  assert.deepEqual([explorer.eye, explorer.plan, explorer.lines], [TOKENS_BAND.yourPlan, 'No plan', ['No plan. Runs use your tokens.']]);
  const staff = planBlock(ME({ licence: 'admin', ...NONE }), { now: OCT });
  assert.deepEqual([staff.plan, staff.lines, staff.hq], ['Staff account', ['Staff account. Runs use your tokens.'], false]);
  assert.equal(planBlock(ME({ licence: 'admin', ...NONE }), { superAdmin: true, now: OCT }).hq, true, 'only a Super Admin is pointed at HQ');
  assert.equal(planBlock(ME({ licence: 'founder:growth' }), { superAdmin: true, now: OCT }).hq, false);
  assert.equal(planNameFor('nobody'), null);
});

test('the bar: allowance left then tokens, each part labelled; with no allowance, tokens alone', () => {
  const b = planBlock(ME(), { now: OCT }).bar;
  assert.deepEqual(b.parts.map((p) => [p.id, p.label, Math.round(p.pct)]), [['allowance', 'Plan allowance left $3.10', 48], ['tokens', 'AI tokens $3.40', 52]]);
  assert.equal(b.label, 'Plan allowance left $3.10, then AI tokens $3.40');
  const only = planBlock(ME({ licence: 'investor:free', ...NONE }), { now: OCT }).bar;
  assert.deepEqual(only.parts.map((p) => [p.id, p.label, p.pct]), [['tokens', 'AI tokens $3.40', 100]]);
  const empty = planBlock(ME({ month_spend_microusd: 5_000_000, month_reserved_microusd: 0, balance_microusd: 0 }), { now: OCT }).bar;
  assert.deepEqual(empty.parts.map((p) => [p.label, p.pct]), [['Plan allowance left $0.00', 0], ['AI tokens $0.00', 0]], 'a measured zero is still said');
});

test('a /me that is not whole says so, never a zero', () => {
  const b = planBlock({ balance_microusd: 3_400_000 }, { now: OCT });
  assert.deepEqual(b, { state: 'unreadable', line: TOKENS_BAND.planUnreadable });
});

test('the storage line: the allowance, why there is none, or that it could not be read; never 0 GB', () => {
  assert.deepEqual(storageLine(ready({ allowance_bytes: GB10, allowance_reason: null })), { state: 'ok', text: 'Your plan also includes 10 GB storage.' });
  assert.deepEqual(storageLine(ready({ allowance_bytes: null, allowance_reason: 'No plan carries a storage allowance yet' })), { state: 'none', text: 'Storage: No plan carries a storage allowance yet.' });
  assert.deepEqual(storageLine(ready({ allowance_bytes: 0 })), { state: 'none', text: 'Storage: Not recorded.' }, 'zero bytes is not an allowance');
  assert.deepEqual(storageLine({ status: 'unreadable' }), { state: 'unreadable', text: TOKENS_BAND.storageUnreadable });
  assert.equal(storageLine({ status: 'loading' }), null);
});

test('auto-reload: off with Set up, on with its threshold and Manage, paused, or unreadable', () => {
  assert.deepEqual(autoReloadLine(ready({ enabled: false, disabled_reason: null })), { state: 'off', text: 'Auto-reload: off', link: 'Set up ›' });
  assert.deepEqual(autoReloadLine(ready({ enabled: true, threshold_usd: 5 })), { state: 'on', text: 'Auto-reload: on, below $5.00', link: 'Manage ›' });
  assert.deepEqual(autoReloadLine(ready({ enabled: true, threshold_usd: null })), { state: 'on', text: 'Auto-reload: on', link: 'Manage ›' });
  assert.deepEqual(autoReloadLine(ready({ enabled: false, disabled_reason: 'card_declined' })), { state: 'paused', text: 'Auto-reload: paused', link: 'Manage ›' });
  assert.equal(autoReloadLine({ status: 'unreadable' }).state, 'unreadable');
  assert.equal(autoReloadLine(ready({ enabled: 1 })).state, 'off', 'only a true boolean is on');
});

test('Add tokens: off while /me reads, off with its line when nothing is on sale, on when packs are unread', () => {
  assert.deepEqual(addState({ meLoading: true, packCount: 3 }), { enabled: false, line: TOKENS_BAND.reading });
  assert.deepEqual(addState({ meLoading: false, packCount: 0 }), { enabled: false, line: TOPUP_UNAVAILABLE });
  assert.deepEqual(addState({ meLoading: false, packCount: null }), { enabled: true, line: null });
  assert.deepEqual(addState({ meLoading: false, packCount: 2 }), { enabled: true, line: null });
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);
const PACKS = { plans: [], packs: [{ uid: 'k25', unit_amount: 2500, credit_microusd: 25_000_000, bonus_microusd: 0 }] };

async function mount({ user = { role: 'founder' }, me = async () => ME(), storage = async () => ({ allowance_bytes: GB10 }), auto = async () => ({ enabled: false }), packs = async () => PACKS } = {}) {
  const restore = installDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => { const node = createElement(tag); node.querySelector = () => null; return node; };
  const original = { pricing: { ...publicPricingApi }, budget: { ...aiBudgetApi }, usage: { ...usageApi } };
  publicPricingApi.plansAndPacks = packs;
  publicPricingApi.aiModels = async () => ({ ok: true, models: [] });
  aiBudgetApi.mine = me;
  aiBudgetApi.autoReload = auto;
  usageApi.storage = storage;
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/pricing?for=models'] }, React.createElement(PricingBody, { user }))));
  return {
    container,
    async done() { await act(async () => root.unmount()); Object.assign(publicPricingApi, original.pricing); Object.assign(aiBudgetApi, original.budget); Object.assign(usageApi, original.usage); restore(); },
  };
}

test('CRP1: the plan block, the storage line with its link, the labelled bar and auto-reload off with Set up', async () => {
  const w = await mount();
  try {
    const plan = text(byId(w.container, 'pricing-tokens-plan'));
    const resets = `Resets on ${dayText(nextMonthStart(new Date()))}`;
    for (const s of ['Included with your plan', 'Validate + Build', '$3.10 of $5.00 left this month', resets]) assert.ok(plan.includes(s), s);
    const store = byId(w.container, 'pricing-tokens-storage');
    assert.ok(text(store).includes('Your plan also includes 10 GB storage.'));
    assert.equal(walk(store).find((n) => n.tagName === 'A')?.getAttribute?.('href') ?? props(walk(store).find((n) => n.tagName === 'A')).href, '/account/usage/storage');
    const bar = byId(w.container, 'pricing-tokens-bar');
    assert.ok(text(bar).includes('Plan allowance left $3.10') && text(bar).includes('AI tokens $3.40'), 'every part is labelled in words');
    assert.equal(props(walk(bar).find((n) => props(n).role === 'img'))['aria-label'], 'Plan allowance left $3.10, then AI tokens $3.40');
    const auto = byId(w.container, 'pricing-tokens-auto');
    assert.ok(text(auto).includes('Auto-reload: off') && text(auto).includes('Set up ›'));
    assert.equal(props(walk(auto).find((n) => n.tagName === 'A')).href, '/account/billing#auto-reload');
    assert.equal(props(byId(w.container, 'pricing-tokens-add')).href, '#token-packs');
  } finally { await w.done(); }
});

test('a storage or auto-reload read that fails says so and leaves the rest of the band', async () => {
  const w = await mount({ storage: async () => { throw new Error('down'); }, auto: async () => { throw new Error('down'); } });
  try {
    assert.ok(text(byId(w.container, 'pricing-tokens-storage')).includes(TOKENS_BAND.storageUnreadable));
    assert.ok(text(byId(w.container, 'pricing-tokens-auto')).includes(TOKENS_BAND.autoUnreadable));
    assert.ok(text(byId(w.container, 'pricing-tokens-plan')).includes('Validate + Build'));
    assert.ok(!text(w.container).includes('0 GB'), 'never a zero for a failed read');
  } finally { await w.done(); }
});

test('auto-reload on, and the Super Admin\'s pointer to HQ (CRP18)', async () => {
  const w = await mount({ user: { role: 'admin', is_super_admin: 1 }, me: async () => ME({ licence: 'admin', ...NONE }), auto: async () => ({ enabled: true, threshold_usd: 5 }) });
  try {
    assert.ok(text(byId(w.container, 'pricing-tokens-auto')).includes('Auto-reload: on, below $5.00'));
    const hq = byId(w.container, 'pricing-tokens-hq');
    assert.ok(text(hq).includes('token packs are set on') && text(hq).includes('HQ › AI allowances ›'));
    assert.equal(props(walk(hq).find((n) => n.tagName === 'A')).href, '/admin/platform/allowances');
    assert.ok(text(byId(w.container, 'pricing-tokens-plan')).includes('Staff account. Runs use your tokens.'));
    assert.ok(!byId(w.container, 'pricing-tokens-bar') || !text(byId(w.container, 'pricing-tokens-bar')).includes('Plan allowance'), 'no allowance part for staff');
  } finally { await w.done(); }
});

test('CRP10: nothing on sale, Add tokens disabled with its visible line', async () => {
  const w = await mount({ packs: async () => ({ plans: [], packs: [] }) });
  try {
    const add = byId(w.container, 'pricing-tokens-add');
    assert.equal(add.tagName, 'BUTTON');
    assert.equal(props(add).disabled, true);
    assert.equal(text(byId(w.container, 'pricing-tokens-add-off')), TOPUP_UNAVAILABLE);
  } finally { await w.done(); }
});

test('phone and dark: the band stacks, Add tokens runs full width, targets are 44px, and the colours have a dark pair', () => {
  const css = readFileSync(new URL('../src/pages/pricing.css', import.meta.url), 'utf8');
  const phone = css.slice(css.indexOf('@container (max-width: 640px)'));
  assert.match(phone, /\.axp-tokband-row, \.axp-tokband-main \{ flex-direction: column;/);
  assert.match(phone, /\.axp \.axp-tokband-add \{ width: 100%;/);
  assert.match(phone, /\.axp \.axp-tokband-link \{[^}]*min-height: 44px; min-width: 44px;/);
  assert.match(css, /\.axp \.axp-tokband-add \{[^}]*min-height: 44px;/);
  const dark = css.slice(css.indexOf('.dark .axp.axp-app {'), css.indexOf('}', css.indexOf('.dark .axp.axp-app {')));
  for (const token of ['--p-sky', '--p-note-ink', '--p-note-bg', '--p-note-line']) assert.ok(dark.includes(token), `${token} has a dark value`);
  const band = css.slice(css.indexOf('/* D1286 (#3369)'), css.indexOf('/* ── FAQ ── */'));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(band.replace(/\/\*[\s\S]*?\*\//g, '')), 'the band uses the page tokens, never a hex value');
});
