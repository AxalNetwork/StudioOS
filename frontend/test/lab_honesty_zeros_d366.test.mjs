/**
 * D366 — the screens that read the four Worker values D366 stops zeroing.
 *
 * The Worker now answers null (with a reason) for a view count it does not
 * hold, an entitlement a round with no target cannot have, and a post-round
 * stake it cannot compute. These screens used to print that null as "0", a
 * bare value or "—". Render paths load in effects, so they are pinned as
 * source text, bounded to their blocks. The Worker behaviour itself is driven
 * for real in cloudflare-worker/test/lab_honesty_zeros_d366.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

function between(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `anchor not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `end anchor not found after ${start}: ${end}`);
  return src.slice(a, b);
}

test('Lab Brand: a page with no stored view count says so, never "0 views"', () => {
  const card = between(read('frontend/src/pages/SpinoutLabBrandPage.jsx'), 'data-testid={`page-card-${p.id}`}', 'subs{p.updated_at');
  assert.match(card, /p\.views_count == null\s*\?\s*<span data-testid=\{`page-views-unrecorded-\$\{p\.id\}`\}[^>]*>Views not recorded/);
  assert.doesNotMatch(card, /views_count\s*(\|\||\?\?)\s*0/);
});

test('Brand Builder: a landing with no stored count says "Pageviews not recorded"', () => {
  const line = between(read('frontend/src/pages/BrandBuilderPage.jsx'), '<div className="text-xs text-gray-500 mt-2 dark:text-gray-400">', 'signup');
  assert.match(line, /landing\.views_count == null \? 'Pageviews not recorded'/);
  assert.doesNotMatch(line, /views_count\s*(\|\||\?\?)\s*0/);
});

test('Lab Capital: a null entitlement reads "Not recorded" with the Worker\'s reason', () => {
  const table = between(read('frontend/src/pages/SpinoutLabCapitalPage.jsx'), 'data-testid="pro-rata-table"', '</table>');
  const cell = between(table, 'h.entitlement == null', "h.scaled ? ' (scaled)'");
  assert.match(cell, /data-testid="pro-rata-entitlement-unrecorded">Not recorded/);
  assert.match(cell, /\{h\.entitlement_not_recorded \|\|/, 'the reason is the Worker\'s, shown on the page');
  assert.doesNotMatch(cell, /\? '—'/, 'never a bare dash');
});

test('Raise pro-rata panel: null entitlement and post-round stake read "Not recorded" with reasons', () => {
  const rows = between(read('frontend/src/pages/raise/RoundClosesPanel.jsx'), '{holders.map(h => (', '</tbody>');
  const ent = between(rows, 'h.entitlement == null', 'h.scaled &&');
  assert.match(ent, /Not recorded\{h\.entitlement_not_recorded && /);
  assert.doesNotMatch(ent, /\? '—'/);
  const post = between(rows, 'h.post_round_stake_pct == null', '</td>');
  assert.match(post, /Not recorded\{h\.post_round_stake_not_recorded && /);
  assert.doesNotMatch(post, /\? '—'/);
});

test('Cap Table: the equity-plan refusal D366 adds reaches the Unreadable state, not the empty one', () => {
  // The Worker now answers 500 where it used to answer an empty plan. The
  // page already treats any non-404 failure as `failed`; pin that so the new
  // refusal cannot fall through to "Unrecorded".
  const page = read('frontend/src/pages/SpinoutLabCapTablePage.jsx');
  const card = read('frontend/src/components/spinout/EquityPlanCard.jsx');
  assert.match(page, /<EquityPlanCard plan=\{equityPlan\.plan\} failed=\{equityPlan\.failed\}/);
  const failedBranch = between(card, 'if (failed)', 'if (!plan)');
  assert.match(failedBranch, /<Unreadable what=/);
  assert.doesNotMatch(failedBranch, /Unrecorded/);
  // Only a 404 (the dev FastAPI has no such route) hides the card; anything
  // else, the new 500 included, is `failed`.
  const apply = between(page, 'function applyEquityPlan(res)', '}\n  const reloadEquityPlan');
  assert.match(apply, /res\.reason\?\.status === 404\) \{ setEquityPlan\(\{ plan: null, failed: false \}\); return; \}/);
  assert.match(apply, /setEquityPlan\(\{ plan: null, failed: true \}\);\s*$/);
});
