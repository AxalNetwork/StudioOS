/**
 * D259 — HQ's cross-host support session gets its screen, and the two stale
 * impersonation callers are gone.
 *
 * D120 built `POST /api/admin/branches/:code/support-session` and the branch's
 * redeem screen, and nothing in the SPA called the open route. The control is
 * on the Team table's BRANCH hit (`MoveHit`), beside Move, under the route's
 * own two conditions: not under the view-as overlay, and only on an active
 * account. It opens the `open_url` the route built — never one of its own.
 *
 * Rendered where rendering can see it (the toggle's three cases, through the
 * exported `MoveHit`), read as source where it cannot (the submit handler and
 * the gate on Begin, which only exist once the form is open). The worker half —
 * the recovery cool-off, the gates before the branch is called, and the audit
 * row naming a branch-local id — is driven through the bundled Worker in
 * cloudflare-worker/test/branch_support_session_d259.test.ts.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_support_session_d259.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { MoveHit } from '../src/pages/hq/HqTeamTable.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const TEAM_RAW = raw('frontend/src/pages/hq/HqTeamTable.jsx');
const TEAM = codeOnly(TEAM_RAW);
const API = codeOnly(raw('frontend/src/lib/api.js'));
const ACCOUNTS = raw('frontend/src/pages/hq/AccountsPage.jsx');

/** `MoveHit`'s own body, bounded by the next top-level function. */
function moveHit() {
  const a = TEAM.indexOf('export function MoveHit(');
  assert.ok(a >= 0, 'MoveHit is gone');
  const b = TEAM.indexOf('\nfunction ', a + 1);
  return TEAM.slice(a, b > a ? b : TEAM.length);
}

const HIT = { id: 7, name: 'Fleur Founder', email: 'fleur@fr.example', role: 'founder', is_active: 1, created_at: '2026-09-01 10:00:00' };
const render = (props) => renderToStaticMarkup(React.createElement('ul', null,
  React.createElement(MoveHit, { hit: HIT, from: 'fr', destinations: [], onMoved() {}, ...props })));

test('D259: api.hqSupportSession posts the target and the reason to the branch route', () => {
  const at = API.indexOf('hqSupportSession:');
  assert.ok(at >= 0, 'api.hqSupportSession is gone');
  const method = API.slice(at, API.indexOf('),', at) + 2);
  assert.match(method, /hqSupportSession: \(code, userId, reason\) =>/);
  assert.match(method, /\/admin\/branches\/\$\{encodeURIComponent\(code\)\}\/support-session/,
    'the method does not call the D120 open route');
  assert.match(method, /method: 'POST'/);
  assert.match(method, /body: JSON\.stringify\(\{ target_user_id: userId, reason \}\)/,
    'the body is not the route\'s { target_user_id, reason }');
});

