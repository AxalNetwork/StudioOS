/**
 * D940 (#2745) — SHL7a, the HQ-only card, and SHL7b, the card a member who is
 * not an admin sees on an `/admin` page instead of a silent redirect: their
 * words, who sees SHL7b, both cards rendered, and RoleGuard's branch.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_refusal_d940.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import SuperAdminOnlyNotice from '../src/pages/hq/SuperAdminOnlyNotice.jsx';
import AdminOnlyNotice from '../src/pages/hq/AdminOnlyNotice.jsx';
import {
  ADMIN_HOME_LABEL, ADMIN_LINE, ADMIN_TITLE, HQ_EYEBROW, HQ_LINKS, HQ_TITLE, adminRefusal, hqLine,
} from '../src/pages/hq/hqNoticeModel.js';

const h = React.createElement;
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const count = (html, re) => (html.match(re) || []).length;

test('SHL7a: the canvas\'s words, the subject named by the page, and Studio and My licence; never the Admin Console', () => {
  assert.equal(HQ_EYEBROW, 'HQ only');
  assert.equal(HQ_TITLE, 'This page belongs to the Super Admin');
  assert.equal(hqLine('/admin/funds'), 'HQ manages bank accounts. You are signed in as a studio admin, so this page stays closed rather than opening and refusing each action.');
  assert.equal(hqLine('/admin/funds/transfers'), hqLine('/admin/funds'));
  assert.equal(hqLine('/admin/licences'), 'HQ manages this page. You are signed in as a studio admin, so this page stays closed rather than opening and refusing each action.');
  assert.equal(hqLine('/admin/fundsx'), hqLine('/admin/licences'), 'only Funds itself names bank accounts');
  assert.deepEqual(HQ_LINKS.map((l) => [l.label, l.href]), [['Go to Studio', '/studio'], ['My licence', '/admin/my-licence']]);
  const html = at('/admin/funds', h(SuperAdminOnlyNotice));
  assert.ok(html.includes('data-testid="super-admin-only-notice"'));
  assert.ok(html.includes('HQ manages bank accounts.'));
  assert.ok(html.includes('href="/studio"') && html.includes('href="/admin/my-licence"'));
  assert.ok(!html.includes('Admin Console') && !html.includes('href="/admin"'), 'no Admin Console link');
  assert.equal(count(html, /<h1\b/g), 1, 'one h1');
  assert.ok(html.includes('border-dashed') && html.includes('dark:bg-gray-900'), 'the dashed card, light and dark');
});

test('SHL7b: the words, a link to the member\'s own home, one h1, and no dialog to trap focus', () => {
  assert.equal(ADMIN_TITLE, 'This page is for studio admins');
  assert.equal(ADMIN_LINE, 'If you run a studio, ask HQ for admin access.');
  assert.equal(ADMIN_HOME_LABEL, 'Go to your home');
  const html = at('/admin/spinout-lab', h(AdminOnlyNotice, { home: '/exploring' }));
  assert.ok(html.includes('data-testid="admin-only-notice"'));
  assert.ok(html.includes(ADMIN_TITLE) && html.includes(ADMIN_LINE));
  assert.ok(html.includes('href="/exploring"'), 'their own home');
  assert.equal(count(html, /<h1\b/g), 1);
  assert.ok(!/role="dialog"|aria-modal/.test(html), 'a card in the page, not a dialog');
  assert.ok(at('/admin', h(AdminOnlyNotice)).includes('href="/studio"'), 'the default home');
});

test('who sees SHL7b: a member who is not an admin on an /admin page; never an admin previewing or impersonating, nor any other route', () => {
  for (const role of ['founder', 'investor', 'partner', 'advisor', 'exploring']) {
    assert.equal(adminRefusal({ pathname: '/admin/kyc', realRole: role, isImpersonating: false }), true, role);
  }
  assert.equal(adminRefusal({ pathname: '/admin', realRole: 'founder', isImpersonating: false }), true, 'the console itself');
  assert.equal(adminRefusal({ pathname: '/admin/kyc', realRole: 'admin', isImpersonating: false }), false, 'View as keeps its redirect');
  assert.equal(adminRefusal({ pathname: '/admin/spinout-lab', realRole: 'founder', isImpersonating: true }), false, 'impersonation keeps its handoff');
  assert.equal(adminRefusal({ pathname: '/administer', realRole: 'founder', isImpersonating: false }), false);
  assert.equal(adminRefusal({ pathname: '/raise/pitch', realRole: 'investor', isImpersonating: false }), false, 'other guarded routes keep today\'s behaviour');
  assert.equal(adminRefusal({ pathname: '/admin/kyc', realRole: null, isImpersonating: false }), false);
});

test('the wiring: RoleGuard draws SHL7b after the impersonation handoff is read and before its redirect; hqOnly still draws SHL7a', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  const guard = app.slice(app.indexOf('function RoleGuard('), app.indexOf('function AuthScreen('));
  const refusal = guard.indexOf("if (adminRefusal({ pathname, realRole: (realUser || user)?.role, isImpersonating })) {");
  assert.ok(refusal > 0);
  const boundary = guard.indexOf('if (boundary) return <boundary.Panel home={defaultPath} />;');
  assert.ok(boundary >= 0 && boundary < refusal, 'a route boundary still comes first');
  assert.ok(guard.indexOf('const pendingTarget =') < refusal && refusal < guard.indexOf('<Navigate to={defaultPath} replace />'));
  assert.match(guard, /return <AdminOnlyNotice home=\{ROLE_DEFAULT_PATH\[effectiveRole\] \|\| '\/studio'\} \/>;/);
  assert.match(app, /const hqOnly = \(component\) => \(\s*isSuperAdminUser\(user\) \? component : <SuperAdminOnlyNotice \/>/);
});
