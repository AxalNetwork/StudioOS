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

test('the Security row is the seventh of eight, labelled Security, and /admin/security is HQ-only', () => {
  const rows = (SIDEBAR_GROUPS.super_admin || []).flatMap((g) => g.items || []);
  assert.equal(rows[6]?.label, 'Security', 'decision A4: Security, not Governance, between Support and Settings');
  assert.equal(rows[6]?.to, '/admin/security');
  const line = APP.split('\n').find((l) => l.includes('path="/admin/security"'));
  assert.ok(line, '/admin/security must be registered');
  assert.match(line, /hqOnly\(/, 'an admin without the elevation gets the notice');
});

test('the page reads one endpoint and writes through one, and nothing else', () => {
  const calls = [...new Set([...PAGE.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]))].sort();
  assert.deepEqual(calls, ['hqSecurityForceReauth', 'hqSecurityOverview']);
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
  assert.match(PAGE, /could not be read\. This is not a claim that nothing happened\./);
});

test('the deletion clock is statutory, computed server-side, and unknown when unparseable', () => {
  assert.match(ROUTE, /const DSR_CLOCK_DAYS = 30;/);
  assert.match(ROUTE, /days_left: elapsedDays === null \? null : DSR_CLOCK_DAYS - elapsedDays/);
  assert.match(PAGE, /d\.days_left === null \? <Unrecorded>clock unknown<\/Unrecorded>/);
});

test('every read is super-admin only and the write carries the impersonation bar plus a stored reason', () => {
  assert.doesNotMatch(ROUTE, /\brequireAdmin\b/);
  assert.equal((ROUTE.match(/await requireSuperAdmin\(c\)/g) || []).length, 2, 'both handlers gate on the elevation');
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

