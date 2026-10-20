/**
 * D807 (#2246) — `/account/usage/limits`: the words and figures
 * (`limitsModel.js`), the spend-limit card's Save, Remove and notices against a
 * stubbed API, the three read-only cards' states, the account navigation, the
 * address rules and the phone layout. Each case names the mutations it was
 * checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/limits_page_d807.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AccountSectionNav } from '../src/pages/account/AccountCenter.jsx';
import { AutoReloadSummary, LimitsView, PackOrdersCard, PlanAllowanceCard, SpendLimitCard } from '../src/pages/account/LimitsPage.jsx';
import {
  LIMITS_PAGE, NO_LIMIT, NO_PLAN_ALLOWANCE, PACK_ORDERS_NOT_READ, USAGE_PAGES,
  allowanceCard, autoReloadCard, dayText, limitView, nextMonthStart, packOrdersCard, parseLimitUsd, stopsLine, usagePageFor,
} from '../src/pages/account/limitsModel.js';
import { accountPathFor, accountViewFor } from '../src/pages/account/accountPhone.js';

const h = React.createElement;
const M = 1_000_000;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/usage/limits'] }, el));
const ready = (data) => ({ status: 'ready', data, reload() {}, set() {} });
const LOADING = { status: 'loading', data: null, reload() {}, set() {} };
const UNREADABLE = { status: 'unreadable', data: null, message: 'boom', reload() {}, set() {} };
const NOTIFY = { 50: true, 80: true, 100: true };
const LIMIT = { month: '2026-10', resets_on: '2026-11-01', charged_microusd: 135.22 * M, limit_microusd: 500 * M, share_used: 27, notify: NOTIFY };
const NONE = { ...LIMIT, limit_microusd: null, share_used: null };
const BUDGET = { licence: 'founder', daily_microusd: 0, monthly_microusd: 200 * M, day_spend_microusd: 0, month_spend_microusd: 135.61 * M,
  balance_microusd: 0, day_reserved_microusd: 0, month_reserved_microusd: 0, topup_reserved_microusd: 0, held_for_review: [], daily_capped: false };
const TOPUP = { packs: [{ uid: 'pack25', label: '$25 of tokens' }] };
const RELOAD = { enabled: false, pack_uid: 'pack25', threshold_usd: 5, card: null };

// 1 ───────────────────────────────────────────────────────────────────────────
test('the words and figures: the limit, the field rule, the allowance, auto-reload and today\'s pack orders', () => {
  // Mutations checked: the $100,000 cap removed; three decimals accepted; the share not capped at 100; a NULL limit read as $0; the allowance's no-plan state dropped; the pack's face value taken from the threshold.
  assert.deepEqual(LIMITS_PAGE, { title: 'Limits', sub: 'What stops spend, and when it resets.' });
  assert.equal(parseLimitUsd('500'), 500);
  assert.equal(parseLimitUsd('$1,250.5'), 1250.5);
  assert.equal(parseLimitUsd('100000'), 100000);
  for (const bad of ['100000.01', '-1', '1.234', 'abc', '']) assert.equal(parseLimitUsd(bad), null, bad);

  const v = limitView(LIMIT);
  assert.deepEqual([v.set, v.limit, v.spent, v.pct, v.resets, v.limitUsd], [true, '$500.00', '$135.22', 27, '1 Nov', 500]);
  assert.equal(stopsLine(v), 'Runs, and auto-reloads, that would pass it are stopped until 1 Nov.');
  assert.equal(limitView({ ...LIMIT, charged_microusd: 900 * M }).pct, 100, 'the bar stops at full');
  assert.deepEqual([limitView(NONE).set, limitView(NONE).limit], [false, null], 'no limit is not a $0 limit');
  assert.equal(limitView({ ...LIMIT, limit_microusd: 0 }).pct, 100, 'a $0 limit is reached');
  assert.equal(limitView({ ...LIMIT, notify: { 50: true, 80: false, 100: true } }).notify[80], false);
  assert.equal(limitView({ nope: 1 }), null);

  assert.equal(dayText('2026-11-01'), '1 Nov');
  assert.equal(dayText('2026-13-01'), null);
  assert.equal(nextMonthStart(new Date('2026-12-31T23:59:59Z')), '2027-01-01');
  assert.deepEqual(allowanceCard(BUDGET, new Date('2026-10-20T00:00:00Z')), { none: false, perMonth: '$200.00', used: '$135.61', pct: 68, resets: '1 Nov' });
  assert.deepEqual(allowanceCard({ ...BUDGET, monthly_microusd: 0 }), { none: true });
  assert.equal(allowanceCard({ licence: 'founder' }), null);

  assert.deepEqual(autoReloadCard(RELOAD, TOPUP), { on: false, line: 'When on, buys the $25 pack below $5.' });
  assert.deepEqual(autoReloadCard({ ...RELOAD, enabled: true, threshold_usd: 12.5 }, TOPUP), { on: true, line: 'When on, buys the $25 pack below $12.50.' });
  assert.equal(autoReloadCard({ ...RELOAD, pack_uid: null, threshold_usd: null }, TOPUP).line, 'No pack chosen yet. Choose one on Billing.');
  assert.equal(autoReloadCard({}, TOPUP), null);

  assert.deepEqual(packOrdersCard({ ...LIMIT, pack_orders: { today: 1, per_day: 5, resets_at: 'x' } }), { today: 1, perDay: 5, pct: 20 });
  assert.equal(packOrdersCard(LIMIT), null, 'until D805 adds pack_orders');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the spend-limit card draws its four states: loading, unreadable, no limit, and a limit with its bar and notices', () => {
  // Mutations checked: Remove drawn with no limit; the notices drawn with no limit; the stop sentence dropped; the empty state's words changed.
  assert.match(html(h(SpendLimitCard, { read: LOADING })), /data-testid="limit-loading"/);
  assert.match(html(h(SpendLimitCard, { read: UNREADABLE })), /Your spend limit could not be read\./);
  const empty = html(h(SpendLimitCard, { read: ready(NONE) }));
  assert.ok(empty.includes(NO_LIMIT));
  assert.match(empty, /data-testid="limit-set"[^>]*>Set a limit</);
  assert.doesNotMatch(empty, /limit-remove|limit-notices|limit-bar/);
  const set = html(h(SpendLimitCard, { read: ready(LIMIT) }));
  assert.match(set, /value="500"/);
  assert.match(set, /\$135\.22<\/span> spent this month/);
  assert.match(set, />27%</);
  assert.match(set, /aria-valuenow="27"/);
  for (const t of [50, 80, 100]) assert.match(set, new RegExp(`data-testid="limit-notify-${t}"`));
  assert.match(set, />Notify me at 50%</);
  assert.match(set, /Notices arrive in your bell and by email\./);
  assert.match(set, /Runs, and auto-reloads, that would pass it are stopped until 1 Nov\./);
  assert.match(set, /data-testid="limit-remove"[^>]*>Remove</);
});

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    by, text, props,
    type: (id, value) => act(async () => { props(by(id)).onChange({ target: { value } }); }),
    click: (id) => act(async () => { props(by(id)).onClick(); await settle(); }),
    submit: (id) => act(async () => { props(by(id)).onSubmit({ preventDefault() {} }); await settle(); }),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
/** A read whose `set` keeps what the PUT answered, as `useAccountRead` does. */
function liveRead(data) {
  const r = { status: 'ready', data, reload() {}, set(next) { r.data = next; } };
  return r;
}

