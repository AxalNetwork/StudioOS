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
  // D1057: positions read the HELD scope, the relationship scope narrowed to confirmed commitments.
  assert.match(positions, /investorHeldProjectIds\(c\.env, user, await investorActiveCompany\(c, user\)\)/);
  assert.doesNotMatch(positions, /[^d]investorProjectIds\(/, 'no positions read falls back to the relationship scope alone');
  assert.match(scope, /const related = await investorProjectIds\(env, user, companyId\);[\s\S]*t\.status = 'confirmed'/);
  assert.match(positions, /projectIds != null && !projectIds\.includes/);
  assert.match(health, /isInvestor\(user\)\) return investorProjectIds\(env, user, await investorActiveCompany\(c, user\)\)/);
  assert.match(health, /visible != null && !visible\.includes\(Number\(project\.id\)\)/);
  // D889 (#2438): the investor's scope now sits in `readerProjectIds`, which the inbox and the detail both read.
  assert.match(updates, /if \(isInvestor\(user\)\) return \(await investorProjectIds\(c\.env, user, await investorActiveCompany\(c, user\)\)\) \|\| \[\]/);
  assert.match(updates, /!\(await readerProjectIds\(c, user\)\)\.includes\(Number\(u\.project_id\)\)/);
  assert.match(updates, /const ids = await readerProjectIds\(c, user\);/);
});

test('the founder branch of portfolio health is narrowed too', () => {
  // portfolio.ts inlines its own founder-ownership query. Left unnarrowed it
  // would list projects the picker, Validate and Raise had all stopped showing
  // — an overview contradicting every view beneath it. It must use the same
  // predicate the five loaders use, not a second hand-rolled comparison.
  assert.match(health, /projectInActiveCompany\(companyId, r\)/);
  assert.match(health, /SELECT id, company_id FROM projects WHERE founder_id = \?/);
});