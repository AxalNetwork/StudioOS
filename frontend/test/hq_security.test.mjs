/**
 * HQ · Security (canvas Y2) — four real zones, four named absences, one write.
 *
 * The canvas draws eight zones. The store answers four: the admin action
 * audit, sessions and impersonations, KYC, deletion-request clocks. The other
 * four — security events, AI safety, sanctions, backup and DR — have no store
 * and the page says so in their zones, never from the canvas's sample rows.
 * The one action, force re-auth, carries the impersonation write bar and a
 * stored reason. These pin that shape.
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

test('the page reads two endpoints and writes through one, and nothing else', () => {
  // WAS one read. Canvas H7's feed is a second: it is filtered server-side
  // over a merged page of sixty rows from four stores, so it cannot ride on
  // the overview payload and cannot be filtered in the browser. The point of
  // this assertion is unchanged — the page reaches for NOTHING else, and a
  // page that starts calling a fifth endpoint has grown a second job.
  const calls = [...new Set([...PAGE.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]))].sort();
  assert.deepEqual(calls, ['hqGovernance', 'hqSecurityForceReauth', 'hqSecurityOverview']);
});

test('the four zones with no store render Not recorded in their own zone, from the payload\'s reason', () => {
  for (const key of ['security_events', 'ai_safety', 'sanctions', 'backup_dr']) {
    assert.match(ROUTE, new RegExp(`${key}: absent\\(`), `${key} must come back { available: false, reason }`);
  }
  assert.match(PAGE, /<Absent block=\{ready \? data\.security_events : null\}/);
  assert.match(PAGE, /<Absent block=\{ready \? data\.ai_safety : null\}/);
  assert.match(PAGE, /<Absent block=\{ready \? data\.backup_dr : null\}/);
  assert.match(PAGE, /label="Sanctions review" value=\{null\}/);
  assert.match(PAGE, /label="Failed sign-ins" value=\{null\}/, 'no security_events means no failed-sign-in count');
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
  assert.match(ROUTE, /const DSR_CLOCK_DAYS = 30;/);
  assert.match(ROUTE, /days_left: elapsedDays === null \? null : DSR_CLOCK_DAYS - elapsedDays/);
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
  const gates = ROUTE.match(/await requireSuperAdmin\(c\)/g) || [];
  assert.ok(handlers.length >= 3, `expected at least three handlers, found ${handlers.length}`);
  assert.equal(gates.length, handlers.length, 'every handler gates on the elevation');
  const write = ROUTE.slice(ROUTE.indexOf("r.post('/force-reauth'"));
  assert.ok(write.indexOf("requireFactor(c, 'totp')") < write.indexOf('requireStepUp(c)'), 'factor before step-up');
  assert.ok(write.indexOf('requireStepUp(c)') < write.indexOf('requireSuperAdmin(c)'), 'step-up before the elevation');
  assert.match(write, /code: 'reason_required'/);
  assert.match(write, /UPDATE users SET jwt_min_iat = \? WHERE is_active = 1/, 'the per-account primitive, over every active account');
  assert.match(write, /'security_force_reauth'/, 'recorded in admin_audit_log');
  assert.ok(write.indexOf('INSERT INTO admin_audit_log') > write.indexOf('UPDATE users SET jwt_min_iat'), 'audit after the action it records');
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
  assert.match(src, /label="Sanctions review" value=\{null\} note=\{ready \? \(data\.sanctions\?\.reason \|\| 'not recorded'\) : 'unreadable'\}/,
    'sanctions: the payload reason when read, unreadable when not, never a hardcoded state');
  // The rail's entries are [title, detail] pairs, the shape WorkerRail destructures.
  const m = /unavailable=\{\[([\s\S]*?)\]\}/.exec(src);
  assert.ok(m, 'the rail lists what is unavailable');
  for (const e of m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'))) {
    assert.ok(e.startsWith('['), `rail entry is a pair, not a string: ${e.slice(0, 50)}`);
  }
});

