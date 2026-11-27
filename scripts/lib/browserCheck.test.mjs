// #9038: the browser checks' launch plan — PW_CHROMIUM_PATH first, and in CI a missing Playwright or browser fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SANDBOX_CHROMIUM, browserPlan, inCI, launchFailure } from './browserCheck.mjs';

const name = 'check-example';
const none = () => false;
const only = (...paths) => (p) => paths.includes(p);

test('CI is any non-empty value but false and 0', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes']) assert.equal(inCI({ CI: v }), true, v);
  for (const v of [undefined, '', 'false', '0', ' ']) assert.equal(inCI({ CI: v }), false, String(v));
});

test('without Playwright the check skips off CI and fails in CI', () => {
  assert.deepEqual(browserPlan({ env: {}, exists: none, playwright: false, name }),
    { action: 'skip', message: 'check-example: SKIPPED — @playwright/test is not installed.' });
  const ci = browserPlan({ env: { CI: '1' }, exists: none, playwright: false, name });
  assert.equal(ci.action, 'fail');
  assert.match(ci.message, /^check-example: FAILED — @playwright\/test is not installed/);
  assert.doesNotMatch(ci.message, /SKIPPED/);
});

test('PW_CHROMIUM_PATH wins over the sandbox pin, and a pin that names no file fails', () => {
  const pinned = '/ms-playwright/chromium-1194/chrome-linux/chrome';
  assert.deepEqual(browserPlan({ env: { PW_CHROMIUM_PATH: pinned }, exists: only(pinned, SANDBOX_CHROMIUM), playwright: true, name }),
    { action: 'run', executablePath: pinned });
  for (const env of [{ PW_CHROMIUM_PATH: pinned }, { PW_CHROMIUM_PATH: pinned, CI: '1' }]) {
    const plan = browserPlan({ env, exists: only(SANDBOX_CHROMIUM), playwright: true, name });
    assert.equal(plan.action, 'fail', 'never falls back to another browser');
    assert.match(plan.message, /PW_CHROMIUM_PATH names \/ms-playwright\/chromium-1194\/chrome-linux\/chrome, which does not exist/);
  }
});

test('with no pin the sandbox browser is used if present, else Playwright’s own', () => {
  assert.deepEqual(browserPlan({ env: {}, exists: only(SANDBOX_CHROMIUM), playwright: true, name }), { action: 'run', executablePath: SANDBOX_CHROMIUM });
  assert.deepEqual(browserPlan({ env: { CI: '1' }, exists: none, playwright: true, name }), { action: 'run', executablePath: null });
});

test('a launch failure is exit 1 with the first line of the error', () => {
  assert.deepEqual(launchFailure(name, new Error("Executable doesn't exist at /x\nmore")),
    { message: "check-example: FAILED — Chromium did not launch (Executable doesn't exist at /x).", code: 1 });
});

test('both browser checks plan through this module and exit non-zero on a failed launch', () => {
  for (const script of ['check-workspace-frames', 'check-reload-loop']) {
    const src = readFileSync(new URL(`../${script}.mjs`, import.meta.url), 'utf8');
    assert.match(src, new RegExp(`browserPlan\\(\\{ env: process\\.env, exists: existsSync, playwright: !!chromium, name: '${script}' \\}\\)`), script);
    assert.match(src, /process\.exit\(plan\.action === 'fail' \? 1 : 0\)/, script);
    assert.match(src, new RegExp(`launchFailure\\('${script}', error\\)`), script);
    assert.doesNotMatch(src, /SKIPPED[^\n]*\n[^\n]*process\.exit\(0\)/, `${script} keeps no unconditional skip`);
  }
  // The reload check's other skip, a service worker that never took control, fails in CI as well.
  const reload = readFileSync(new URL('../check-reload-loop.mjs', import.meta.url), 'utf8');
  assert.match(reload, /const ci = inCI\(process\.env\);[\s\S]{0,200}never took control here[\s\S]{0,80}process\.exit\(ci \? 1 : 0\)/);
});
