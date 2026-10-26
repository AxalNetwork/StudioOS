// D1277 (#2482) step 1 — Account › Usage › AI tokens from the reads that exist
// (`GET /api/ai-budget/me`, `GET /api/ai-budget/limit`):
//   · Card 1's "Available now" is the allowance left plus the token balance,
//     from one function over `/me`, with what is held named apart;
//   · the one stop that applies now, in the Worker's own words, first match in
//     the hold's order (pause, review, own limit, out of tokens), with Add
//     tokens only where tokens would help;
//   · Card 4's plan, own-limit and HQ-cap rows; a failed read is said, never
//     drawn as none;
//   · a support session reads and cannot buy (TOKB10);
//   · Cards 2 and 3 still wait for #3304, and nothing says "credits".
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ai_tokens_page.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AiTokensView } from '../src/pages/account/AiTokensPage.jsx';
import {
  NOT_YET, SUPPORT_NOTICE, UNREADABLE_BALANCE, WORKER_WORDS, availableView, canBuy, limitRows, stopState,
} from '../src/pages/account/aiTokensModel.js';
import { ADD_TOKENS_PATH } from '../src/lib/aiTokens.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const NOW = new Date('2026-10-26T12:00:00Z');

/** A Founder on a plan: $5.00 a month, $1.87 spent, $0.03 held, $3.40 of tokens. Invented figures. */
const ME = (over = {}) => ({
  licence: 'founder:build', daily_capped: false, daily_microusd: 5_000_000, monthly_microusd: 5_000_000,
  day_spend_microusd: 0, month_spend_microusd: 1_870_000, day_reserved_microusd: 0, month_reserved_microusd: 30_000,
  balance_microusd: 3_400_000, topup_reserved_microusd: 0, held_for_review: [], ai_paused: false, ...over,
});
const NO_PLAN = (over = {}) => ME({ licence: 'advisor', daily_microusd: 0, monthly_microusd: 0, month_spend_microusd: 0, month_reserved_microusd: 0, ...over });
const LIMIT = (over = {}) => ({ limit_microusd: 50_000_000, charged_microusd: 6_420_000, resets_on: '2026-11-01', notify: {}, ...over });
const ready = (data) => ({ status: 'ready', data, reload() {} });
const loading = { status: 'loading', data: null, reload() {} };
const failed = { status: 'unreadable', data: null, reload() {} };
const page = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(AiTokensView, { now: NOW, buy: true, ...props })));
const visible = (html) => html.replace(/data-testid="[^"]*"/g, '');

// ---------------------------------------------------------------- the model

test('"Available now" is the allowance left plus the balance, both net of holds; what is held is named apart', () => {
  const v = availableView(ME(), NOW);
  assert.deepEqual([v.available, v.left, v.balance, v.held, v.used, v.of, v.resets], ['$6.50', '$3.10', '$3.40', '$0.03', '$1.87', '$5.00', '1 Nov']);
  assert.equal(v.summary, 'Plan allowance left $3.10 + token balance $3.40. $0.03 is held by work in progress.');
  assert.equal(v.srSummary, '$6.50 available: $3.10 allowance and $3.40 tokens; $0.03 held.');
  assert.deepEqual(v.segments.map((s) => [s.id, s.value]), [['allowance', '$3.10'], ['balance', '$3.40'], ['held', '$0.03']]);
  const topped = availableView(ME({ topup_reserved_microusd: 20_000 }), NOW);
  assert.deepEqual([topped.available, topped.held], ['$6.50', '$0.05'], 'a held top-up is named, never subtracted twice');
  const over = availableView(ME({ month_spend_microusd: 5_000_000, month_reserved_microusd: 10_000 }), NOW);
  assert.equal(over.left, '$0.00', 'never a negative allowance');
});

test('no plan: tokens only, "Nothing is held right now"; review holds are said as such; a partial read is null, never a zero', () => {
  const v = availableView(NO_PLAN(), NOW);
  assert.deepEqual([v.noAllowance, v.left, v.available], [true, null, '$3.40']);
  assert.equal(v.summary, 'Token balance $3.40. Nothing is held right now.');
  assert.equal(v.srSummary, '$3.40 available: $3.40 tokens.');
  assert.deepEqual(v.segments.map((s) => s.id), ['balance']);
  const r = availableView(ME({ month_reserved_microusd: 400_000, held_for_review: [{ uid: 'r1', at: '2026-10-19', held_microusd: 400_000, recorded_cost_microusd: 0 }] }), NOW);
  assert.equal(r.review, true);
  assert.match(r.summary, /\$0\.40 is held for review\.$/);
  for (const bad of [null, {}, ME({ balance_microusd: undefined }), ME({ held_for_review: null }), ME({ month_spend_microusd: -1 })]) {
    assert.equal(availableView(bad, NOW), null);
  }
});

