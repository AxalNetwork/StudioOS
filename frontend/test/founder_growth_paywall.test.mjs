/**
 * The founder Growth nav group (Talent, Customers, Partnerships, Capital,
 * Experts) is UI shell only — mock data from src/data/growth.js — and used to
 * be shown, fully interactive, to every founder account regardless of plan.
 * It also collided on-label with a REAL nav item: two sidebar entries both
 * read "Capital", one live (/raise/capital), one sample data.
 *
 * The fix is two matching gates, because a sidebar lock alone only protects
 * the nav — a founder with the URL already in hand would still land on the
 * live mock page:
 *   1. sidebarConfig.js marks the five founder Growth items `requiredTier:
 *      'growth'`, the exact mechanism `/liquidity` already uses (lock icon +
 *      PaywallModal intercept, wired once in App.jsx for every tier-gated
 *      item).
 *   2. GrowthWorkspace.jsx gates the PAGE itself with the same `hasTier`
 *      check and the same LockedPreview component Fund Ops already uses for
 *      this exact shape of problem.
 *
 * Both must use the SAME `hasTier`, not independently-reasoned checks — a tab
 * unlocked in the nav but locked on the page (or the reverse) is a worse UX
 * than either gate alone, and is exactly the kind of drift that's invisible
 * until a specific founder's tier hits the boundary.
 *
 * What this does NOT claim to fix: `hasTier` bypasses Spin-Out Lab-active
 * founders up to Growth tier (a pre-existing rule for REQUIRED lab tooling
 * like the deck builder), so an active Lab founder still sees Growth's tabs
 * unlocked — hence the sidebar rename below being load-bearing on its own,
 * not just a nicety.
 *
 * Run with:  node --test frontend/test/founder_growth_paywall.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SIDEBAR = read('../src/sidebarConfig.js');
const WORKSPACE = read('../src/pages/growth/GrowthWorkspace.jsx');

/** The founder role's block only — sidebarConfig.js repeats the same "growth"
 *  key for founder/partner/advisor, and this must never accidentally assert
 *  against one of the other two. */
const founderBlock = (() => {
  const start = SIDEBAR.indexOf('\n  founder: [');
  const end = SIDEBAR.indexOf('\n  partner: [');
  assert.ok(start !== -1 && end !== -1 && start < end, 'founder block boundaries moved — update this test');
  return SIDEBAR.slice(start, end);
})();

const founderGrowthGroup = (() => {
  const start = founderBlock.indexOf("{ key: 'growth'");
  assert.notEqual(start, -1, 'founder Growth group not found');
  const end = founderBlock.indexOf(']},', start) + 3;
  return founderBlock.slice(start, end);
})();

// --- the sidebar gate --------------------------------------------------

test('all five founder Growth nav items require Growth tier', () => {
  const items = [...founderGrowthGroup.matchAll(/\{ to: '(\/founder\/growth\/\w+)'[^}]*\}/g)];
  assert.equal(items.length, 5, `expected 5 Growth items, found ${items.length}`);
  for (const [full, to] of items) {
    assert.match(full, /requiredTier: 'growth'/, `${to} must be tier-gated`);
  }
});

test('this is scoped to the founder block, not partner/advisor', () => {
  // partner/advisor Growth pages are a different question (different
  // monetization model, if any) and are deliberately untouched here.
  const partnerGrowth = SIDEBAR.slice(SIDEBAR.indexOf("\n  partner: ["), SIDEBAR.indexOf("\n  investor: ["));
  const partnerGrowthGroup = partnerGrowth.slice(
    partnerGrowth.indexOf("{ key: 'growth'"),
    partnerGrowth.indexOf(']},', partnerGrowth.indexOf("{ key: 'growth'")) + 3,
  );
  assert.doesNotMatch(partnerGrowthGroup, /requiredTier/, 'partner Growth was not part of this fix — must stay untouched');
});

test('the "Capital" label collision is resolved independent of lock state', () => {
  // Renamed rather than only locked, because hasTier's Lab-active bypass
  // means the lock alone does not protect every founder — the label itself
  // must never read identically to /raise/capital's, locked or not.
  assert.doesNotMatch(founderGrowthGroup, /label: 'Capital'(?!\s*Match)/);
  assert.match(founderGrowthGroup, /label: 'Capital Match'/);
});

test('the other four Growth labels are untouched — only the collision was renamed', () => {
  for (const label of ['Talent', 'Customers', 'Partnerships', 'Experts']) {
    assert.match(founderGrowthGroup, new RegExp(`label: '${label}'`));
  }
});

// --- the page-level gate ------------------------------------------------

test('GrowthWorkspace gates on the SAME hasTier the sidebar uses', () => {
  const src = code(WORKSPACE);
  assert.match(src, /import \{ hasTier \} from '\.\.\/\.\.\/sidebarConfig'/,
    'must import the real predicate, not reimplement tier logic locally');
  assert.match(src, /hasTier\(user, 'growth'\)/);
});

test('a locked tab renders LockedPreview, not the raw mock page, unwrapped', () => {
  const src = code(WORKSPACE);
  assert.match(src, /import LockedPreview from '\.\.\/\.\.\/components\/LockedPreview'/);
  assert.match(src, /locked \? \(/, 'must branch on the lock, not render unconditionally');
  assert.match(src, /<LockedPreview/);
  assert.match(src, /tier="growth"/, 'must pass a tier so LockedPreview shows the Unlock CTA, not a bare role lock');
});

test('every one of the five tabs has distinct, honest lock copy', () => {
  const src = code(WORKSPACE);
  const messages = [...src.matchAll(/lockMessage: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(messages.length, 5, `expected 5 lock messages, found ${messages.length}`);
  assert.equal(new Set(messages).size, 5, 'lock messages must not be copy-pasted identical across tabs');
  for (const m of messages) {
    // "part of the Growth plan" is honest — it does not claim the matching
    // itself is live, which it is not (still mock data behind the lock).
    assert.match(m, /Growth plan/);
  }
});

test('unlocking does not silently swap in a different, unmocked page', () => {
  // The known remaining gap (mock data persists even once unlocked) must stay
  // visible, not be hidden by quietly rendering something else instead.
  const src = code(WORKSPACE);
  assert.match(src, /<ActivePage \/>/g);
  const occurrences = (src.match(/<ActivePage \/>/g) || []).length;
  assert.equal(occurrences, 2, 'both the locked (blurred) and unlocked branch must render the SAME page component');
});
