import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'frontend/src');
const sidebar = readFileSync(resolve(root, 'sidebarConfig.js'), 'utf8');
const app = readFileSync(resolve(root, 'App.jsx'), 'utf8');

test('Trust Center is present only in the investor sidebar', () => {
  const investorStart = sidebar.indexOf('\n  investor: [');
  const advisorStart = sidebar.indexOf('\n  advisor: [');
  const investor = sidebar.slice(investorStart, advisorStart);
  const otherRoles = sidebar.slice(0, investorStart) + sidebar.slice(advisorStart);

  assert.match(investor, /to:\s*['"]\/trust['"][^}]*label:\s*['"]Trust['"]/);
  assert.doesNotMatch(otherRoles, /label:\s*['"]Trust(?: & Identity)?['"]/);
  assert.doesNotMatch(otherRoles, /to:\s*['"]\/trust['"]/);
});

test('Trust Center appears immediately below Account in the user dropdown', () => {
  // Was `to="/settings"` / `to="/tickets"` until User Settings became Account
  // and the Support Hub became the Help Center. Both old paths survive in
  // App.jsx as redirect ROUTES (`path="/settings"`, `path="/tickets"`), which
  // is why these read `to=`: a `to=` is a menu link, a `path=` is a route, and
  // matching the wrong one would make this pass on a menu that no longer has
  // the item.
  const accountIndex = app.indexOf('to="/account"');
  const trustIndex = app.indexOf('to="/trust"');
  const helpIndex = app.indexOf('to="/help"');

  assert.ok(accountIndex >= 0, 'Account menu item should exist');
  assert.ok(trustIndex > accountIndex, 'Trust Center should follow Account');
  assert.ok(helpIndex > trustIndex, 'Trust Center should precede the Help Center');
});

test('Perks is in the dropdown for founders and partners, and nobody else', () => {
  // The only role-conditional entry in this menu. Everything else relies on
  // its route guard, so this asymmetry is worth pinning: the point is that the
  // INVITATION narrows while the page does not.
  const menu = app.slice(app.indexOf('function UserDropdown'), app.indexOf('function PortalSwitcher'));
  assert.match(menu, /\['founder', 'partner', 'admin'\]\.includes\(user\?\.role\)/,
    'the Perks entry must be gated on the role, not shown to everyone');
  const gate = menu.indexOf("].includes(user?.role)");
  const perks = menu.indexOf('to="/perks"');
  assert.ok(perks > gate && perks - gate < 400,
    'the gate must wrap the Perks link, not sit somewhere else in the menu');
});

test('the /perks route itself is NOT narrowed to those three roles', () => {
  // The catalogue is a marketplace an investor or advisor may legitimately
  // browse; only the menu entry narrows. If someone "tidies up" by matching
  // the guard to the menu, this fails.
  const route = app.slice(app.indexOf('path="/perks"'), app.indexOf('path="/perks"') + 400);
  for (const role of ['founder', 'partner', 'investor', 'advisor', 'exploring']) {
    assert.ok(route.includes(`'${role}'`), `/perks must stay reachable by ${role}`);
  }
});