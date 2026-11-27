/**
 * S7 AND S13 — what a branch is told about being frozen, and about being
 * watched (D142).
 *
 * THE ASSERTION THAT MATTERS MOST IS THE PARITY ONE. S7's Locked column is a
 * claim about what the SERVER refuses. `lib/branchFreeze.js` names the route
 * files that enforce it, and the test below reads the worker to check that the
 * named set and the enforcing set are the same. A sixth gate added with no row
 * fails; a row naming a file that stopped gating fails too. Without it the
 * screen drifts from the product silently, which is the failure this programme
 * has deleted three times over — and here it would be worse than a stale
 * promise, because a branch would be told a write is frozen when it is not.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/branch_shell_s7_s13.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

import { FROZEN, STILL_READABLE, NOT_BUILT, FREEZE_RULE } from '../src/lib/branchFreeze.js';
import {
  KEY, activeSupportSession, clearSupportSession, timeLeftLabel,
} from '../src/lib/supportSession.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ROUTES = 'cloudflare-worker/src/routes';
const APP = codeOnly(read('frontend/src/App.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));

/** Every worker route file that actually calls the freeze gate. */
function filesThatGate() {
  const out = [];
  for (const f of readdirSync(resolve(process.cwd(), ROUTES))) {
    if (!f.endsWith('.ts')) continue;
    const src = codeOnly(read(`${ROUTES}/${f}`));
    if (src.includes('await requireBranchNotSuspended(c)')) out.push(f);
  }
  return out.sort();
}

// ── The parity that keeps the drawn list honest ─────────────────────────────

test('what S7 draws as Locked is exactly what the worker refuses', () => {
  const named = [...new Set(FROZEN.flatMap((r) => r.gatedIn))].sort();
  const actual = filesThatGate();
  assert.deepEqual(named, actual,
    'lib/branchFreeze.js and the worker disagree about which writes a suspended branch cannot make. '
    + 'A new gate needs a row; a row whose file stopped gating must lose it. The screen may not '
    + 'claim a freeze the server does not enforce, nor stay silent about one it does.');
  // D303 raised this from 9: wellbeing.ts joined the three community files.
  assert.ok(actual.length >= 10, `only ${actual.length} route files gate; the four lanes, four community files, admin.ts and kyc.ts is 10 (D303)`);
});

test('nothing drawn as Locked is a control that was never built', () => {
  // S7's fourth locked row is `Seat assignment`, and there is no seat ledger:
  // `seat_assignments` has no migration, no route and no api method. Drawing a
  // freeze on it would be a claim about a feature that does not exist.
  const gating = filesThatGate();
  for (const row of NOT_BUILT) {
    assert.ok(!FROZEN.some((f) => f.row === row.row),
      `"${row.row}" is in both FROZEN and NOT_BUILT — it cannot be both`);
    assert.ok(typeof row.why === 'string' && row.why.length > 40,
      `"${row.row}" is recorded as not built without saying why`);
  }
  // And the measurement behind it, so the entry cannot go stale unnoticed.
  const sql = readdirSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations'))
    .filter((f) => read(`cloudflare-worker/sql/migrations/${f}`).includes('seat_assignments'));
  assert.deepEqual(sql, [],
    'a migration now creates `seat_assignments` — the NOT_BUILT entry for Seat assignment is stale, '
    + 'and S7 can draw that row for real');
  assert.ok(!API.includes('seatAssign') && !API.includes('assignSeat'),
    'api.js grew a seat-assignment method; the NOT_BUILT entry is stale');
  assert.ok(gating.length > 0);
});

test('the freeze rule is stated, and the readable side is not empty', () => {
  assert.match(FREEZE_RULE, /cannot publish|cannot .*publish/i);
  assert.match(FREEZE_RULE, /taking something down|take .*down/i,
    'the rule must say the takedown still works — that is the half that is easy to lose');
  assert.ok(STILL_READABLE.length >= 4);
});

test('the appeal is NOT frozen — the one door out of the freeze', () => {
  // Gating it would freeze the way out. `branch_escalations.ts` says so in its
  // own header, and this is the assertion that keeps it true.
  const src = codeOnly(read(`${ROUTES}/branch_escalations.ts`));
  assert.ok(!src.includes('await requireBranchNotSuspended(c)'),
    'the escalation route is suspension-gated — a suspended branch can no longer appeal its suspension');
});

// ── The 423 finally has something to key on ─────────────────────────────────

