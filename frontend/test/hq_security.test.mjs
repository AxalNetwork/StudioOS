/**
 * HQ · Security (canvas Y2, completed by H23) — the zones read their stores,
 * one half-card stays a stated absence, one write.
 *
 * This header used to say four zones had no store. D152 found the AI-safety
 * one was false; D200 found two more were: `sanctions_screenings` has been
 * written by `screenUser` since migration 035, and the backup half of
 * "Backup / DR" reads the heartbeat the nightly export writes to R2. The
 * security_events ledger is built (migration 282). What is still genuinely
 * absent is the restore drill's outcome — written nowhere the platform can
 * read — and the page says so in its card, never from the canvas's sample
 * rows. The one action, force re-auth, carries the impersonation write bar
 * and a stored reason. These pin that shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/hq/SecurityPage.jsx'));
const ROUTE = codeOnly(read('cloudflare-worker/src/routes/admin_security.ts'));
const APP = read('frontend/src/App.jsx');

test('the Security row sits between Support and Settings, and /admin/security is HQ-only', () => {
  // WAS "the seventh of eight" AND PINNED INDEX 6. Revenue landed as the
  // ninth row (canvas H5) directly after Team, which is where the H5 nav
  // puts it, so Security moved to index 7 — and it will move again when
  // Content and Platform land from H6. What decision A4 actually settled is
  // the row's NAME and its NEIGHBOURS, not its ordinal, so that is what is
  // pinned now: a position-independent assertion that says the same thing
  // and survives the next row. `super_admin_shell.test.mjs` holds the full
  // ordered array, so the order is still pinned exactly once.
  const rows = (SIDEBAR_GROUPS.super_admin || []).flatMap((g) => g.items || []);
  const at = rows.findIndex((r) => r.to === '/admin/security');
  assert.ok(at >= 0, 'the Security row is gone');
  assert.equal(rows[at].label, 'Security', 'decision A4: Security, not Governance');
  assert.equal(rows[at - 1]?.label, 'Support', 'Security no longer follows Support');
  assert.equal(rows[at + 1]?.label, 'Settings', 'Security no longer precedes Settings');
  const line = APP.split('\n').find((l) => l.includes('path="/admin/security"'));
  assert.ok(line, '/admin/security must be registered');
  assert.match(line, /hqOnly\(/, 'an admin without the elevation gets the notice');
});

test('the page reads two endpoints and writes through two, and nothing else', () => {
  // WAS one read. Canvas H7's feed is a second: it is filtered server-side
  // over a merged page of sixty rows from four stores, so it cannot ride on
  // the overview payload and cannot be filtered in the browser. The point of
  // this assertion is unchanged — the page reaches for NOTHING else, and a
  // page that starts calling a fifth endpoint has grown a second job.
  //
  // D168 ADDED THE SECOND WRITE, and this guard failing was correct rather
  // than inconvenient. Closing a data-subject request is an act on a zone
  // this page already owned and already rendered; what it is not is a second
  // job, which is the property the list exists to pin. So the name and the
  // list move together — loosening the `deepEqual` into a membership check
  // would have kept the test green and thrown away everything it was for.
  const calls = [...new Set([...PAGE.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]))].sort();
  assert.deepEqual(calls, ['hqCloseDsrRequest', 'hqGovernance', 'hqSecurityForceReauth', 'hqSecurityOverview']);
});

test('D200 — only the restore drill is still a stated absence; the ledger and sanctions read their stores', () => {
  // D152 — IT WAS FOUR, AND `ai_safety` DID NOT BELONG IN THE LIST. Its
  // refusal claimed no guardrail, flagged-output or token-anomaly counter was
  // stored; two of those three clauses were false, and the verdict rollup was
  // already drawn on `AiUsageTab` one click away. So this guard was holding a
  // false claim in place — the eighth time in this programme that a test
  // pinning a refusal had to be re-aimed the day the refusal stopped being
  // true. The zone's own assertions moved to `hq_governance_h7.test.mjs`,
  // which owns H7's guardrail panel; what stays here is the THREE that are
  // still genuinely absent, and the proof AI safety is not among them.
  //
  // D200 RE-AIMED THIS A SECOND TIME, and for the same reason D152 did: two
  // more of the three were refusals denying stores the platform has. The
  // thirteenth and fourteenth instances of a guard pinning a refusal that had
  // to move the day it stopped being true. What stays absent is ONE HALF-CARD,
  // and the proof the other three are real is that none of them may go back.
  for (const key of ['security_events', 'sanctions', 'backup_dr', 'ai_safety']) {
    assert.doesNotMatch(ROUTE, new RegExp(`\\b${key}: absent\\(`),
      `${key} went back to refusing a store the platform has`);
  }
  assert.match(ROUTE, /security_events: await securityEventsBlock\(env\)/, 'the ledger block is not read');
  assert.match(ROUTE, /sanctions: await screeningSummary\(env\)/, 'the sanctions card is not read from its store');
  assert.match(ROUTE, /backup: await readBackupHeartbeat\(env, 'd1'\)/, 'the backup half is not read from the heartbeat');
  assert.match(ROUTE, /drill: absent\(RESTORE_DRILL_REASON\)/,
    'the restore drill must stay a stated absence, with the reason from its one home');
  // The drill half renders the server's reason in its own card — never a
  // green light inferred from a healthy backup half.
  assert.match(PAGE, /<Absent block=\{block\.drill\} fallback="no drill record is kept\." \/>/);
  // The tile that was `value={null}` under "no security_events" reads the
  // ledger — and ONLY under its availability, with the reason otherwise.
  assert.match(PAGE,
    /label="Failed sign-ins" value=\{se\?\.available \? num\(se\.failed_signins_24h\) : null\} note=\{se\?\.available \? '[^']+' : \(se\?\.reason \|\| 'unreadable'\)\}/,
    'the failed sign-ins tile must read the ledger under its availability and say why when it cannot');
  // No default turns an absent figure into a zero.
  assert.doesNotMatch(PAGE, /\|\|\s*0\b/);
  assert.match(PAGE, /const num = \(v\) => \(v === null \|\| v === undefined \|\| !Number\.isFinite\(Number\(v\)\) \? null/);
});

test('an unreadable store is reported, not zeroed, on both sides', () => {
  assert.match(ROUTE, /impersonations = absent\(/);
  assert.match(ROUTE, /sessions = absent\(/);
  assert.match(PAGE, /const UNAVAILABLE = Symbol\('unavailable'\)/);
  // Two files now, for the reason hq_home.test.mjs records: `Unreadable`
  // was local here and in HqHomePage, the two had drifted, and it lives in
  // `ui/Honesty.jsx`. The clause that differs is the prop; the component
  // has to still render it, so both are checked.
  assert.match(PAGE, /<Unreadable/, 'a failed read no longer renders Unreadable');
  assert.match(PAGE, /claim="This is not a claim that nothing happened\."/);
  assert.match(
    read('frontend/src/ui/Honesty.jsx'),
    /\{what\} could not be read\. \{claim\}/,
    'the shared Unreadable no longer renders the claim it is handed',
  );
});

test('the deletion clock is statutory, computed server-side, and unknown when unparseable', () => {
  // D168 RE-AIMED THIS, AND WHAT IT FOUND IS WORTH THE COMMENT.
  //
  // It used to pin two literals in the route: `const DSR_CLOCK_DAYS = 30;`
  // and the exact text `days_left: elapsedDays === null ? null :
  // DSR_CLOCK_DAYS - elapsedDays`. That is a text match on a DECLARATION —
  // the D164 `investor_shell` class — and it was wrong in both directions at
  // once. It failed on a correct refactor (moving the arithmetic into a
  // service so it could be tested at all), and it never covered the half of
  // the arithmetic that matters: `elapsedDays` was computed on the LINE ABOVE,
  // which this guard did not read, so turning `86400000` into `3600000` would
  // have made every request read twenty-four times more overdue and nothing
  // here would have moved.
  //
  // So the property is pinned instead: ONE definition of the clock, the route
  // computing `days_left` through the helper, and the page rendering the
  // unknown state. The arithmetic's BEHAVIOUR — counting down, going negative
  // when overdue, null for an unparseable stamp, and both sides of the 14-day
  // amber edge — is exercised against real values in
  // `cloudflare-worker/test/dsr_close_d168.test.ts`, which is the only place
  // it can actually fail.
  const SERVICE = read('cloudflare-worker/src/services/dsrRequests.ts');
  assert.match(SERVICE, /export const DSR_CLOCK_DAYS = 30;/,
    'the statutory clock is no longer 30 days, or no longer defined in the service');
  assert.doesNotMatch(ROUTE, /const DSR_CLOCK_DAYS\s*=/,
    'the route declares its own copy of the clock — two copies, and one of them will drift');
  assert.match(ROUTE, /days_left: dsrDaysLeft\(/,
    'the route computes days_left inline again, where no test can reach it');
  assert.match(PAGE, /d\.days_left === null \? <Unrecorded>clock unknown<\/Unrecorded>/);
});

test('every read is super-admin only and the write carries the impersonation bar plus a stored reason', () => {
  assert.doesNotMatch(ROUTE, /\brequireAdmin\b/);
  // WAS a hardcoded 2. That number is not the rule — the rule is that EVERY
  // handler in this file gates on the elevation — and a literal count fails
  // the moment a third handler is added correctly, which is what happened
  // when /governance landed. Counting handlers and gates and comparing them
  // says the actual thing and needs no edit next time.
  const handlers = ROUTE.match(/^r\.(get|post|put|patch|delete)\(/gm) || [];
  // D165 COUNTS BOTH DOORS TO THE ELEVATION, because there are now two and the
  // second is the stricter one. `requireSuperAdminWriteBar` ends in
  // `requireSuperAdmin` and adds a TOTP-minted session and a recent step-up in
  // front of it, so a handler taking the bar satisfies this rule MORE than one
  // taking the bare gate. Counting only the bare spelling would have made the
  // two revoke routes look ungated — the assertion failing on the consolidation
  // it should have been indifferent to.
  const gates = ROUTE.match(/await requireSuperAdmin(?:WriteBar)?\(c\)/g) || [];
  assert.ok(handlers.length >= 4, `expected at least four handlers, found ${handlers.length}`);
  assert.equal(gates.length, handlers.length, 'every handler gates on the elevation');

  // Bounded to the bulk handler's own body. It used to be a slice to END OF FILE,
  // and D165 put a second `/force-reauth` handler in this file — a slice past its
  // own handler can be satisfied by the next one, which is the D147/D161 failure.
  const bulkAt = ROUTE.indexOf("r.post('/force-reauth'");
  assert.ok(bulkAt > 0, 'the platform-wide revoke is no longer registered');
  const after = ROUTE.slice(bulkAt + 22);
  const nextRoute = /\nr\.(get|post|put|patch|delete)\(/.exec(after);
  const write = after.slice(0, nextRoute ? nextRoute.index : after.length);

  // THE THREE GATES MOVED, THEY DID NOT GO. This asserted `requireFactor` before
  // `requireStepUp` before `requireSuperAdmin` as adjacent text in this handler —
  // a fourth hand-rolled copy of `requireSuperAdminWriteBar`, which already
  // existed. The order is now asserted once where the bar is DEFINED
  // (`cloudflare-worker/test/super_admin.test.ts`), which covers all five callers
  // instead of this one; what belongs here is that this route takes it.
  assert.match(write, /await requireSuperAdminWriteBar\(c\)/, 'the bulk revoke must take the shared write bar');
  assert.match(write, /code: 'reason_required'/);
  assert.match(write, /UPDATE users SET jwt_min_iat = \? WHERE is_active = 1/, 'the per-account primitive, over every active account');
  assert.match(write, /'security_force_reauth'/, 'recorded in admin_audit_log');
  assert.ok(write.indexOf('logAdminAction') > write.indexOf('UPDATE users SET jwt_min_iat'),
    'audit after the action it records');
});

test('HQ can sign out ONE account, and the control is drawn only where it can run', () => {
  // The defect: the only revoke was `WHERE is_active = 1`, so signing out one
  // compromised admin meant signing out every account on every tenant.
  const oneAt = ROUTE.indexOf("r.post('/force-reauth/:userId'");
  assert.ok(oneAt > 0, 'the per-account revoke route is gone');
  assert.ok(oneAt < ROUTE.indexOf("r.post('/force-reauth'"),
    'the specific route must be registered before the general one, so the bulk handler\'s own '
    + 'assertions are not satisfied by this one\'s body');

  // The SPA half. The control lives on HQ · Team rather than here, because that
  // page is already one row per admin and already super-admin gated.
  const team = read('frontend/src/pages/hq/HqTeamTable.jsx');
  assert.match(team, /api\.hqForceReauthUser\(row\.user_id, reason\.trim\(\)\)/,
    'the row action does not reach the per-account route');
  assert.match(team, /reason\.trim\(\)\.length < 8/,
    'the reason floor the server enforces is not mirrored, so the button offers a refusal');

  // AND ONLY ON HQ-HELD ROWS. `bumpJwtMinIat` writes HQ's `users` table; a branch
  // admin's account lives in the branch's own database, so the same button on a
  // branch hit could only ever refuse. That is structural rather than a condition
  // — branch hits render as a list, not as AdminRow — and this pins it.
  assert.ok(!/hq-team-revoke[\s\S]{0,400}b\.data/.test(team),
    'a revoke control reached the branch group, where the route it calls cannot act');
});

test('the security router is mounted before the /api/admin catch-all', () => {
  const src = read('cloudflare-worker/src/index.ts');
  const mount = src.indexOf("app.route('/api/admin/security', adminSecurity)");
  assert.ok(mount > -1 && mount < src.indexOf("app.route('/api/admin', admin)"));
});

test('the audit zone reads every action, not the two the monitoring read allows', () => {
  assert.doesNotMatch(ROUTE, /ALLOWED_ACTIONS/, 'no action filter on the HQ audit read');
  assert.match(ROUTE, /FROM admin_audit_log a[\s\S]*?ORDER BY a\.exported_at DESC, a\.id DESC/);
});

test('no note asserts a security fact while the overview is unreadable', () => {
  // An apex audit on 2026-09-03 found two notes that read as facts under a
  // failed read: 'every admin enrolled' with no MFA figures, and a hardcoded
  // 'not run' for sanctions. An unreadable overview says so, in every zone.
  const src = codeOnly(read('frontend/src/pages/hq/SecurityPage.jsx'));
  assert.match(src, /note=\{withoutMfa === null \? 'unreadable' :/, 'MFA: unreadable before enrolled');
  // D200 — the sanctions note became a card of the store's own figures. The
  // property this assertion carried is unchanged: under a FAILED overview
  // read the card must not state anything — and the new trap is "Loading…",
  // which would say an answer is on its way. Both new cards take the page's
  // unreadable state and check it before they say they are loading.
  assert.match(src, /<Sanctions block=\{ready \? data\.sanctions : null\} unreadable=\{data === UNAVAILABLE\} \/>/,
    'sanctions: the card is not told when the overview failed');
  assert.match(src, /<BackupDr block=\{ready \? data\.backup_dr : null\} unreadable=\{data === UNAVAILABLE\} \/>/,
    'backup / DR: the card is not told when the overview failed');
  for (const fn of ['function Sanctions(', 'function BackupDr(']) {
    const at = src.indexOf(fn);
    assert.ok(at > 0, `${fn} is gone`);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    const guard = body.indexOf('if (!block)');
    assert.ok(guard > 0, `${fn} has no branch for a missing block`);
    const branch = body.slice(guard, body.indexOf('}', body.indexOf('return', guard)) + 1);
    assert.ok(/return unreadable\s*\?/.test(branch),
      `${fn} says "Loading…" under a failed read — the unreadable state must be checked first`);
  }
  // And when the store itself could not be read, the card says the server's reason.
  assert.match(src, /<Unrecorded \/> — \{block\.reason\}/, 'an unreadable sanctions store is not given its reason');
  // The rail's entries are [title, detail] pairs, the shape WorkerRail destructures.
  const m = /unavailable=\{\[([\s\S]*?)\]\}/.exec(src);
  assert.ok(m, 'the rail lists what is unavailable');
  for (const e of m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'))) {
    assert.ok(e.startsWith('['), `rail entry is a pair, not a string: ${e.slice(0, 50)}`);
  }
});

