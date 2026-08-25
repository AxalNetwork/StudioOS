import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'frontend/src');
const sidebar = readFileSync(resolve(root, 'sidebarConfig.js'), 'utf8');
const app = readFileSync(resolve(root, 'App.jsx'), 'utf8');

test('Trust Center is not present in any sidebar configuration', () => {
  assert.doesNotMatch(sidebar, /label:\s*['"]Trust(?: & Identity)?['"]/);
  assert.doesNotMatch(sidebar, /to:\s*['"]\/trust['"]/);
});

test('Trust Center appears immediately below User Settings in the user dropdown', () => {
  const settingsIndex = app.indexOf('to="/settings"');
  const trustIndex = app.indexOf('to="/trust"');
  const supportIndex = app.indexOf('to="/tickets"');

  assert.ok(settingsIndex >= 0, 'User Settings menu item should exist');
  assert.ok(trustIndex > settingsIndex, 'Trust Center should follow User Settings');
  assert.ok(supportIndex > trustIndex, 'Trust Center should precede Support');
});