test('api.js fans out the branch refusal, and still fans out the HQ one', () => {
  assert.match(API, /res\.status === 423 && err && err\.code === 'branch_suspended'/,
    'the branch 423 must be recognised by its code');
  assert.match(API, /studioos:branch_suspended/);
  // The control: the HQ twin must be untouched by this change.
  assert.match(API, /res\.status === 423 && err && err\.code === 'admin_frozen'/);
  assert.match(API, /studioos:admin_frozen/);
});

test('both shell bars persist nothing', () => {
  // A bar for a state the viewer must not be able to silence cannot remember
  // being closed — `AdminFrozenBar` states the rule and these follow it.
  for (const f of ['BranchSuspendedBar', 'HqSupportSessionBar']) {
    const src = codeOnly(read(`frontend/src/components/${f}.jsx`));
    assert.ok(!src.includes('localStorage'),
      `${f} writes to localStorage — a suspension or a support session one click can silence is neither`);
  }
  // The support bar has no dismiss at all: it describes something still
  // happening, not a refusal that already finished.
  const support = codeOnly(read('frontend/src/components/HqSupportSessionBar.jsx'));
  assert.ok(!/aria-label="Close"/.test(support),
    'the support-session bar offers a close button — the session is still running');
});

// ── S13: the payload that was written, never read, and never cleared ────────

test('the support session expires, and clears itself on the way past', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const now = Date.UTC(2026, 8, 17, 12, 0, 0);
    const live = JSON.stringify({
      actor_name: 'T. Okafor', reason: 'ticket #4192',
      expires_at: new Date(now + 10 * 60_000).toISOString(), branch: 'fr',
    });

    store.set(KEY, live);
    const a = activeSupportSession(now);
    assert.equal(a.actorName, 'T. Okafor');
    assert.equal(timeLeftLabel(a.msLeft), '10:00 left');

    // Past its expiry it is not merely hidden — it is gone, so it cannot
    // outlive the session on this browser.
    assert.equal(activeSupportSession(now + 11 * 60_000), null);
    assert.equal(store.has(KEY), false, 'an expired payload must be removed, not just ignored');

    // A payload with no expiry cannot be shown to be current, so it is not
    // claimed to be.
    store.set(KEY, JSON.stringify({ actor_name: 'X' }));
    assert.equal(activeSupportSession(now), null);
    assert.equal(store.has(KEY), false);

    // Malformed JSON is the same answer, not a crash.
    store.set(KEY, '{not json');
    assert.equal(activeSupportSession(now), null);

    store.set(KEY, live);
    clearSupportSession();
    assert.equal(store.has(KEY), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test('signing out purges the support payload', () => {
  // It did not, and that is the defect: the blob outlived both the session and
  // sign-out, so the next ordinary session on the same browser would have been
  // told HQ was inside the account.
  const at = APP.indexOf('const clearSession');
  assert.ok(at > 0, 'clearSession not found');
  const body = APP.slice(at, at + 2000);
  assert.ok(body.includes('clearSupportSession()'),
    'clearSession does not purge the HQ support-session payload');
  // And it goes through the module that owns the key, so the purge and the
  // reader cannot be renamed apart.
  assert.ok(!body.includes(`removeItem('${KEY}')`),
    'the key is spelled out here as well as in lib/supportSession.js — one owner, one name');
});

test('the support bar renders ABOVE PortalSwitcher', () => {
  // The order is the whole point. `isImpersonating` is `!!realUser`, which a
  // support session never sets, so supporting a branch ADMIN mounted the
  // ordinary purple "Admin Mode" bar with a working View-as picker — an
  // HQ-driven session wearing the admin's own chrome.
  const bar = APP.indexOf('<HqSupportSessionBar />');
  const portal = APP.indexOf('<PortalSwitcher');
  assert.ok(bar > 0, 'the support bar is not mounted');
  assert.ok(portal > 0, 'PortalSwitcher is not mounted');
  assert.ok(bar < portal,
    'PortalSwitcher renders before the support bar, so an HQ-driven session can still be dressed '
    + 'as the admin’s own');
});

test('the badge finally reads the state /me.branch has been sending all along', () => {
  const at = APP.indexOf('data-testid="territory-badge"');
  assert.ok(at > 0, 'the territory badge was not found');
  const badge = APP.slice(at, at + 1200);
  assert.ok(badge.includes('branchFact.status'),
    'the badge still ignores `status`, so a suspended branch looks identical to an active one');
  // And it says the state only when there is one worth saying.
  assert.ok(badge.includes("!== 'active'"),
    'the badge would print ACTIVE on every branch, which is noise rather than a signal');
});
