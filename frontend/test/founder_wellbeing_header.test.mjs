import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('Founder Wellbeing is surfaced in the header instead of the sidebar', () => {
  const sidebar = read('frontend/src/sidebarConfig.js');
  const app = read('frontend/src/App.jsx');
  const menu = read('frontend/src/components/FounderWellbeingMenu.jsx');

  assert.doesNotMatch(sidebar, /label:\s*['"]Founder Wellbeing['"]/);
  assert.match(app, /FounderWellbeingMenu/);
  assert.match(menu, /aria-label="Founder Wellbeing"/);
  assert.match(menu, /Today’s check-in/);
  assert.match(menu, /to="\/wellbeing"/);
  assert.match(menu, /wellbeingDaily\(1\)/);
  assert.doesNotMatch(menu, />\s*More\s*</);
});