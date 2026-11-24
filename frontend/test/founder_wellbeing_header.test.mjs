import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('Wellness is surfaced in the header instead of the sidebar, and the heart opens Today (D7118 part 2)', () => {
  const sidebar = read('frontend/src/sidebarConfig.js');
  const app = read('frontend/src/App.jsx');
  const menu = read('frontend/src/components/FounderWellbeingMenu.jsx');

  assert.doesNotMatch(sidebar, /label:\s*['"]Founder Wellbeing['"]/);
  assert.match(app, /FounderWellbeingMenu/);
  assert.match(menu, /aria-label="Wellness: today’s check-in"/);
  assert.match(menu, /to="\/wellbeing"/);
  assert.match(menu, /wellbeingReflectionsApi\.today\(tz\)/);
  assert.match(menu, /Couldn’t load your check-in\./);
  assert.doesNotMatch(menu, />\s*More\s*</);
});