import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const scope = read('cloudflare-worker/src/routes/_investorProjectScope.ts');
const positions = read('cloudflare-worker/src/routes/positions.ts');
const health = read('cloudflare-worker/src/routes/portfolio.ts');
const updates = read('cloudflare-worker/src/routes/portfolio_updates.ts');

test('investor portfolio scope is based on explicit relationships', () => {
  assert.match(scope, /investor_dealroom_members/);
  assert.match(scope, /investor_introductions/);
  assert.match(scope, /watchlist_items/);
  assert.match(scope, /investor_seat_primary_user_id/);
});

test('every investor portfolio read applies the shared project scope', () => {
  // The call shape gained a third argument in company scoping stage 5, so the
  // patterns below name it. Asserting the company is PASSED is stricter than
  // the old literal `investorProjectIds(c.env, user)`: a call that dropped the
  // argument would still have matched that, silently reverting the scoping to
  // portfolio-wide while this test stayed green.
  assert.match(positions, /investorProjectIds\(c\.env, user, await investorActiveCompany\(c, user\)\)/);
  assert.match(positions, /projectIds != null && !projectIds\.includes/);
  assert.match(health, /isInvestor\(user\)\) return investorProjectIds\(env, user, await investorActiveCompany\(c, user\)\)/);
  assert.match(health, /visible != null && !visible\.includes\(Number\(project\.id\)\)/);
  assert.match(updates, /const visible = await investorProjectIds\(c\.env, user, await investorActiveCompany\(c, user\)\)/);
  assert.match(updates, /!visible\?\.includes\(Number\(u\.project_id\)\)/);
});

test('the founder branch of portfolio health is narrowed too', () => {
  // portfolio.ts inlines its own founder-ownership query. Left unnarrowed it
  // would list projects the picker, Validate and Raise had all stopped showing
  // — an overview contradicting every view beneath it. It must use the same
  // predicate the five loaders use, not a second hand-rolled comparison.
  assert.match(health, /projectInActiveCompany\(companyId, r\)/);
  assert.match(health, /SELECT id, company_id FROM projects WHERE founder_id = \?/);
});