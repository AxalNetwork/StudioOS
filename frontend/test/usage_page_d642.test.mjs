/**
 * D642 (#1435) — the Usage page at /account/usage (U1–U6) and HQ's AI
 * allowances at /admin/platform/allowances (U7).
 *
 * What is held here:
 *   - the formatting rules from #1430's prompt: USD below one cent to four
 *     decimals, short token counts with the exact figure on hover, and a
 *     missing figure drawn as "Not recorded" / "Not counted", never as 0;
 *   - every card's loading, empty, "Not recorded", Unreadable and ready
 *     states, each card failing on its own;
 *   - the reads are the caller's alone: no read carries a company, and the
 *     Worker routes behind them never consult the active company, so
 *     switching company in the sidebar changes nothing on the page;
 *   - the entry points: the Account section, the user menu, the rail card,
 *     the HQ route, its Platform strip item and its Platform link.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/usage_page_d642.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  allowanceView, bytes, dayAxis, dayBars, microUsd, modelRows, pageOf, pageRows, filterPages, planLabel,
  rateRows, receiptView, shortTokens, storageView, surfaceLabel, taskRows, topUpState, untilUtcMidnight, usd,
} from '../src/pages/account/usageModel.js';
import UsageSection, {
  AllowanceCard, DaysCard, LastRunCard, ModelsCard, StorageCard, WhereCard,
} from '../src/pages/account/AccountUsage.jsx';
import {
  EditPlanForm, HeldCard, HeldRun, PlansCard, parseUsd, sourceView,
} from '../src/pages/hq/PlatformAllowancesPage.jsx';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/usage'] }, el));
const ready = (data) => ({ status: 'ready', data, reload() {} });
const LOADING = { status: 'loading', data: null, reload() {} };
const UNREADABLE = { status: 'unreadable', data: null, message: 'boom', reload() {} };

const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WHISPER = '@cf/openai/whisper';
const BUDGET = {
  licence: 'founder:growth', source: 'environment',
  daily_microusd: 2_000_000, monthly_microusd: 40_000_000,
  day_spend_microusd: 420_000, month_spend_microusd: 6_100_000,
  day_reserved_microusd: 0, month_reserved_microusd: 50_000, topup_reserved_microusd: 0,
  balance_microusd: 10_000_000, held_for_review: [],
};
const PRODUCT = { configured: true, state: 'ready', product: { price_id: 'price_abc123', currency: 'usd', unit_amount: 1000 } };
const DAYS = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 9 + i));
  const key = d.toISOString().slice(0, 10);
  return i === 6 ? { day: key, calls: 0, spend_usd: 0 } : { day: key, calls: i + 1, spend_usd: (i + 1) / 100 };
});
const SPEND = {
  ok: true, recorded: true,
  month: { key: '2026-10', spend_usd: 4.28, cap_usd: 40, enforced_usd: null, calls: 12 },
  today: { key: '2026-10-08', spend_usd: 0.42, cap_usd: 2, enforced_usd: null, calls: 3 },
  days: DAYS, days_recorded: true,
  by_surface: [
    { surface: null, calls: 6, spend_usd: 0.0042 },
    { surface: '/validate/interviews', calls: 4, spend_usd: 1.84 },
  ],
  by_surface_recorded: true,
  by_task: [{ task: 'explain', label: 'Explain this page', calls: 3, spend_usd: 1.2 }],
  by_task_recorded: true,
  by_model: [
    { model: LLAMA, calls: 5, spend_usd: 3.92, prompt_tokens: 1_234_567, completion_tokens: 340_000, uncounted_calls: 1, cached_calls: 1, fallback_calls: 0 },
    { model: WHISPER, calls: 2, spend_usd: 0.36, prompt_tokens: 0, completion_tokens: 0, uncounted_calls: 2, cached_calls: 0, fallback_calls: 0 },
  ],
  by_model_recorded: true,
  last_run: { task: 'draft', label: 'Draft an email', model: LLAMA, cost_usd: 0.0042, prompt_tokens: 1840, completion_tokens: null, cached: false, fallback_used: true, refusal: null, at: '2026-10-08 14:02:11' },
  last_run_recorded: true,
};
const RATES = { ok: true, models: [
  { id: LLAMA, name: 'Llama 3.3 70B', in_per_1m_usd: 0.29, out_per_1m_usd: 2.25 },
  { id: '@cf/old/model', name: 'Older model', in_per_1m_usd: 0.27, out_per_1m_usd: 0.85, retired: true },
  { id: WHISPER, name: 'Whisper', per_audio_minute_usd: 0.0005 },
] };
const area = (key, files, b, unknown = 0, recorded = true) => ({ key, files, bytes: b, unknown_size_files: unknown, recorded });
const STORAGE = {
  total_bytes: null, files: 148, unknown_size_files: 3,
  areas: [
    area('data_room', 64, 859_832_320), area('diligence_files', 31, null, 3), area('research_library', 22, 50_331_648),
    area('message_attachments', 27, 100_663_296), area('interview_recordings', 4, 32_505_856),
  ],
};

// ---------------------------------------------------------------- the rules

test('amounts are US dollars; below one cent, up to four decimals; zero is a real $0.00', () => {
  assert.equal(usd(0), '$0.00');
  assert.equal(usd(0.0042), '$0.0042');
  assert.equal(usd(0.005), '$0.005');
  assert.equal(usd(0.00004), '< $0.0001');
  assert.equal(usd(6.1), '$6.10');
  assert.equal(usd(1234.5), '$1,234.50');
  assert.equal(usd(null), null);
  assert.equal(usd(Number.NaN), null);
  assert.equal(microUsd(420_000), '$0.42');
  assert.equal(microUsd(4_200), '$0.0042');
  assert.equal(microUsd(1.5), null, 'a micro-USD figure is an integer or unreadable');
});

test('token counts are short, bytes take the largest unit, labels read as the canvas words them', () => {
  assert.equal(shortTokens(812), '812');
  assert.equal(shortTokens(340_000), '340k');
  assert.equal(shortTokens(1_234_567), '1.2M');
  assert.equal(shortTokens(-1), null);
  assert.equal(bytes(512), '512 B');
  assert.equal(bytes(1_288_490_189), '1.2 GB');
  assert.equal(bytes(null), null);
  assert.equal(planLabel('founder:growth'), 'Founder · Growth');
  assert.equal(planLabel('investor:professional'), 'Investor · Professional');
  assert.equal(planLabel('advisor'), 'Advisor');
  assert.equal(surfaceLabel('/validate/interviews'), 'Validate › Interviews');
  assert.equal(surfaceLabel('/research/market-reading'), 'Research › Market reading');
  assert.equal(surfaceLabel(null), null, 'a run with no page has no label; the card says "No page recorded"');
  assert.equal(untilUtcMidnight(new Date(Date.UTC(2026, 9, 8, 18, 48))), 'in 5 h 12 min');
  assert.equal(untilUtcMidnight(new Date(Date.UTC(2026, 9, 8, 23, 59, 30))), 'in 1 min');
});

test('U1: the allowance view, its used-up, no-allowance and paused states, and an unreadable read', () => {
  const v = allowanceView(BUDGET, new Date(Date.UTC(2026, 9, 8, 18, 48)));
  assert.equal(v.plan, 'Founder · Growth');
  assert.deepEqual(v.today, { used: '$0.42', of: '$2.00', pct: 21, reset: 'Resets at 00:00 UTC · in 5 h 12 min' });
  assert.equal(v.month.used, '$6.10');
  assert.equal(v.month.pct, 15, 'the bar counts holds with spend: 6.10 + 0.05 of 40');
  assert.equal(allowanceView({ ...BUDGET, month_reserved_microusd: 4_000_000 }).month.pct, 25, 'a large hold fills the bar: 6.10 + 4.00 of 40');
  assert.equal(allowanceView({ ...BUDGET, day_reserved_microusd: 580_000 }).today.pct, 50, 'and the day bar: 0.42 + 0.58 of 2');
  assert.equal(v.held, '$0.05');
  assert.equal(v.balance, '$10.00');
  assert.deepEqual(v.states, []);
  assert.deepEqual(allowanceView({ ...BUDGET, day_spend_microusd: 1_990_000, day_reserved_microusd: 10_000 }).states, ['day_used_up']);
  assert.deepEqual(allowanceView({ ...BUDGET, month_spend_microusd: 40_000_000 }).states, ['month_used_up']);
  assert.deepEqual(allowanceView({ ...BUDGET, daily_microusd: 0, monthly_microusd: 0 }).states, ['no_allowance']);
  assert.equal(allowanceView({ ...BUDGET, daily_microusd: 0 }).today, null, 'no daily allowance is not a $0.00 bar');
  assert.deepEqual(allowanceView({ ...BUDGET, held_for_review: [{ uid: 'r1' }] }).states, ['paused']);
  assert.equal(allowanceView({ ...BUDGET, balance_microusd: null }), null);
  assert.equal(allowanceView({ ...BUDGET, held_for_review: undefined }), null);
  assert.equal(topUpState(PRODUCT), 'available');
  assert.equal(topUpState({ configured: false, product: null }), 'unavailable');
  // D750: a configuration problem is unavailable, never unreadable.
  assert.equal(topUpState({ configured: true, state: 'not_ready' }), 'unavailable');
  assert.equal(topUpState({ configured: true, state: 'ready', product: null }), 'unreadable');
  assert.equal(topUpState({ configured: true, product: PRODUCT.product }), 'unreadable', 'a reading with no state is not on sale');
  assert.equal(topUpState({ configured: true, product: { price_id: 'x' } }), 'unreadable');
  assert.equal(topUpState(null), 'unreadable');
});

test('U2–U5: days, pages, tasks, models and the receipt never turn a missing figure into 0', () => {
  const bars = dayBars(DAYS);
  assert.equal(bars.length, 30);
  assert.equal(bars[6].none, true);
  assert.equal(bars[6].height, 2, 'a day with no runs is a stub, not left out');
  assert.match(bars[6].tip, /0 runs · \$0\.00$/);
  assert.equal(bars[29].today, true);
  assert.equal(bars[29].height, 100);
  assert.deepEqual(dayAxis(DAYS), ['9 Sep', '16 Sep', '24 Sep', '1 Oct', '8 Oct']);

  const pages = pageRows(SPEND.by_surface);
  assert.deepEqual(pages.map((r) => r.label), ['Validate › Interviews', null], 'the no-page row comes last');
  assert.equal(pages[1].noPage, true);
  assert.equal(pages[1].cost, '$0.0042');
  assert.deepEqual(filterPages(pages, 'interv').map((r) => r.key), ['/validate/interviews']);
  assert.deepEqual(filterPages(pages, 'no page').map((r) => r.key), ['(none)']);
  const many = Array.from({ length: 23 }, (_, i) => ({ key: `/p${i}` }));
  assert.deepEqual([pageOf(many, 3).rows.length, pageOf(many, 3).pages, pageOf(many, 9).page], [3, 3, 3]);
  assert.deepEqual(taskRows(SPEND.by_task), [{ key: 'explain', label: 'Explain this page', runs: 3, cost: '$1.20' }]);

  const models = modelRows(SPEND.by_model, RATES);
  assert.equal(models[0].name, 'Llama 3.3 70B');
  assert.deepEqual(models[0].tin, { short: '1.2M', exact: '1,234,567' });
  assert.equal(models[0].notCounted, 1);
  assert.equal(models[1].tin, null, 'every run uncounted: no sum, never "0 tokens"');
  assert.equal(models[1].tout, null);
  assert.equal(modelRows(null, RATES), null);

  const rates = rateRows(RATES);
  assert.deepEqual(rates[0], { id: LLAMA, name: 'Llama 3.3 70B', pin: '$0.29', pout: '$2.25', unit: 'per million tokens', retired: false });
  assert.equal(rates[1].retired, true);
  assert.deepEqual([rates[2].pin, rates[2].pout, rates[2].unit], ['$0.0005', null, 'per audio minute']);
  // D766: an image model has no single rate; it is priced by size and steps.
  assert.deepEqual(rateRows({ models: [{ id: '@cf/black-forest-labs/flux-1-schnell', name: 'FLUX.1 Schnell', image: true, cost: { tiles: 0.0000528 } }] })[0],
    { id: '@cf/black-forest-labs/flux-1-schnell', name: 'FLUX.1 Schnell', pin: null, pout: null, unit: 'per image, by its size and steps', retired: false });

  const r = receiptView(SPEND.last_run, RATES);
  assert.deepEqual(r.flags.map((f) => f.t), ['Fallback', 'Not cached']);
  const row = (k) => r.rows.find((x) => x.k === k);
  assert.equal(row('When').v, '8 Oct, 14:02 UTC');
  assert.equal(row('Model').v, 'Llama 3.3 70B');
  assert.equal(row('Tokens in').v, '1,840');
  assert.deepEqual([row('Tokens out').v, row('Tokens out').nr], ['Not counted', true]);
  assert.equal(row('Cost').v, '$0.0042');
  const cached = receiptView({ ...SPEND.last_run, cached: true, prompt_tokens: null, fallback_used: false }, RATES);
  assert.deepEqual(cached.flags.map((f) => f.t), ['Cached']);
  assert.match(cached.rows.find((x) => x.k === 'Tokens in').sub, /cached answer/);
  assert.deepEqual(receiptView({ ...SPEND.last_run, refusal: 'unsafe' }, RATES).flags.map((f) => f.t), ['Fallback', 'Not cached', 'Refused']);
  assert.equal(receiptView(null, RATES), null);
});

test('U6: storage keeps unknown sizes unknown, and an unreadable place costs only its row', () => {
  const v = storageView(STORAGE);
  assert.equal(v.total, null, 'the Worker gave no exact total');
  assert.equal(v.files, 148);
  const dil = v.places.find((p) => p.key === 'diligence_files');
  assert.deepEqual([dil.size, dil.noSize], [null, 3]);
  assert.equal(v.places.find((p) => p.key === 'data_room').size, '820 MB');
  const one = storageView({ ...STORAGE, areas: STORAGE.areas.map((a) => (a.key === 'research_library' ? { key: a.key, recorded: false, files: null, bytes: null, unknown_size_files: null } : a)) });
  assert.equal(one.places.find((p) => p.key === 'research_library').unreadable, true);
  assert.equal(one.places.filter((p) => p.unreadable).length, 1);
  assert.equal(one.anyUnreadable, true);
  assert.equal(one.empty, false);
  const empty = storageView({ total_bytes: 0, files: 0, unknown_size_files: 0, areas: STORAGE.areas.map((a) => area(a.key, 0, 0)) });
  assert.equal(empty.empty, true);
  assert.equal(storageView({}), null);
});

// ------------------------------------------------------------ every card state

test('U1 renders loading, Unreadable (the others still load), ready, and each state of the card', () => {
  assert.match(html(h(AllowanceCard, { budget: LOADING, product: LOADING })), /data-testid="account-loading"/);
  const bad = html(h(AllowanceCard, { budget: UNREADABLE, product: ready(PRODUCT) }));
  assert.match(bad, /Your allowance could not be read\. The other cards still load\./);
  assert.doesNotMatch(bad, /\$/);
  const ok = html(h(AllowanceCard, { budget: ready(BUDGET), product: ready(PRODUCT) }));
  assert.match(ok, /Included with your plan: Founder · Growth/);
  assert.match(ok, /\$0\.42 <span[^>]*>of \$2\.00/);
  assert.match(ok, /\$6\.10 <span[^>]*>of \$40\.00/);
  assert.match(ok, /Resets on the 1st at 00:00 UTC/);
  assert.match(ok, /data-testid="usage-held"[\s\S]*\$0\.05[\s\S]*Returned if a run does not finish within 5 minutes/);
  assert.match(ok, /href="\/plans-and-pricing#token-packs"[^>]*>Add tokens</);
  assert.match(ok, /Runs use your included allowance first, then your top-up balance\./);
  const noDaily = html(h(AllowanceCard, { budget: ready({ ...BUDGET, daily_microusd: 0 }), product: ready(PRODUCT) }));
  assert.match(noDaily, /data-testid="usage-today"[\s\S]*Not recorded[\s\S]*The plan sets no daily allowance\. Runs use your top-up balance\./);
  const none = html(h(AllowanceCard, { budget: ready({ ...BUDGET, daily_microusd: 0, monthly_microusd: 0 }), product: ready(PRODUCT) }));
  assert.match(none, /data-testid="usage-state-no_allowance"[\s\S]*No allowance on this plan[\s\S]*Runs use your top-up balance\./);
  assert.doesNotMatch(none, /usage-today/);
  // Pin the clock: within the last UTC hour the valid copy contains minutes only.
  const dayOut = html(h(AllowanceCard, { budget: ready({ ...BUDGET, day_spend_microusd: 2_000_000 }), product: ready(PRODUCT), now: new Date('2026-10-08T18:48:00Z') }));
  assert.match(dayOut, /Today’s allowance is used up[\s\S]*It resets at 00:00 UTC, in \d+ h \d+ min\. Runs use your top-up balance until then\./);
  const paused = html(h(AllowanceCard, { budget: ready({ ...BUDGET, held_for_review: [{ uid: 'r1' }] }), product: ready(PRODUCT) }));
  assert.match(paused, /role="alert" data-testid="usage-state-paused"[\s\S]*Runs paused[\s\S]*A run cost more than it held\. New runs wait while HQ checks the charge\./);
  const noTopUp = html(h(AllowanceCard, { budget: ready(BUDGET), product: ready({ configured: false, product: null }) }));
  assert.match(noTopUp, /Top-up isn&#x27;t available yet\. Runs use your included allowance only\./);
  assert.doesNotMatch(noTopUp, /Add tokens/);
  const topUpBad = html(h(AllowanceCard, { budget: ready(BUDGET), product: UNREADABLE }));
  assert.match(topUpBad, /The top-up option could not be read\. Your balance above is unaffected\./);
  assert.match(topUpBad, /\$10\.00/, 'the balance stands when only the purchase option is unreadable');
  assert.doesNotMatch(topUpBad, /Add tokens/);
});

test('U2 renders loading, Unreadable, empty and the 30 bars', () => {
  assert.match(html(h(DaysCard, { spend: LOADING })), /account-loading/);
  assert.match(html(h(DaysCard, { spend: UNREADABLE })), /The last 30 days could not be read\./);
  assert.match(html(h(DaysCard, { spend: ready({ ...SPEND, days: null, days_recorded: false }) })), /The last 30 days could not be read\./,
    'the report read, but not this breakdown: this card alone is Unreadable');
  assert.match(html(h(DaysCard, { spend: ready({ ...SPEND, days: DAYS.map((d) => ({ ...d, calls: 0, spend_usd: 0 })) }) })), /No AI runs in the last 30 days\./);
  const ok = html(h(DaysCard, { spend: ready(SPEND) }));
  assert.equal((ok.match(/data-testid="usage-day"/g) || []).length, 30);
  assert.match(ok, /title="15 Sep · 0 runs · \$0\.00"/);
  assert.match(ok, /A day with no runs is a real \$0\.00\. No allowance line/);
  assert.match(ok, /id="days"/);
});

test('U3 renders loading, Unreadable, empty, the page tab with its no-page row, search and pages, and the task tab', () => {
  assert.match(html(h(WhereCard, { spend: LOADING })), /account-loading/);
  assert.match(html(h(WhereCard, { spend: UNREADABLE })), /Where it went could not be read\./);
  assert.match(html(h(WhereCard, { spend: ready({ ...SPEND, by_surface_recorded: false }) })), /Where it went could not be read\./);
  assert.match(html(h(WhereCard, { spend: ready({ ...SPEND, month: { ...SPEND.month, calls: 0 } }) })), /No AI runs yet this month\./);
  const ok = html(h(WhereCard, { spend: ready(SPEND) }));
  assert.match(ok, /Validate › Interviews/);
  assert.match(ok, /data-testid="usage-where-nopage"[\s\S]*No page recorded[\s\S]*\$0\.0042/);
  assert.match(ok, /No page recorded: these runs carry no page\./);
  assert.match(ok, /data-testid="usage-where-search"/);
  assert.match(ok, /Estimated from the run log\. Runs still in progress are not in these figures yet\./);
  assert.doesNotMatch(ok, /usage-where-pages/, 'one page needs no pager');
  const lots = { ...SPEND, by_surface: Array.from({ length: 12 }, (_, i) => ({ surface: `/page-${i}`, calls: 1, spend_usd: 0.1 })) };
  assert.match(html(h(WhereCard, { spend: ready(lots) })), /data-testid="usage-where-pages"[\s\S]*1 of 2/);
  const tasks = html(h(WhereCard, { spend: ready(SPEND), initialTab: 'task' }));
  assert.match(tasks, /What Eadwyn was doing[\s\S]*Explain this page/);
  assert.match(html(h(WhereCard, { spend: ready({ ...SPEND, by_task_recorded: false }), initialTab: 'task' })), /Where it went could not be read\./);
});

test('U4 renders models with "not counted" never as 0 tokens, and the rate card with its Retired pill', () => {
  assert.match(html(h(ModelsCard, { spend: LOADING, rates: LOADING })), /account-loading/);
  const bad = html(h(ModelsCard, { spend: UNREADABLE, rates: UNREADABLE }));
  assert.match(bad, /Models could not be read\./);
  assert.match(bad, /The rates could not be read\. Your charges are unaffected\./);
  assert.match(html(h(ModelsCard, { spend: ready({ ...SPEND, by_model: [] }), rates: ready(RATES) })), /No AI runs yet this month\./);
  const ok = html(h(ModelsCard, { spend: ready(SPEND), rates: ready(RATES) }));
  assert.match(ok, /Llama 3\.3 70B[\s\S]*@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast/);
  assert.match(ok, /<span title="1,234,567">1\.2M<\/span>/);
  assert.match(ok, /data-testid="usage-model-not-counted"[^>]*>1 run not counted/);
  const whisperRow = ok.slice(ok.lastIndexOf('data-testid="usage-model-row"'));
  assert.match(whisperRow, /data-testid="usage-model-in"[^>]*><span[^>]*>Not counted</);
  assert.doesNotMatch(whisperRow.slice(0, whisperRow.indexOf('</tr>')), />0<\//, 'no 0 tokens');
  assert.match(ok, /Older model<span[^>]*>Retired</);
  assert.match(ok, /\$0\.0005[\s\S]*per audio minute/);
  assert.match(ok, /Your allowance and top-up balance are charged at these rates\./);
  const ratesOnlyBad = html(h(ModelsCard, { spend: ready(SPEND), rates: UNREADABLE }));
  assert.match(ratesOnlyBad, /@cf\/meta\/llama/, 'the models still draw, by id, when the rate card fails');
});

test('U5 renders the receipt, its flags, "Not counted" with its reason, and its empty and Unreadable states', () => {
  assert.match(html(h(LastRunCard, { spend: LOADING, rates: LOADING })), /account-loading/);
  assert.match(html(h(LastRunCard, { spend: ready({ ...SPEND, last_run_recorded: false }), rates: ready(RATES) })), /The last run could not be read\./);
  assert.match(html(h(LastRunCard, { spend: ready({ ...SPEND, last_run: null }), rates: ready(RATES) })), /No AI runs yet\./);
  const ok = html(h(LastRunCard, { spend: ready(SPEND), rates: ready(RATES) }));
  assert.match(ok, /data-testid="usage-run-flag"[^>]*>Fallback</);
  assert.match(ok, /8 Oct, 14:02 UTC/);
  assert.match(ok, /Draft an email/);
  assert.match(ok, /data-testid="usage-receipt-tokens-out"[\s\S]*Not counted[\s\S]*A streamed reply or a transcription recorded no count\./);
  assert.match(ok, /data-testid="usage-receipt-cost"[\s\S]*\$0\.0042/);
});

test('U6 renders the total or its absence, unknown sizes, an unreadable place, empty and Unreadable', () => {
  assert.match(html(h(StorageCard, { storage: LOADING })), /account-loading/);
  assert.match(html(h(StorageCard, { storage: UNREADABLE })), /Storage could not be read\. This is not a claim that you stored nothing\./);
  const ok = html(h(StorageCard, { storage: ready(STORAGE) }));
  assert.match(ok, /data-testid="usage-storage-total"[\s\S]*Total not recorded/);
  assert.match(ok, /data-testid="usage-storage-diligence_files"[\s\S]*31 files[\s\S]*Not recorded[\s\S]*3 files with no size recorded/);
  assert.match(ok, /Other files you keep on StudioOS are not counted yet\. No plan sets a storage limit\./);
  assert.doesNotMatch(ok, /0 B/, 'an unknown size is never 0 bytes');
  const exact = html(h(StorageCard, { storage: ready({ ...STORAGE, total_bytes: 1_288_490_189, unknown_size_files: 0, areas: STORAGE.areas.map((a) => (a.bytes == null ? area(a.key, a.files, 1000) : a)) }) }));
  assert.match(exact, /1\.2 GB <span[^>]*>in 148 files/);
  const one = html(h(StorageCard, { storage: ready({ ...STORAGE, areas: STORAGE.areas.map((a) => (a.key === 'message_attachments' ? { key: a.key, recorded: false } : a)) }) }));
  assert.match(one, /Message attachments could not be read\. The other places still count\./);
  assert.match(one, /64 files/);
  const empty = ready({ total_bytes: 0, files: 0, unknown_size_files: 0, areas: STORAGE.areas.map((a) => area(a.key, 0, 0)) });
  assert.match(html(h(StorageCard, { storage: empty, role: 'founder' })), /No files uploaded yet\.[\s\S]*Open the data room/);
  assert.doesNotMatch(html(h(StorageCard, { storage: empty, role: 'investor' })), /Open the data room/, 'no door to a route the role cannot open');
});

test('the section draws its heading and the six cards, each in its own loading state, in the canvas order', () => {
  const s = html(h(UsageSection, { role: 'founder' }));
  assert.match(s, /<h2[^>]*>Usage<\/h2><p[^>]*>What you have used across all your companies\.<\/p>/);
  const order = ['usage-card-allowance', 'usage-card-days', 'usage-card-where', 'usage-card-models', 'usage-card-rates', 'usage-card-last-run', 'usage-card-storage']
    .map((id) => s.indexOf(`data-testid="${id}"`));
  assert.ok(order.every((i) => i >= 0), 'every card renders');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in the canvas order');
  for (const anchor of ['days', 'where', 'models', 'last-run', 'storage']) assert.match(s, new RegExp(`id="${anchor}"`), `#${anchor} lands`);
});

// --------------------------------------------- the member's, across companies

test('switching company changes nothing: no read carries a company, and no route behind it reads one', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const { api, setActiveCompanyId } = await import('../src/lib/api.js');
  const { aiBudgetApi } = await import('../src/lib/api/aiBudget.js');
  const { usageApi } = await import('../src/lib/api/usage.js');
  const runs = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    runs.at(-1).push([init.method || 'GET', String(url).replace(/^.*\/api/, '')]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    for (const company of [11, 22]) {
      setActiveCompanyId(company);
      runs.push([]);
      await aiBudgetApi.mine(); await aiBudgetApi.topUp(); await api.myAiSpend(); await aiBudgetApi.rates(); await usageApi.storage();
    }
  } finally { globalThis.fetch = orig; setActiveCompanyId(null); }
  assert.deepEqual(runs[0], [['GET', '/ai-budget/me'], ['GET', '/ai-budget/top-up'], ['GET', '/ai/me/spend'], ['GET', '/ai/rates'], ['GET', '/usage/storage']]);
  assert.deepEqual(runs[1], runs[0], 'the same five reads, whatever company is active');

  const page = read('frontend/src/pages/account/AccountUsage.jsx');
  assert.doesNotMatch(page, /ompany(Id|_id)|useActiveCompany|getActiveCompanyId/, 'the page never asks which company is active');
  for (const f of ['cloudflare-worker/src/routes/usage.ts', 'cloudflare-worker/src/services/storageUsage.ts',
    'cloudflare-worker/src/routes/ai_budget.ts', 'cloudflare-worker/src/services/aiBudget.ts', 'cloudflare-worker/src/services/aiSpend.ts']) {
    assert.doesNotMatch(read(f), /activeCompany|active_company/, `${f} never consults the active company`);
  }
});

test('the HQ writes reach the Worker routes D640 mounted, with the bodies they validate', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const { aiBudgetApi } = await import('../src/lib/api/aiBudget.js');
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await aiBudgetApi.caps();
    await aiBudgetApi.setCaps('founder:growth', 2, 40);
    await aiBudgetApi.reviews();
    await aiBudgetApi.settleReview('r-1', 'charge', 'Checked the run log.');
    await aiBudgetApi.settleReview('r-2', 'refund', 'The model failed twice.');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls, [
    ['GET', '/ai-budget/caps', null],
    ['PUT', '/ai-budget/caps/founder%3Agrowth', { daily_usd: 2, monthly_usd: 40 }],
    ['GET', '/ai-budget/reviews', null],
    ['POST', '/ai-budget/reviews/r-1/charge', { reason: 'Checked the run log.' }],
    ['POST', '/ai-budget/reviews/r-2/refund', { reason: 'The model failed twice.' }],
  ]);
  const route = read('cloudflare-worker/src/routes/ai_budget.ts');
  assert.match(route, /r\.put\('\/caps\/:licence'/);
  assert.match(route, /typeof body\.daily_usd!=='number'/);
  assert.match(route, /r\.post\(`\/reviews\/:uid\/\$\{action\}`/);
  assert.match(route, /reason\.trim\(\)\.length<10/);
});

// ------------------------------------------------------------------ U7 · HQ

const CAPS = { plans: ['founder:free', 'founder:growth', 'founder:studio', 'investor:free', 'investor:professional', 'investor:institutional', 'advisor', 'partner', 'admin', 'other'].map((k) => (
  k === 'founder:growth'
    ? { licence_key: k, source: 'recorded', daily_microusd: 2_000_000, monthly_microusd: 40_000_000, recorded_by: 7, recorded_by_name: 'Ana HQ', recorded_at: '2026-10-07 09:40:00' }
    : { licence_key: k, source: 'environment', daily_microusd: 5_000_000, monthly_microusd: 50_000_000, recorded_by: null, recorded_by_name: null, recorded_at: null }
)) };

test('U7: the ten plans, where each allowance comes from, and Unreadable that claims nothing changed', () => {
  assert.match(html(h(PlansCard, { caps: LOADING })), /Reading the allowances…/);
  assert.match(html(h(PlansCard, { caps: UNREADABLE })), /Allowances could not be read\. No plan&#x27;s allowance has changed\./);
  const ok = html(h(PlansCard, { caps: ready(CAPS) }));
  assert.equal((ok.match(/data-testid="hq-allowance-row"/g) || []).length, 10);
  for (const label of ['Founder · Free', 'Founder · Growth', 'Founder · Studio', 'Investor · Free', 'Investor · Professional', 'Investor · Institutional', 'Advisor', 'Partner', 'Admin', 'Other']) {
    assert.ok(ok.includes(`>${label}<`), label);
  }
  assert.match(ok, /Set by HQ · Ana HQ · 7 Oct, 09:40 UTC/);
  assert.match(ok, /Platform default/);
  assert.match(ok, /Set by: a plan on the platform default records no editor\./);
  assert.match(ok, /\$2\.00[\s\S]*\$40\.00/);
  assert.deepEqual(sourceView({ source: 'environment' }), { text: 'Platform default', tone: 'neutral', nr: true });
  assert.equal(sourceView({ source: 'recorded', recorded_by_name: null, recorded_at: null }).text, 'Set by HQ');
});

test('U7: Edit takes two US-dollar amounts, 0 or more, and says the change applies to every member at once', () => {
  assert.equal(parseUsd('2'), 2);
  assert.equal(parseUsd('0'), 0);
  assert.equal(parseUsd('40.50'), 40.5);
  for (const bad of ['', '-1', 'abc', '1e3', '1.2345678', ' ']) assert.equal(parseUsd(bad), null, `"${bad}" is refused`);
  const form = html(h(EditPlanForm, { plan: CAPS.plans[1], onCancel() {}, onSaved() {} }));
  assert.match(form, /Edit · Founder · Growth/);
  assert.match(form, /Daily \(US\$, 0 or more\)[\s\S]*value="2"/);
  assert.match(form, /Monthly \(US\$, 0 or more\)[\s\S]*value="40"/);
  assert.match(form, /The change applies at once to every member on Founder · Growth\./);
  assert.match(form, /Apply to every member/);
});

test('U7: held runs list member, when, held and cost, each with Charge and Refund; empty and Unreadable are said', () => {
  assert.match(html(h(HeldCard, { reviews: LOADING })), /Reading the held runs…/);
  assert.match(html(h(HeldCard, { reviews: UNREADABLE })), /The held runs could not be read\. This is not a claim that none is held\./);
  const empty = html(h(HeldCard, { reviews: ready({ items: [] }) }));
  assert.match(empty, /No run is held for a check\.[\s\S]*Back to Platform/);
  const run = { uid: 'r-1', member_id: 3, member_name: 'Rae Member', at: '2026-10-08 14:02:00', held_microusd: 50_000, recorded_cost_microusd: 73_100 };
  const ok = html(h(HeldCard, { reviews: ready({ items: [run] }) }));
  assert.match(ok, /Rae Member[\s\S]*8 Oct, 14:02 UTC[\s\S]*held \$0\.05[\s\S]*run cost \$0\.07</);
  assert.match(ok, /Charge the hold…[\s\S]*Refund the hold…/);
  assert.match(ok, /Charge and Refund each need a reason of at least 10 characters\. The member is never charged more than the hold\./);
  assert.match(html(h(HeldRun, { run: { ...run, member_name: null }, onSettled() {} })), /Member not named/);
});

// ---------------------------------------------------------------- the doors

test('the doors: the Account section, the user menu, the rail card, the HQ route, strip and Platform link', () => {
  const settings = read('frontend/src/pages/SettingsPage.jsx');
  assert.match(settings, /\{ id: 'billing', label: 'Billing and orders' \},\n[^\n]*\n  \{ id: 'usage', label: 'Usage' \},/, 'Usage, after Billing and orders');
  // D700 — the deep-link map moved to account/accountPhone.js, unchanged.
  assert.match(read('frontend/src/pages/account/accountPhone.js'), /\n  usage: 'usage',/, '/account/usage opens the section');
  assert.match(settings, /\{safeActive === 'usage' && <UsageSection role=\{role\} \/>\}/);
  const app = read('frontend/src/App.jsx');
  const menu = app.slice(app.indexOf('function UserDropdown('), app.indexOf('Log Out', app.indexOf('function UserDropdown(')));
  assert.match(menu, /<Link to="\/account" [\s\S]*?Account\s*<\/Link>\s*\{\/\*[^*]*\*\/\}\s*<Link to="\/account\/usage"[\s\S]*?Usage\s*<\/Link>/, 'Usage, right under Account');
  assert.match(app, /<Route path="\/admin\/platform\/allowances" element=\{guard\(\['admin'\], hqOnly\(<HqPlatformAllowancesPage \/>\)\)\} \/>/);
  assert.match(app, /<StripLink to="\/admin\/platform\/allowances">AI allowances<\/StripLink>/);
  assert.match(read('frontend/src/pages/hq/PlatformPage.jsx'), /<Link\s+to="\/admin\/platform\/allowances"/);
  assert.match(read('frontend/src/ui/AiBudgetUsage.jsx'), /href="\/account\/usage"/);
});