// 3 ───────────────────────────────────────────────────────────────────────────
test('Save sends dollars with two decimals at most; a bad amount sends nothing; a refusal shows its field; Remove sends null', async () => {
  // Mutations checked: the typed text sent as a string; Save with an unparsed amount; a field refusal shown as a page outcome; Remove sending 0; the notices dropped from Save.
  const sent = [];
  const api = { setSpendLimit: async (usd, notify) => { sent.push([usd, notify]); return usd === null ? NONE : { ...LIMIT, limit_microusd: Math.round(usd * 100) * 10_000 }; } };
  const m = await mount(h(SpendLimitCard, { read: liveRead(LIMIT), api }));
  try {
    await m.type('limit-input', '1.234');
    await m.submit('limit-form');
    assert.deepEqual(sent, [], 'nothing sent');
    assert.match(m.text(m.by('limit-field-error')), /from \$0 to \$100,000, with at most two decimals/);
    await m.type('limit-input', '$750.5');
    await m.submit('limit-form');
    assert.deepEqual(sent, [[750.5, NOTIFY]]);
    assert.equal(m.by('limit-field-error'), undefined);
    assert.match(m.text(m.by('account-outcome-ok') ?? m.by('limit-form').parentNode), /Limit saved\./);
    await m.click('limit-remove');
    assert.deepEqual(sent[1], [null, undefined], 'Remove sends null');
  } finally { await m.unmount(); }

  const refusing = { setSpendLimit: async () => { throw Object.assign(new Error('The limit cannot be more than $100,000.'), { status: 400, field: 'monthly_limit_usd' }); } };
  const r = await mount(h(SpendLimitCard, { read: liveRead(LIMIT), api: refusing }));
  try {
    await r.type('limit-input', '99999');
    await r.submit('limit-form');
    assert.match(r.text(r.by('limit-field-error')), /The limit cannot be more than \$100,000\./, 'the refusal is shown at its field');
    assert.equal(r.props(r.by('limit-input'))['aria-invalid'], 'true');
  } finally { await r.unmount(); }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the notice switches round-trip: a switch sends the limit with that notice changed, and draws what the Worker answered', async () => {
  // Mutations checked: the switch sending only its own threshold; the limit dropped from a switch's save; the switch drawing its click rather than the answer.
  const sent = [];
  const api = { setSpendLimit: async (usd, notify) => { sent.push([usd, notify]); return { ...LIMIT, notify }; } };
  const read = liveRead(LIMIT);
  const m = await mount(h(SpendLimitCard, { read, api }));
  try {
    assert.equal(m.props(m.by('limit-notify-80'))['aria-checked'], 'true');
    await m.click('limit-notify-80');
    assert.deepEqual(sent, [[500, { 50: true, 80: false, 100: true }]]);
    assert.deepEqual(read.data.notify, { 50: true, 80: false, 100: true }, 'the answer is kept');
  } finally { await m.unmount(); }
  // Drawn from the read, not from the click.
  assert.match(html(h(SpendLimitCard, { read: ready({ ...LIMIT, notify: { 50: true, 80: false, 100: true } }) })), /aria-checked="false"[^>]*data-testid="limit-notify-80"/);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('each read-only card draws its figures, its empty or Not recorded state, and Unreadable', () => {
  // Mutations checked: the no-plan line dropped; the pack orders drawn as 0 when unread; auto-reload's link to Billing removed; the shared limit note dropped.
  const allowance = html(h(PlanAllowanceCard, { budget: ready(BUDGET) }));
  assert.match(allowance, /\$200\.00<\/span> a month/);
  assert.match(allowance, /\$135\.61<\/span> used · resets/);
  const noPlan = html(h(PlanAllowanceCard, { budget: ready({ ...BUDGET, monthly_microusd: 0 }) }));
  assert.match(noPlan, /Not recorded/);
  assert.ok(noPlan.includes(NO_PLAN_ALLOWANCE));
  assert.match(html(h(PlanAllowanceCard, { budget: UNREADABLE })), /Your plan allowance could not be read\./);

  const reload = html(h(AutoReloadSummary, { read: ready(RELOAD), topUp: ready(TOPUP) }));
  assert.match(reload, />Off</);
  assert.match(reload, /When on, buys the \$25 pack below \$5\./);
  assert.match(reload, /The spend limit above is also auto-reload’s limit\./);
  assert.match(reload, /href="\/account\/billing#auto-reload"[^>]*>Open billing →</);
  assert.match(html(h(AutoReloadSummary, { read: ready({ ...RELOAD, enabled: true }), topUp: ready(TOPUP) })), />On</);
  assert.match(html(h(AutoReloadSummary, { read: UNREADABLE, topUp: ready(TOPUP) })), /Auto-reload could not be read\./);

  const orders = html(h(PackOrdersCard, { read: ready({ ...LIMIT, pack_orders: { today: 1, per_day: 5 } }) }));
  assert.match(orders, />1 <span[^>]*>of 5</);
  assert.match(orders, /Auto-reloads count toward it\./);
  const unread = html(h(PackOrdersCard, { read: ready(LIMIT) }));
  assert.match(unread, /data-testid="pack-orders-unrecorded"/);
  assert.ok(unread.includes(PACK_ORDERS_NOT_READ));
  assert.doesNotMatch(unread, /of 5/);
  assert.match(html(h(PackOrdersCard, { read: UNREADABLE })), /Today’s pack orders could not be read\./);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('Limits lights Usage and Limits in the account navigation, and the address opens it', () => {
  // Mutations checked: the page not lit; the section lit as the page; the subpages not drawn; the canonical path dropping /limits.
  const sections = [{ id: 'billing', label: 'Billing and orders' }, { id: 'usage', label: 'Usage' }, { id: 'connectors', label: 'Connectors' }];
  const nav = renderToStaticMarkup(h(AccountSectionNav, { sections, active: 'usage', onSelect() {}, subpages: { usage: USAGE_PAGES }, activeSubpage: 'limits' }));
  assert.match(nav, /data-active="true" data-testid="account-nav-usage"/);
  assert.doesNotMatch(nav, /aria-current="page"[^>]*data-testid="account-nav-usage"/);
  assert.match(nav, /aria-current="page" data-testid="account-nav-usage-limits"/);
  assert.doesNotMatch(nav, /aria-current="page" data-testid="account-nav-usage-overview"/);
  assert.match(nav, /account-nav-usage"[\s\S]*account-nav-usage-overview[\s\S]*account-nav-usage-limits[\s\S]*account-nav-connectors/, 'in order, under Usage');
  const other = renderToStaticMarkup(h(AccountSectionNav, { sections, active: 'billing', onSelect() {}, subpages: { usage: USAGE_PAGES } }));
  assert.match(other, /aria-current="page" data-active="true" data-testid="account-nav-billing"/);
  assert.doesNotMatch(other, /data-active="true" data-testid="account-nav-usage"/);

  assert.equal(accountViewFor({ pathname: '/account/usage/limits' }), 'usage');
  assert.equal(usagePageFor('/account/usage/limits'), 'limits');
  assert.equal(usagePageFor('/account/usage'), 'overview');
  assert.equal(usagePageFor('/account/usage/nope'), 'overview');
  assert.equal(accountPathFor({ section: 'usage', usagePage: 'limits' }), '/account/usage/limits');
  assert.equal(accountPathFor({ section: 'usage', usagePage: 'overview' }), '/account/usage');
  assert.equal(accountPathFor({ section: 'usage' }), '/account/usage');

  const page = readFileSync(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /usagePage === 'limits' \? <LimitsPage \/> : usagePage === 'cost' \? <CostPage role=\{role\} \/> : <UsageSection role=\{role\} \/>/);
  assert.match(page, /accountPathFor\(\{ section: active, phone, key: connectorKey, usagePage \}\)/, 'the canonical address keeps /limits');
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the page: the header and four cards on desktop; on a phone its own bar back to Usage, and the cards in one column', () => {
  // Mutations checked: the phone bar dropped; the phone's back to Usage removed; the desktop's three-column grid kept on a phone.
  const reads = { limit: ready(LIMIT), budget: ready(BUDGET), autoReload: ready(RELOAD), topUp: ready(TOPUP) };
  const desk = html(h(LimitsView, reads));
  assert.match(desk, /<h2[^>]*>Limits<\/h2>/);
  assert.match(desk, /What stops spend, and when it resets\./);
  assert.match(desk, /class="[^"]*lg:grid-cols-3" data-testid="limits-cards"/);
  for (const id of ['card-spend-limit', 'card-plan-allowance', 'card-auto-reload-summary', 'card-pack-orders']) assert.match(desk, new RegExp(`data-testid="${id}"`));
  const phone = html(h(LimitsView, { ...reads, phone: true }));
  assert.match(phone, /data-phone="true"/);
  assert.match(phone, /<h1[^>]*>Limits<\/h1>/);
  assert.match(phone, /href="\/account\/usage"[^>]*>‹ Usage</);
  assert.match(phone, /class="[^"]*grid-cols-1" data-testid="limits-cards"/);
  assert.doesNotMatch(phone, /lg:grid-cols-3/);
  assert.doesNotMatch(phone, /<h2[^>]*>Limits<\/h2>/);
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('no new /api method: the page calls only D788\'s, D640\'s, D794\'s and D755\'s, and D805\'s pack_orders is on the limit read', () => {
  // Mutations checked: a fetch of its own; pack_orders dropped from the limit read.
  const src = readFileSync(new URL('../src/pages/account/LimitsPage.jsx', import.meta.url), 'utf8');
  assert.deepEqual([...src.matchAll(/aiBudgetApi\.(\w+)\(/g)].map((m) => m[1]).sort(), ['autoReload', 'mine', 'spendLimit', 'topUp']);
  assert.doesNotMatch(src, /fetch\(|request\(/);
  // D805 (#2253): the limit read carries `pack_orders` with the two figures the card reads.
  const route = readFileSync(new URL('../../cloudflare-worker/src/routes/ai_budget.ts', import.meta.url), 'utf8');
  assert.match(route, /pack_orders:await packOrdersToday\(c\.env,user\.id\)/);
  const credits = readFileSync(new URL('../../cloudflare-worker/src/services/aiCredits.ts', import.meta.url), 'utf8');
  assert.match(credits, /export async function packOrdersToday[^\n]*Promise<\{ today: number; per_day: number;/);
});
