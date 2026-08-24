/**
 * Two founder-journey gaps, both verified against the code before being fixed.
 *
 * 1. /studio opened on a chatbot and then ProfileFitSection — Skills graph,
 *    Values graph, Founder archetype, Best-fit matches. Nothing about the
 *    venture, and no link to Command Center's Overview tab, which is the one
 *    surface that answers "what next". The closest thing on the page, the
 *    Studio Ops card, routes to /studio-ops → the OPERATIONS tab, and only
 *    renders when the founder has assigned tasks at all.
 *
 * 2. The holding-state screen showed byte-identical copy to every applicant
 *    regardless of the lane they picked at signup, and Google signups recorded
 *    no lane whatsoever — so the same person choosing "founder" reached the
 *    admin queue with intent by email and with none by Google.
 *
 * Run with:  node --test frontend/test/founder_journey_entry.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STRIP = read('../src/components/VentureNextStep.jsx');
const DASH = read('../src/pages/Dashboard.jsx');
const EXPLORING = read('../src/pages/ExploringDashboard.jsx');
const API = read('../src/lib/api.js');
const GOOGLE = read('../../cloudflare-worker/src/routes/auth_google.ts');
const AUTH = read('../../cloudflare-worker/src/routes/auth.ts');

/* ───────────────────────── /studio entry point ────────────────────────── */

test('venture progress renders BEFORE the personal-profile section', () => {
  const src = code(DASH);
  const strip = src.indexOf('<VentureNextStep');
  const profile = src.indexOf('<ProfileFitSection');
  assert.notEqual(strip, -1, 'the strip must be mounted');
  assert.notEqual(profile, -1);
  assert.ok(strip < profile, 'a founder\'s front door must lead with the venture, not the person');
});

test('the strip links to Command Center, which nothing on /studio reached before', () => {
  assert.match(code(STRIP), /to="\/build\/command-center"/);
});

test('it links to the Overview tab, not Operations', () => {
  // /studio-ops redirects founders to ?tab=studio-ops → the Operations tab.
  // Command Center with no ?tab lands on Overview, which is where the
  // next-best-action checklist lives.
  const src = code(STRIP);
  assert.doesNotMatch(src, /tab=studio-ops/);
  assert.doesNotMatch(src, /\/studio-ops/);
});

