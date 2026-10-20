/**
 * D783 (#2124) — the words for a plan's AI allowance, from stubbed reads:
 * the plan cards on /plans-and-pricing, the no-plan line, the rail's Usage
 * box, the usage card and /account/usage's model. A member has no daily
 * limit (`daily_capped: false`), so no Today row is drawn for one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NO_PLAN_LINE, dayCapped, noPlan, planAllowanceLine } from '../src/lib/planAllowance.js';
import { planAi } from '../src/lib/plansPricing.js';
import { RailUsage } from '../src/ui/WorkerRail.jsx';
import { AiBudgetUsage } from '../src/ui/AiBudgetUsage.jsx';
import { allowanceView } from '../src/pages/account/usageModel.js';

const MEMBER = {
  licence: 'founder:growth', daily_capped: false, daily_microusd: 19_750_000, monthly_microusd: 19_750_000,
  day_spend_microusd: 2_000_000, month_spend_microusd: 2_000_000, balance_microusd: 0,
  day_reserved_microusd: 0, month_reserved_microusd: 0, topup_reserved_microusd: 0, held_for_review: [],
};
const NO_PLAN = { ...MEMBER, licence: 'founder:free', daily_microusd: 0, monthly_microusd: 0, day_spend_microusd: 0, month_spend_microusd: 0 };
const ADMIN = { ...MEMBER, licence: 'admin', daily_capped: true, daily_microusd: 5_000_000, monthly_microusd: 50_000_000 };
const reading = (budget) => ({ budget, loading: false, budgetError: false, reload: () => {}, product: null, productError: false });
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

test('a plan card says what its plan includes each month; a free plan says no plan', () => {
  // Mutation checked: drop the share from the line → "of AI each month: of the price".
  assert.equal(planAllowanceLine({ share: 0.25, monthly_microusd: 19_750_000 }),
    'Includes $19.75 of AI each month: 25% of the price. Past it, runs use your tokens.');
  assert.equal(planAllowanceLine({ share: 0.25, monthly_microusd: 0 }), NO_PLAN_LINE);
  assert.equal(NO_PLAN_LINE, 'No plan: every run uses your tokens.');
  assert.equal(planAllowanceLine({ share: 0.25, monthly_microusd: -1 }), null, 'never "$0.00" for an unreadable figure');
  assert.equal(planAllowanceLine(null), null);
  const read = { status: 'ready', data: { plans: [], covers: 'Covers.', resets: 'Resets.' } };
  const growth = planAi({ family: 'founder', licence_key: 'founder:growth', allowance: { share: 0.25, monthly_microusd: 19_750_000 } }, read);
  assert.equal(growth.allowance, 'Includes $19.75 of AI each month: 25% of the price. Past it, runs use your tokens.');
  const mi = planAi({ family: 'market_intelligence', licence_key: null, allowance: { share: 0.25, monthly_microusd: 7_250_000 } }, read);
  assert.equal(mi.allowance, 'Includes $7.25 of AI each month: 25% of the price. Past it, runs use your tokens.', 'Market Intelligence Pro gives its share too');
  const free = planAi({ family: 'founder', licence_key: 'founder:free', free: true, allowance: { share: 0.25, monthly_microusd: 0 } }, read);
  assert.equal(free.allowance, NO_PLAN_LINE);
});

test('the rail shows this month only for a member, the no-plan line with no plan, and the admin keeps Today', () => {
  // Mutation checked: draw Today whatever daily_capped says → "Today" in the member's box.
  const member = text(renderToStaticMarkup(h(RailUsage, { reading: reading(MEMBER) })));
  assert.ok(!member.includes('Today'), 'no daily limit, no Today row');
  assert.match(member, /This month \$2\.00 of \$19\.75/);
  const none = renderToStaticMarkup(h(RailUsage, { reading: reading(NO_PLAN) }));
  assert.match(none, /data-testid="text-worker-rail-no-plan">No plan: every run uses your tokens\.</);
  assert.ok(!text(none).includes('This month'), 'nothing included, so no month row');
  assert.match(none, /Add tokens/);
  assert.match(text(renderToStaticMarkup(h(RailUsage, { reading: reading(ADMIN) }))), /Today/);
});

test('the usage card and /account/usage drop Today for a member, and say no plan', () => {
  // Mutation checked: noPlan true for any $0 month → an admin with a $0 month reads "No plan".
  const card = text(renderToStaticMarkup(h(AiBudgetUsage, { reading: reading(MEMBER) })));
  assert.ok(!card.includes('Today'));
  assert.match(card, /This month · \$2\.00 of \$19\.75/);
  assert.match(renderToStaticMarkup(h(AiBudgetUsage, { reading: reading(NO_PLAN) })), /data-testid="ai-budget-no-plan">No plan: every run uses your tokens\.</);
  const v = allowanceView(MEMBER);
  assert.deepEqual([v.today, v.dayCapped, v.noPlan, v.month.of], [null, false, false, '$19.75']);
  const n = allowanceView(NO_PLAN);
  assert.deepEqual([n.noAllowance, n.noPlan, n.states], [true, true, ['no_allowance']]);
  assert.deepEqual([dayCapped(ADMIN), noPlan({ ...ADMIN, monthly_microusd: 0 })], [true, false]);
  assert.equal(dayCapped({ ...ADMIN, daily_capped: undefined }), true, 'a read from before D783 keeps its day');
});
