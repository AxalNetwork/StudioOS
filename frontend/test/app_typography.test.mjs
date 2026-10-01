/**
 * One type face for the signed-in product.
 *
 * The investor Fund page (/funds) set Space Grotesk on its own root, the
 * founder desks set Inter on theirs, and the Studio homes mixed the sans and
 * display tokens, so the same product changed face from page to page. The
 * face is now one token, --font-app, applied to every signed-in surface
 * through `html.app-type`, which ProtectedLayout sets. The public site keeps
 * --font-sans (Inter) and never sets the class.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith('.css')) out.push(full);
  }
  return out;
}

test('the app face is Space Grotesk, and the public face stays Inter', () => {
  const css = read('index.css');
  assert.match(css, /--font-app:\s*'Space Grotesk'/);
  assert.match(css, /--font-sans:\s*'Inter'/, 'the public site keeps Inter');
  assert.match(css, /html\.app-type body\s*\{\s*font-family:\s*var\(--font-app\);/);
});

test('the signed-in shell sets the class on <html>, and takes it off again', () => {
  const app = read('App.jsx');
  const shell = app.slice(app.indexOf('function ProtectedLayout('), app.indexOf('function RequireAuth('));
  assert.match(shell, /useLayoutEffect\(\(\) => \{\s*document\.documentElement\.classList\.add\('app-type'\);\s*return \(\) => document\.documentElement\.classList\.remove\('app-type'\);/);
  assert.doesNotMatch(read('pages/LandingPage.jsx'), /app-type/, 'the front page must not opt in');
});

test('no page stylesheet sets its own face', () => {
  const bad = [];
  for (const file of cssFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel === 'index.css') continue;
    for (const [decl] of readFileSync(file, 'utf8').matchAll(/font-family:[^;}]+/g)) {
      if (!/var\(--font-(app|mono)\)|inherit/.test(decl)) bad.push(`${rel}: ${decl}`);
    }
  }
  assert.deepEqual(bad, [], 'use var(--font-app) for text and var(--font-mono) for labels');
});
