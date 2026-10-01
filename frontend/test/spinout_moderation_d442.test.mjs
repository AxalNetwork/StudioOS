/**
 * D442 — the moderation console is a page, and the board's door is literal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/admin/SpinoutModerationPage.jsx');
const APP = raw('frontend/src/App.jsx');
const API = raw('frontend/src/lib/api.js');
const ROUTE = raw('cloudflare-worker/src/routes/spinout_moderation.ts');
const BOARD = raw('frontend/src/pages/branch/BranchApprovals.jsx');
const HELD = raw('frontend/src/pages/admin/HeldApprovals.jsx');

test('the list method, the route, and the page agree', () => {
  assert.match(API, /adminSpinoutModerationOpen:\s*\(\)\s*=>\s*request\('\/admin\/spinout-moderation'\)/);
  assert.match(APP, /path="\/admin\/spinout-moderation"/);
  assert.match(APP, /<SpinoutModerationPage \/>/);
  assert.match(ROUTE, /app\.get\('\/'/);
  assert.match(ROUTE, /MODERATION_AWAITING_SQL/);
  assert.match(raw('cloudflare-worker/src/services/moderationOpen.ts'), /status = 'under_review' AND resolved_at IS NULL/);
  assert.match(raw('cloudflare-worker/src/services/approvalSources.ts'), /MODERATION_AWAITING_SQL/);
  const effect = PAGE.slice(PAGE.indexOf('useEffect(() => { load(); }'), PAGE.indexOf('const openMember'));
  assert.match(effect, /load\(\)/);
  assert.doesNotMatch(effect, /adminSpinoutModerate/);
  assert.match(PAGE, /api\.adminSpinoutModerationOpen\(\)/);
  assert.match(PAGE, /api\.adminSpinoutModerate\(picked/);
  assert.match(PAGE, /if \(busy \|\| !picked \|\| !action\) return/);
});

test('a failed read is unreadable and an empty read says the list was read', () => {
  assert.match(PAGE, /data-testid="spinout-moderation-unreadable"/);
  assert.match(PAGE, /what="Open moderation cases"/);
  assert.match(PAGE, /This is not a claim that no cases are open/);
  assert.match(PAGE, /data-testid="spinout-moderation-empty"/);
  assert.match(PAGE, /The list was read and holds nothing/);
  assert.match(PAGE, /typeof list\?\.open_count === 'number'/);
  assert.doesNotMatch(PAGE, /\|\| 0|\?\? 0/);
});

test('the board door is literal, and the HQ-held row is still Session 5', () => {
  assert.match(BOARD, /to="\/admin\/spinout-moderation"/);
  assert.match(BOARD, /moderation: \{ to: '\/admin\/spinout-moderation'/);
  assert.match(HELD, /No console exists anywhere yet/);
  assert.doesNotMatch(HELD, /to="\/admin\/spinout-moderation"/);
});

test('the page offers every reason the route accepts', () => {
  const block = ROUTE.slice(ROUTE.indexOf('const REASONS'), ROUTE.indexOf('const SEVERITIES'));
  const reasons = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(reasons.length >= 8, `expected the route's reason set, found ${reasons.join(', ')}`);
  for (const reason of reasons) {
    assert.ok(PAGE.includes(`'${reason}'`), `${reason} is not on the page`);
  }
});
