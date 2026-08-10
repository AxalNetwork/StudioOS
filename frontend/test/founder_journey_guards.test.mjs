/**
 * Founder-journey guards — pins the wiring the friction audit fixed or
 * verified, so none of it silently regresses:
 *
 *   1. Assistant deep-links resolve. The worker's FEATURE_CATALOG is what the
 *      AI assistant speaks to users as navigation; seven of its URLs had gone
 *      stale after route renames (/legal/cofounder-agreement, /discovery, …)
 *      and the assistant was linking founders into 404s. Every catalog URL's
 *      pathname must be a registered SPA route.
 *   2. The founder-wizard handoff survives. The one onboarding_progress row
 *      per user is consumed by the signup chatbot; the ONLY thing that makes
 *      the founder wizard reachable afterwards is admin_exploring's reset of
 *      that row (flow → assigned role, completed_at → NULL) at role
 *      assignment. Losing that reset silently orphans the whole wizard —
 *      and with it the onboarding→project projection and portal prefill.
 *   3. No unenforceable signup promises. The founder lane used to pledge
 *      "we'll score your venture within 72 hours" — nothing enforced any
 *      SLA, and scoring is self-serve. Marketing copy must not promise
 *      timed outcomes the system doesn't implement.
 *   4. Review is not dead time for founders. The exploring holding screen
 *      must keep offering the founder lane its real next step (the Spin-Out
 *      Lab application).
 *   5. /studio stays venture-first. The founder home renders venture
 *      progress (VentureNextStep) ABOVE the personal skills/values section —
 *      the page used to open on ProfileFitSection.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_journey_guards.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = (rel) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');
const fe = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

test('every assistant FEATURE_CATALOG deep-link resolves to a registered SPA route', () => {
  const catalog = repo('cloudflare-worker/src/routes/assistant.ts');
  const app = fe('src/App.jsx');
  const urls = [...catalog.matchAll(/url:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(urls.length >= 15, `catalog looks truncated (${urls.length} urls)`);
  const routes = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
  for (const u of urls) {
    const pathname = u.split('?')[0];
    assert.ok(
      routes.has(pathname),
      `assistant deep-link "${u}" has no registered route — the assistant would send users to a 404`,
    );
  }
});

test('assigning founder/investor resets the onboarding row so the wizard can fire', () => {
  const src = repo('cloudflare-worker/src/routes/admin_exploring.ts');
  // The mechanics that make /onboarding/founder reachable at all: the chat
  // flow already completed the single per-user row, so App.jsx's wizard gate
  // (`!onboardingComplete && flow === role`) only fires if assignment rewrites
  // the row. Assert the reset's two load-bearing halves.
  assert.match(src, /flow = excluded\.flow/, 'assign-role no longer rewrites onboarding_progress.flow');
  assert.match(src, /completed_at = NULL/, 'assign-role no longer clears completed_at — the wizard gate can never fire');
});

test('the founder signup lane promises nothing the system does not enforce', () => {
  const src = fe('src/pages/RegisterPage.jsx');
  assert.ok(
    !/72[\s-]?hours?/i.test(src),
    'RegisterPage re-promises a 72-hour SLA — nothing in the codebase enforces one',
  );
});

test('the exploring holding screen offers the founder lane its real next step', () => {
  const src = fe('src/pages/ExploringDashboard.jsx');
  assert.ok(src.includes("'/spinout-lab'") || src.includes('"/spinout-lab"'),
    'founder-lane CTA to the Spin-Out Lab application is gone — review becomes pure dead time again');
  assert.ok(src.includes('exploring-lane-cta'), 'lane CTA testid missing');
});

test('/studio (founder home) renders venture progress above the personal profile section', () => {
  const src = fe('src/pages/Dashboard.jsx');
  const venture = src.indexOf('<VentureNextStep');
  const profile = src.indexOf('<ProfileFitSection');
  assert.ok(venture !== -1 && profile !== -1, 'expected both sections on the founder dashboard');
  assert.ok(
    venture < profile,
    'ProfileFitSection renders before VentureNextStep — the founder home has regressed to profile-first',
  );
});