test('the stop that applies now, in the hold\'s order and the Worker\'s words; Add tokens only where tokens help', () => {
  const s = (me, limit) => stopState(me, limit, NOW);
  const paused = s(ME({ ai_paused: true, held_for_review: [{ held_microusd: 1 }] }), LIMIT({ charged_microusd: 60_000_000 }));
  assert.deepEqual([paused.id, paused.text, paused.sub, paused.addTokens], ['ai_paused', WORKER_WORDS.ai_paused, 'Adding tokens does not lift a pause.', false], 'the pause wins');
  const review = s(ME({ held_for_review: [{ held_microusd: 1 }] }), LIMIT({ charged_microusd: 60_000_000 }));
  assert.deepEqual([review.id, review.text, review.addTokens], ['budget_review', WORKER_WORDS.budget_review, false]);
  const lim = s(ME(), LIMIT({ charged_microusd: 50_000_000 }));
  assert.deepEqual([lim.id, lim.addTokens, lim.link], ['spend_limit', false, 'limits']);
  assert.equal(lim.text, 'You reached your own monthly limit of $50.00. New AI work waits until 1 Nov, or raise it in Limits.');
  const out = s(ME({ month_spend_microusd: 4_970_000, balance_microusd: 0 }), LIMIT());
  assert.deepEqual([out.id, out.addTokens], ['no_tokens', true]);
  assert.equal(out.text, 'You have no AI tokens left this month. Eadwyn, assistants and keys that run AI are paused until you add tokens or your allowance resets on 1 Nov.');
  const empty = s(NO_PLAN({ balance_microusd: 0 }), null);
  assert.deepEqual([empty.id, empty.text, empty.addTokens], ['empty', 'Add tokens to use Eadwyn and AI tools.', true]);
  assert.equal(s(ME(), LIMIT()), null, 'nothing stops spend');
  assert.equal(s(ME(), LIMIT({ limit_microusd: null })), null, 'no own limit set');
  assert.equal(s(ME(), null), null, 'an unread limit is not a reached one');
});

test('the Worker\'s own words are the Worker\'s: the pause, the review and not enough', () => {
  const router = read('cloudflare-worker/src/services/aiRouter.ts');
  const budget = read('cloudflare-worker/src/services/aiBudget.ts');
  assert.ok(budget.includes(`AI_PAUSED_MESSAGE = '${WORKER_WORDS.ai_paused}'`));
  assert.ok(router.includes(`'${WORKER_WORDS.budget_review}'`));
  assert.ok(router.includes(`'${WORKER_WORDS.not_enough}'`));
  assert.ok(read('cloudflare-worker/src/routes/ai_budget.ts').includes('ai_paused: await aiPaused(c.env,user.id)'), '/me names the pause');
});

test('Card 4: the plan, the member\'s own limit and HQ\'s cap; a failed read is said, never no limit', () => {
  const r = limitRows(ME({ member_cap_microusd: 30_000_000 }), LIMIT());
  assert.deepEqual(r.plan, { state: 'ok', perMonth: '$5.00', from: 'Founder · Build' });
  assert.deepEqual(r.own, { state: 'ok', spent: '$6.42', limit: '$50.00', pct: 13 });
  assert.equal(r.hq, '$30.00 a month, set by StudioOS');
  assert.equal(limitRows(ME(), LIMIT()).hq, null, 'no cap set by StudioOS: the row is left out');
  assert.deepEqual(limitRows(NO_PLAN(), LIMIT()).plan, { state: 'none', text: 'No plan allowance. Your AI runs use AI tokens.' });
  assert.deepEqual(limitRows(null, null).plan, { state: 'unreadable' });
  assert.deepEqual(limitRows(ME(), null).own, { state: 'unreadable' });
  assert.deepEqual(limitRows(ME(), undefined).own, { state: 'loading' });
  assert.deepEqual(limitRows(ME(), LIMIT({ limit_microusd: null })).own, { state: 'none' });
});

test('a support session cannot buy, an HQ one or a View As', () => {
  assert.equal(canBuy({ hqSupport: false, impersonating: false }), true);
  assert.equal(canBuy({ hqSupport: true, impersonating: false }), false);
  assert.equal(canBuy({ hqSupport: false, impersonating: true }), false);
});

// ---------------------------------------------------------------- rendered

