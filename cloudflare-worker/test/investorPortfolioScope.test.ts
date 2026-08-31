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
  assert.match(positions, /investorProjectIds\(c\.env, user\)/);
  assert.match(positions, /projectIds != null && !projectIds\.includes/);
  assert.match(health, /isInvestor\(user\)\) return investorProjectIds\(env, user\)/);
  assert.match(health, /visible != null && !visible\.includes\(Number\(project\.id\)\)/);
  assert.match(updates, /const visible = await investorProjectIds\(c\.env, user\)/);
  assert.match(updates, /!visible\?\.includes\(Number\(u\.project_id\)\)/);
});