test('D259: Support is drawn on an active branch hit, and not under the view-as overlay or on a deactivated account', () => {
  assert.ok(render({ viewAs: null }).includes('data-testid="hq-team-support-toggle"'),
    'an active branch account offers no Support');
  assert.ok(!render({ viewAs: 'fr' }).includes('hq-team-support-toggle'),
    'Support is drawn under the view-as overlay, where nothing can be acted on (D153)');
  assert.ok(!render({ viewAs: null, hit: { ...HIT, is_active: 0 } }).includes('hq-team-support-toggle'),
    'Support is drawn on a deactivated account, which the branch can only refuse');
  // And in source: one rule, read once, guarding the toggle and the form.
  const body = moveHit();
  assert.match(body, /const canSupport = !viewAs && Number\(hit\.is_active\) === 1;/);
  assert.match(body, /\{canSupport && \(\s*<button[^>]*data-testid="hq-team-support-toggle"/);
  assert.match(body, /\{canSupport && supportOpen && \(/, 'the form is not under the same rule as its toggle');
});

test('D259: exactly one Support control, on the branch search, never on the HQ-held table', () => {
  assert.equal((TEAM_RAW.match(/data-testid="hq-team-support-toggle"/g) || []).length, 1,
    'Support is drawn in more than one place');
  assert.ok(moveHit().includes('data-testid="hq-team-support-toggle"'), 'Support is not on the branch hit');
  assert.equal((TEAM.match(/<MoveHit/g) || []).length, 1, 'the branch hit is mounted more than once');
  const mount = TEAM.indexOf('<MoveHit');
  const hqHeld = TEAM.indexOf('HQ-held ·');
  const branchMap = TEAM.indexOf('branches.map((b) =>');
  assert.ok(hqHeld > 0 && branchMap > hqHeld && mount > branchMap,
    'the branch hit is mounted outside the branch search, where an HQ-held row would grow Support');
  const tag = TEAM.slice(mount, TEAM.indexOf('/>', mount));
  assert.match(tag, /viewAs=\{viewAs\}/, 'the branch hit is not told whether the overlay is on');
});

test('D259: Begin needs ten trimmed characters, and the reason sent is the reason typed', () => {
  const body = moveHit();
  assert.match(body, /disabled=\{supportBusy \|\| supportReason\.trim\(\)\.length < 10\}/,
    'Begin is enabled below ten characters');
  assert.match(body, /await api\.hqSupportSession\(from, hit\.id, supportReason\.trim\(\)\)/);
});

test('D259: the page opens the URL the route built, and never builds one', () => {
  const body = moveHit();
  assert.match(body, /window\.open\(res\.open_url, '_blank', 'noopener'\)/,
    'the page does not open the route\'s open_url');
  assert.match(body, /setSupportUrl\(res\.open_url\)/);
  assert.match(body, /href=\{supportUrl\}/, 'the fallback link is not the route\'s URL');
  // The hostname convention and the one-time code are the server's.
  assert.ok(!/axal\.vc/.test(TEAM), 'HqTeamTable spells a branch host — it builds a URL the route did not');
  assert.ok(!/support\/session/.test(TEAM), 'HqTeamTable spells the redeem path — it builds a URL the route did not');
});

test('D259: the operator is told the person is not told, and each refusal is shown in words', () => {
  const rendered = moveHit();
  assert.ok(TEAM_RAW.includes('The person is not told:'), 'the form does not say the branch account is not told');
  assert.match(rendered, /setSupportErr\(supportRefusal\(ex\)\)/);
  assert.match(TEAM, /function supportRefusal\(ex\) \{\s*const d = ex\?\.data;\s*if \(d && typeof d\.message === 'string' && d\.message\) return d\.message;/,
    'a refusal shows the route\'s machine code instead of its sentence');
});

/** Every .js/.jsx file under frontend/src. */
function sources(dir = 'frontend/src', out = []) {
  for (const e of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('D259: no caller in frontend/src posts to /admin/impersonate/ without a reason', () => {
  // ApiBridgePage's sample script posted with no `context`, which answers 400
  // `impersonation_reason_required` — and could not pass TOTP or step-up
  // either. The sample is gone; this keeps every other caller honest.
  const offenders = [];
  for (const f of sources()) {
    // Code only: a comment that names the route (accountControls.js does) is
    // not a caller.
    const lines = codeOnly(raw(f)).split('\n');
    lines.forEach((line, i) => {
      if (line.includes('/admin/impersonate/') && !line.includes('context=')) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'an impersonation call is made with no reason');
  assert.ok(!raw('frontend/src/pages/ApiBridgePage.jsx').includes('/api/admin/impersonate'),
    'the API Bridge page still documents an impersonation endpoint a bridge token cannot open');
});

test('D259: the uncalled cohort impersonation reader leaves api.js; its route stays', () => {
  assert.ok(!API.includes('adminCohortImpersonationAudit'), 'api.js still carries a method nothing calls');
  assert.ok(raw('cloudflare-worker/src/routes/admin_cohort.ts').includes("r.get('/impersonation-audit'"),
    'the route was retired with the method — D259 keeps it (D133 tests it; nothing retires)');
});

test('D259: the Team rail says which accounts are told and which are not', () => {
  assert.ok(!ACCOUNTS.includes('Neither an impersonated account nor the successor to the elevation is notified'),
    'the rail still says nobody is told, false since D241 and D248');
  assert.match(ACCOUNTS, /An HQ-held account is told when a support session opens on it \(D248\)/);
  assert.match(ACCOUNTS, /An account on a branch is not told yet/);
});