test('the next action comes from the same endpoint LifecycleModule uses', () => {
  // Two sources would let /studio and Command Center tell a founder two
  // different next steps.
  const src = code(STRIP);
  assert.match(src, /api\.getLifecycle\(/);
  assert.match(src, /checklist\.find\(\(i\) => !i\.done\)/);
});

test('the strip renders nothing when there is no venture data', () => {
  // An empty "no next step" card on the front door implies the venture is
  // finished — worse than the profile section it sits above.
  const src = code(STRIP);
  assert.match(src, /if \(!state\) return null;/);
  assert.match(src, /if \(!project\?\.id\) return;/);
});

test('a failed fetch stays silent rather than banner-ing the dashboard', () => {
  assert.match(code(STRIP), /reportError\('VentureNextStep:load'/);
});

/* ──────────────────── admission-funnel lane parity ────────────────────── */

test('the worker exposes suggested_role on the caller\'s OWN /me only', () => {
  const src = code(AUTH);
  assert.match(src, /suggested_role: suggestedRole/);
  // Scoped to the holding state — no reason to ship it to anyone past it.
  assert.match(src, /String\(user\.role\) === 'exploring'/);
  assert.match(src, /FROM user_role_review WHERE user_id = \?/);
});

test('the holding screen speaks to the lane the applicant chose', () => {
  const src = code(EXPLORING);
  assert.match(src, /LANE_COPY\[user\?\.suggested_role\]/);
  for (const lane of ['founder', 'investor', 'partner']) {
    assert.match(src, new RegExp(`${lane}: \\{`), `missing copy for ${lane}`);
  }
});

test('an unknown or absent lane falls back to generic copy, never a guess', () => {
  // Accounts predating the lane record — and Google signups predating the
  // OAuth fix — have no suggested_role at all.
  assert.match(code(EXPLORING), /LANE_COPY\[user\?\.suggested_role\] \|\| null/);
});

test('the lane never implies access has been granted', () => {
  // The badge must read as "under review", not as an assigned role: the copy
  // sits on a screen whose entire point is that nothing is unlocked yet.
  assert.match(code(EXPLORING), /under review/);
});

/* ─────────────────────── Google OAuth lane parity ─────────────────────── */

test('Google sign-in now records the lane, like every other signup path', () => {
  const src = code(GOOGLE);
  assert.match(src, /upsertSuggestedRole/, 'the Google path recorded nothing at all before');
  assert.match(src, /state\.lane/);
});

test('the lane is whitelisted on the way in, not passed through', () => {
  const src = code(GOOGLE);
  assert.match(src, /\['founder', 'partner', 'investor'\]\.includes\(laneRaw\)/);
});

test('the lane rides the SIGNED state, so it cannot be tampered with', () => {
  const src = code(GOOGLE);
  const payload = src.slice(src.indexOf('interface StatePayload'), src.indexOf('async function signState'));
  assert.match(payload, /lane\?: string;/);
  // signState HMACs the whole payload; verifyState rejects a bad signature.
  assert.match(src, /const state = await signState\(c\.env, \{[\s\S]{0,200}lane,/);
});

test('api.js forwards the lane instead of silently dropping it', () => {
  // googleStartUrl whitelists params — an unlisted `lane` would vanish here
  // and the worker would never see it.
  const src = code(API);
  assert.match(src, /if \(params\.lane\) qs\.set\('lane', params\.lane\)/);
});

test('a Google-path failure to record the lane does not break sign-in', () => {
  const src = code(GOOGLE);
  const block = src.slice(src.indexOf('if (state.lane)'), src.indexOf('if (state.lane)') + 500);
  assert.match(block, /try \{/);
  assert.match(block, /catch/);
});

/* ─────────────────── LP queue: multi-fund selector ────────────────────── */

const LPQ = read('../src/pages/admin/AdminLpApplications.jsx');
const LPR = read('../../cloudflare-worker/src/routes/admin_lp_applications.ts');

test('the queue is no longer pinned to one hardcoded fund', () => {
  // lp_applications has always been per-fund — migration 165 keys its unique
  // index on fund_slug precisely so a second fund cannot collide with the
  // first. The queue read one slug, so a Fund II application would have been
  // written and then been invisible to every reviewer.
  const src = code(LPR);
  assert.doesNotMatch(src, /LP_FUND_SLUG/, 'the hardcoded constant must be gone');
  assert.match(src, /c\.req\.query\('fund'\)/);
  assert.match(src, /\.bind\(fundSlug\)/);
});

test('the fund list unions vc_funds with funds that have applications', () => {
  // A newly-created fund must appear before its first application arrives, and
  // an application against a since-renamed fund must stay reachable.
  const src = code(LPR);
  assert.match(src, /SELECT slug, name FROM vc_funds/);
  assert.match(src, /SELECT DISTINCT fund_slug FROM lp_applications/);
});

test('a missing vc_funds table degrades instead of emptying the picker', () => {
  const src = code(LPR);
  const fn = src.slice(src.indexOf('async function listFunds'), src.indexOf('adminLpApplications.get'));
  assert.match(fn, /catch/);
  assert.match(fn, /if \(!seen\.has\(DEFAULT_FUND_SLUG\)\)/, 'the default must always be offered');
});

test('a decision is looked up by id alone, not pinned to the default fund', () => {
  // Pinning the fund on PATCH would 404 every decision made from a non-default
  // fund's queue — the exact bug the selector would otherwise introduce.
  const src = code(LPR);
  assert.match(src, /SELECT id, status FROM lp_applications WHERE id = \?'/);
});

test('the page fetches per fund and refetches when it changes', () => {
  const src = code(LPQ);
  assert.match(src, /api\.adminLpApplications\(fund \|\| undefined\)/);
  assert.match(src, /\}, \[fund\]\);/, 'load must depend on fund or the queue never refreshes');
});

test('switching fund clears the selected application', () => {
  // The detail panel would otherwise keep showing an applicant from the fund
  // you just navigated away from.
  assert.match(code(LPQ), /setFund\(e\.target\.value\); setSelId\(null\);/);
});

test('the picker only appears when there is more than one fund', () => {
  assert.match(code(LPQ), /funds\.length > 1 \?/);
});
