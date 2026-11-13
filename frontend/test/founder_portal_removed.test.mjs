import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'frontend/src');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('the retired Founder Portal has no route, sidebar entry, or persona quick link', () => {
  const app = read('App.jsx');
  const sidebar = read('sidebarConfig.js');
  const personas = read('lib/personas.js');

  assert.doesNotMatch(app, /FounderPortal/);
  assert.doesNotMatch(app, /path="\/founder"/);
  assert.doesNotMatch(sidebar, /Founder Portal/);
  assert.doesNotMatch(sidebar, /\{\s*to:\s*'\/founder'/);
  assert.doesNotMatch(personas, /Founder Portal/);
  assert.doesNotMatch(personas, /to:\s*'\/founder'/);
});

test('incorporated founders continue from onboarding to Studio', () => {
  const onboarding = read('pages/OnboardingFounderPage.jsx');
  assert.match(onboarding, /navigate\('\/studio'/);
  assert.match(onboarding, /Continue to Studio/);
});