import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('the standalone Spin-Outs page is no longer routable or surfaced in navigation', () => {
  const app = read('frontend/src/App.jsx');
  const sidebar = read('frontend/src/sidebarConfig.js');
  const personas = read('cloudflare-worker/src/personas.ts');

  assert.doesNotMatch(app, /SpinOutsPage|path="\/spinouts"|path="\/spin-outs"/);
  assert.doesNotMatch(sidebar, /to:\s*['"]\/spin-?outs['"]/);
  assert.doesNotMatch(personas, /to:\s*['"]\/spinouts['"]/);
});

test('Spin-Out Lab routes remain available', () => {
  const app = read('frontend/src/App.jsx');
  const sidebar = read('frontend/src/sidebarConfig.js');

  assert.match(app, /\/spinout-lab/);
  assert.match(sidebar, /\/spinout-lab/);
});