test('TOKB1: the figure, its line, the rows and Card 4; Cards 2 and 3 still wait; Card 5 says what happens', () => {
  const out = page({ me: ready(ME({ member_cap_microusd: 30_000_000 })), limit: ready(LIMIT()) });
  for (const t of ['$6.50', 'Plan allowance left $3.10 + token balance $3.40. $0.03 is held by work in progress.', 'never expires',
    'returns within 5 minutes if unused', 'From your Founder · Build plan', '$30.00 a month, set by StudioOS',
    'Runs use your plan’s AI allowance first, then your AI tokens.', 'Eadwyn stops before it starts and offers Add tokens. Nothing is charged.']) {
    assert.ok(out.includes(t), t);
  }
  assert.ok(out.includes('aria-label="$6.50 available: $3.10 allowance and $3.40 tokens; $0.03 held."'));
  assert.equal((out.match(new RegExp(NOT_YET, 'g')) || []).length, 2, 'only Cards 2 and 3 wait');
  assert.ok(out.includes('data-testid="ai-tokens-wait-holds"') && out.includes('data-testid="ai-tokens-wait-prices"'));
  assert.ok(out.includes('Per API key: being built.'), 'the key rows wait for step 2, never sample rows');
  assert.ok(out.includes(`href="${ADD_TOKENS_PATH}"`) && out.includes('data-testid="ai-tokens-add"'));
  assert.ok(!out.includes('ai-tokens-stop-'), 'nothing stops spend');
  assert.ok(!/credits?\b/i.test(visible(out)), 'one currency: AI tokens');
});

test('TOKB3 and TOKB4 on the page: Add tokens beside the stop only when out of tokens', () => {
  const paused = page({ me: ready(ME({ ai_paused: true })), limit: ready(LIMIT()) });
  assert.ok(paused.includes('data-testid="ai-tokens-stop-ai_paused"') && paused.includes('Adding tokens does not lift a pause.'));
  assert.ok(!paused.includes('ai-tokens-stop-add'));
  const lim = page({ me: ready(ME()), limit: ready(LIMIT({ charged_microusd: 50_000_000 })) });
  assert.ok(lim.includes('data-testid="ai-tokens-stop-spend_limit"') && !lim.includes('ai-tokens-stop-add'));
  const out = page({ me: ready(ME({ month_spend_microusd: 4_970_000, balance_microusd: 0 })), limit: ready(LIMIT()) });
  assert.ok(out.includes('data-testid="ai-tokens-stop-no_tokens"') && out.includes('data-testid="ai-tokens-stop-add"'));
  const empty = page({ me: ready(NO_PLAN({ balance_microusd: 0 })), limit: ready(LIMIT({ limit_microusd: null })) });
  assert.ok(empty.includes('Add tokens to use Eadwyn and AI tools.') && empty.includes('No plan allowance. Your AI runs use AI tokens.'));
  assert.ok(!empty.includes('Runs use your plan’s AI allowance first'), 'no allowance, so no allowance-first rule');
});

test('TOKB10: a support session reads the page and is offered no Add tokens anywhere', () => {
  const out = page({ me: ready(ME({ month_spend_microusd: 4_970_000, balance_microusd: 0 })), limit: ready(LIMIT()), buy: false, who: 'Mia Member' });
  assert.ok(out.includes(SUPPORT_NOTICE('Mia Member')));
  assert.equal(SUPPORT_NOTICE('Mia Member'), 'You are viewing as Mia Member. Adding tokens is not possible in a support session.');
  assert.ok(!out.includes(`href="${ADD_TOKENS_PATH}"`), 'no Add tokens, not even beside the out-of-tokens stop');
  assert.ok(out.includes('data-testid="ai-tokens-stop-no_tokens"'), 'the stop is still said');
});

test('TOKB8 and TOKB9: loading draws no figure; a failed read is said with Try again and never blanks the page', () => {
  const l = page({ me: loading, limit: loading });
  assert.ok(l.includes('Reading…'));
  assert.ok(!/\$0\.00/.test(l), 'never a zero while reading');
  const f = page({ me: failed, limit: failed });
  assert.ok(f.includes(UNREADABLE_BALANCE) && f.includes('data-testid="ai-tokens-available-unreadable-retry"'));
  assert.ok(f.includes('Your plan’s allowance could not be read.') && f.includes('Your monthly limit could not be read. That is not the same as no limit.'));
  assert.ok(f.includes('data-testid="ai-tokens-run-out-eadwyn"'), 'Card 5 still renders');
  assert.ok(!/\$0\.00/.test(f), 'a failed read is never a zero');
  const half = page({ me: ready(ME()), limit: failed });
  assert.ok(half.includes('$6.50') && half.includes('That is not the same as no limit.'), 'one failed block never blanks the page');
});

test('the wiring: the page reads /me and /limit and decides buying from both support signals', () => {
  const src = read('frontend/src/pages/account/AiTokensPage.jsx');
  assert.ok(src.includes('useAccountRead(() => aiBudgetApi.mine())') && src.includes('useAccountRead(() => aiBudgetApi.spendLimit())'));
  assert.ok(src.includes('hqSupport: !!activeSupportSession()') && src.includes('impersonating: !!view?.isImpersonating'));
});
