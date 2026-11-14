/**
 * #5972 (part of #5506): CI installs from the lockfile and nothing else.
 *
 * Four workflow steps used to install root dependencies with
 * `npm ci || npm install --no-audit --no-fund`. When the lockfile was out of
 * step with package.json, `npm ci` failed and the fallback quietly resolved a
 * fresh tree, so CI tested dependencies nobody had committed. A clean `npm ci`
 * at the root was proven on main 4efcdba67b (Node 22.22.0, npm 10.9.4, exit 0)
 * before the fallback was removed.
 *
 * This guard reads every workflow as text and fails on:
 *   1. any `npm ci ||` — a fallback around the lockfile install;
 *   2. a bare `npm install` / `npm i` (no package names, not global) run in a
 *      directory that has a package-lock.json — that directory must use
 *      `npm ci`.
 * A global tool install (`npm i -g wrangler@latest`) or adding a named package
 * is not a lockfile install and is left alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const WF_DIR = join(root, '.github', 'workflows');

const workflows = () =>
  readdirSync(WF_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: `.github/workflows/${f}`, src: readFileSync(join(WF_DIR, f), 'utf8') }));

const isComment = (line) => line.trimStart().startsWith('#');
const STEP_START = /^\s*-\s+(name|uses|run|id|if|working-directory|with|env|shell):/;

/** The `working-directory:` of the step that holds line `i`, or '.' when none. */
function stepDirectory(lines, i) {
  const indentOf = (l) => l.length - l.trimStart().length;
  // Walk back to the step's first line (`- name:` / `- run:` …).
  let start = i;
  while (start > 0 && !STEP_START.test(lines[start])) start -= 1;
  const stepIndent = indentOf(lines[start]);
  for (let j = start; j < lines.length; j += 1) {
    if (j > start && STEP_START.test(lines[j]) && indentOf(lines[j]) <= stepIndent) break;
    const m = /^\s*working-directory:\s*['"]?([^'"#\s]+)/.exec(lines[j]);
    if (m) return m[1];
  }
  return '.';
}

/** Every bare lockfile-bypassing install in `src`: [{ line, dir, text }]. */
function bareInstalls(src) {
  const lines = src.split('\n');
  const found = [];
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    for (const cmd of line.split(/&&|;|\|\|/)) {
      const m = /\bnpm\s+(install|i)\b(.*)$/.exec(cmd);
      if (!m) continue;
      const args = m[2].trim().split(/\s+/).filter(Boolean);
      if (args.some((a) => a === '-g' || a === '--global')) continue;
      if (args.some((a) => !a.startsWith('-'))) continue; // a named package
      const cd = /\bcd\s+['"]?([^'"\s&;]+)/.exec(line);
      const dir = cd ? cd[1] : stepDirectory(lines, i);
      found.push({ line: i + 1, dir, text: line.trim() });
    }
  });
  return found;
}

/** Every `npm ci ||` fallback in `src`: [{ line, text }]. */
function ciFallbacks(src) {
  return src
    .split('\n')
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter(({ text }) => !text.startsWith('#') && /\bnpm\s+ci\b[^|\n]*\|\|/.test(text));
}

test('no workflow wraps npm ci in a fallback', () => {
  const hits = workflows().flatMap(({ file, src }) =>
    ciFallbacks(src).map((h) => `${file}:${h.line}: ${h.text}`),
  );
  assert.deepEqual(hits, [], 'install from the lockfile with plain `npm ci`; fix the lockfile instead of installing around it');
});

test('no workflow runs a bare npm install where a lockfile exists', () => {
  const hits = workflows().flatMap(({ file, src }) =>
    bareInstalls(src)
      .filter((h) => existsSync(join(root, h.dir, 'package-lock.json')))
      .map((h) => `${file}:${h.line} (${h.dir}): ${h.text}`),
  );
  assert.deepEqual(hits, [], 'use `npm ci` in a directory that has a package-lock.json');
});

test('the four steps #5972 named now run npm ci only', () => {
  for (const file of ['ci.yml', 'copilot-setup-steps.yml', 'github-alerts.yml', 'runner-benchmark.yml']) {
    const src = readFileSync(join(WF_DIR, file), 'utf8');
    const lines = src.split('\n');
    const i = lines.findIndex((l) => /-\s+name:\s*Install root deps\s*$/.test(l));
    assert.ok(i >= 0, `${file} has an "Install root deps" step`);
    assert.match(lines[i + 1], /^\s*run:\s*npm ci\s*$/, `${file}: "Install root deps" runs exactly \`npm ci\``);
  }
});

test('the detectors see the shapes they exist for', () => {
  assert.equal(ciFallbacks('      run: npm ci || npm install --no-audit --no-fund').length, 1);
  assert.equal(ciFallbacks('      run: npm ci').length, 0);
  assert.equal(ciFallbacks('      # npm ci || npm install').length, 0);
  const step = (body) => `    steps:\n      - name: x\n${body}`;
  assert.deepEqual(
    bareInstalls(step('        working-directory: frontend\n        run: npm install')).map((h) => h.dir),
    ['frontend'],
  );
  assert.deepEqual(bareInstalls(step('        run: cd meeting-bot && npm i --no-audit')).map((h) => h.dir), ['meeting-bot']);
  assert.equal(bareInstalls(step('        run: npm i -g wrangler@latest')).length, 0);
  assert.equal(bareInstalls(step('        run: npm install left-pad')).length, 0);
  assert.equal(bareInstalls(step('        run: npm ci')).length, 0);
});
