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

test('Trust Center appears immediately below User Settings in the user dropdown', () => {
  const settingsIndex = app.indexOf('to="/settings"');
  const trustIndex = app.indexOf('to="/trust"');
  const supportIndex = app.indexOf('to="/tickets"');

  assert.ok(settingsIndex >= 0, 'User Settings menu item should exist');
  assert.ok(trustIndex > settingsIndex, 'Trust Center should follow User Settings');
  assert.ok(supportIndex > trustIndex, 'Trust Center should precede Support');
});