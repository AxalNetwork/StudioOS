import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCost, batchCost, spendMeter, formatCost } from '../src/ui/assistCost.js';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// --- The arithmetic ------------------------------------------------------
// Six of the eight rail canvases carry a comment insisting the pre-run estimate
// and the post-run receipt come from ONE calculation. Two functions drifting is
// how a user gets quoted one price and charged another, so this is the guard.

test('run cost matches the canvases own numbers', () => {
  // AIRail's first page profile, lifted from the canvas.
  const cost = runCost({ tin: 21400, tout: 1180, pin: 0.293, pout: 2.253 });
  assert.equal(formatCost(cost), '$0.0089');
  // Prices are per 1M tokens — doubling tokens must double cost, not scale oddly.
  const dbl = runCost({ tin: 42800, tout: 2360, pin: 0.293, pout: 2.253 });
  assert.ok(Math.abs(dbl - cost * 2) < 1e-12);
});

test('cached input discounts the input side only — output is never cached', () => {
  const p = { tin: 1_000_000, tout: 1_000_000, pin: 10, pout: 20, cachedIn: 1 };
  assert.equal(runCost(p), 30);                       // 10 + 20
  assert.equal(runCost(p, { cached: true }), 21);     // 1 + 20, NOT 3
});

test('a batch with no ops costs exactly one run', () => {
  const p = { tin: 5900, tout: 680, pin: 0.045, pout: 0.384 };
  assert.equal(batchCost(p, []), runCost(p));
  // costFactor weights a cheaper assist without inventing a second profile.
  assert.ok(Math.abs(batchCost(p, [{ op: 'a' }, { op: 'b', costFactor: 0.5 }]) - runCost(p) * 1.5) < 1e-12);
});

test('the spend meter clamps its bar but tells the truth about being over', () => {
  const under = spendMeter(12.5, 40);
  assert.equal(under.fraction, 0.3125);
  assert.equal(under.over, false);
  const over = spendMeter(48, 40);
  assert.equal(over.fraction, 1, 'the bar must never render past its track');
  assert.equal(over.over, true, 'but the caller must still know it is over cap');
  assert.ok(over.ratio > 1);
  // No cap configured must not divide by zero.
  assert.equal(spendMeter(5, 0).fraction, 0);
});

// --- The components ------------------------------------------------------

test('AssistRail is the AI rail, not navigation', () => {
  const src = read('frontend/src/ui/AssistRail.jsx');
  // The whole point of DECISIONS.md T3: these canvases have zero route links.
  assert.doesNotMatch(src, /<NavLink|<Link\b|react-router/,
    'AssistRail must not grow navigation — that is SidebarNav');
  // ForgeRail's boundary is the product rule, so the slot must exist.
  assert.match(src, /guardrail/);
  for (const kind of ['choice', 'fixed', 'inherited']) {
    assert.match(src, new RegExp(`'${kind}'`), `mode.kind '${kind}' must be handled`);
  }
});

test('SidebarNav was lifted out of App.jsx, not duplicated', () => {
  const app = read('frontend/src/App.jsx');
  const nav = read('frontend/src/ui/SidebarNav.jsx');
  assert.doesNotMatch(app, /^function SidebarNav\(/m, 'App.jsx must no longer define it');
  assert.match(app, /import SidebarNav from '\.\/ui\/SidebarNav'/);
  assert.match(app, /<SidebarNav\b/, 'ProtectedLayout must still render it');
  assert.match(nav, /^export default function SidebarNav\(/m);
  // The behaviours the census said this implementation wins on — if a later
  // "cleanup" drops one, the canvas rail is no longer the weaker option.
  assert.match(nav, /collapsed/, 'collapsed mode');
  assert.match(nav, /aria-label="Search sidebar"/, 'the sidebar search filter');
  assert.match(nav, /PaywallModal/, 'tier locks');
});

test('the barrel exports both', () => {
  const barrel = read('frontend/src/ui/index.js');
  for (const name of ['AssistRail', 'SidebarNav', 'runCost', 'spendMeter']) {
    assert.match(barrel, new RegExp(`\\b${name}\\b`), `ui/index.js must export ${name}`);
  }
});
