/**
 * Route-namespace policy (documentation/architecture/DECISIONS.md D4, resolved).
 *
 * Two things are pinned here, and both exist because the written record was
 * wrong about them once already.
 *
 * 1. **Persona roots stay prohibited.** `/founder`, `/investor`, `/advisor`
 *    and `/partner` are not mounted as roots. The original justification —
 *    that `/founder` was occupied by a live Founder Portal — evaporated when
 *    that portal was deleted, and the rule nearly went with it. The rule
 *    survives on its own merits (see D4), so it is enforced by a test rather
 *    than by whoever remembers the reasoning.
 *
 * 2. **React Router ranks by specificity, not registration order.**
 *    documentation/architecture/ROUTE_MAP.md recorded that `/deals/:dealId` "swallows" the four stage
 *    tabs the canvases propose, and it does not: a static segment outranks a
 *    dynamic one wherever each is registered. That false claim would have
 *    bought a route redesign nobody needed. Registration order DOES decide in
 *    Hono — which is why the worker's pass-analytics routes had to sit above
 *    `/api/deals/:id` — and conflating the two frameworks is the mistake this
 *    pins shut.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchRoutes } from 'react-router-dom';

const src = readFileSync(resolve(process.cwd(), 'frontend/src/App.jsx'), 'utf8');

/** Every route path, in registration order. */
const ROUTES = [...src.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

// ---------- D4: the prohibition ----------

const PERSONA_ROOTS = ['founder', 'investor', 'advisor', 'partner'];

test('no persona is mounted as a bare route root', () => {
  // D4: CompanySwitcher already scopes everything beneath it, an account can
  // hold more than one role, and /advisor/* is a migration rather than free
  // real estate. Persona belongs in the sidebar, not the URL.
  for (const p of PERSONA_ROOTS) {
    assert.equal(ROUTES.includes(`/${p}`), false,
      `/${p} is a persona root — D4 prohibits it; express persona in the sidebar`);
    assert.equal(ROUTES.includes(`/${p}/*`), false, `/${p}/* is a persona root`);
  }
});

test('the prohibition is recorded as resolved, not merely observed', () => {
  // The rule outlived its stated justification once. If someone reopens D4,
  // this test should be the thing that makes them come back and edit it.
  const decisions = readFileSync(resolve(process.cwd(), 'documentation/architecture/DECISIONS.md'), 'utf8');
  assert.match(decisions, /### D4\. Persona-root URLs — the prohibition stands/);
  assert.match(decisions, /\*\*RESOLVED — keep the prohibition\.\*\*/);
});

test('D4 does not claim /founder is unclaimed — the namespace is still in use', () => {
  // The bare root is free; the namespace is not. Recording it the other way
  // is what made the decision look cheaper than it is.
  const under = ROUTES.filter((p) => p.startsWith('/founder/'));
  assert.ok(under.length > 0,
    'if /founder/* ever empties, D4 needs re-reading — not silently re-deciding');
  const decisions = readFileSync(resolve(process.cwd(), 'documentation/architecture/DECISIONS.md'), 'utf8');
  assert.match(decisions, /`\/founder` is not unclaimed/);
});

// ---------- the router fact ----------

test('a static segment outranks a param wherever it is registered', () => {
  // The exact claim documentation/architecture/ROUTE_MAP.md got wrong, pinned against the installed
  // router rather than against anyone's memory of how routing works.
  const routes = [
    { path: '/deals' },
    { path: '/deals/:dealId' },   // registered FIRST
    { path: '/deals/pipeline' },  // registered second — still wins
    { path: '/deals/screening' },
  ];
  const hit = (url) => {
    const m = matchRoutes(routes, url);
    return m ? m[m.length - 1].route.path : null;
  };
  assert.equal(hit('/deals/pipeline'), '/deals/pipeline',
    'if this ever fails, the four stage tabs really would need ordering');
  assert.equal(hit('/deals/screening'), '/deals/screening');
  assert.equal(hit('/deals/42'), '/deals/:dealId', 'the param still serves real ids');
  assert.equal(hit('/deals'), '/deals');
});

test('documentation/architecture/ROUTE_MAP.md carries the correction, not the original claim', () => {
  const map = readFileSync(resolve(process.cwd(), 'documentation/architecture/ROUTE_MAP.md'), 'utf8');
  assert.match(map, /React Router does not match in registration order/);
  // The old wording asserted the opposite; it must not still be sitting there.
  assert.doesNotMatch(map, /the param route swallows all four/,
    'the corrected table must replace the claim, not sit beside it');
});

// ---------- and the framework that DOES care ----------

test('the worker still mounts its literal deal routes above the id route', () => {
  // Hono matches in registration order, so this one is real. Same words,
  // opposite conclusion, different framework — which is the whole confusion.
  const worker = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/deals.ts'), 'utf8');
  const idAt = worker.indexOf("deals.get('/:id'");
  assert.notEqual(idAt, -1);
  for (const literal of ["deals.get('/pass-analytics'", "deals.get('/stage-analytics'", "deals.get('/funnel'"]) {
    const at = worker.indexOf(literal);
    assert.notEqual(at, -1, `${literal} must exist`);
    assert.ok(at < idAt, `${literal} must be registered before the id route — Hono is order-sensitive`);
  }
});

// ---------- the singular/plural legibility hazard ----------

test('/fund/* is not introduced beside the live /funds/*', () => {
  // ROUTE_MAP records this as a *legibility* hazard rather than a collision:
  // singular and plural are genuinely distinct namespaces, so React Router
  // would route both correctly. The problem is human — two prefixes one letter
  // apart, where a misread `/fund/performance` silently lands somewhere real.
  //
  // The recorded fix is "do not introduce /fund/*, and do not re-route the
  // live /funds/*". That was a conclusion in a document, which is exactly the
  // form a rule takes right before someone adds the route anyway. Enforced.
  const singular = ROUTES.filter((p) => /^\/fund(\/|$)/.test(p));
  assert.deepEqual(singular, [],
    'the canvases propose /fund/* — mount it under the existing /funds/* instead');
  // And the plural must still be there, or this test passes for the wrong
  // reason: an empty app satisfies "no /fund/*" perfectly.
  assert.ok(ROUTES.some((p) => p.startsWith('/funds')),
    '/funds/* must exist, or this guard is vacuous');
});
