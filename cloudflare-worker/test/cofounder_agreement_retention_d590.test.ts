/**
 * D590 (#1217) — Spin-Out Lab: /incorporate/cofounder-agreement is retained
 * (D352's stated default).
 *
 * Worker-side guard test pinning esignOriginators and frontend routing pointers.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/cofounder_agreement_retention_d590.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const ESIGN_ORIGINATORS = read('cloudflare-worker/src/services/esignOriginators.ts');
const APP = read('frontend/src/App.jsx');
const STARTUP_PAGE = read('frontend/src/pages/SpinoutLabStartupPage.jsx');

test('esignOriginators links NOT_OFFERED to standalone cofounder agreement path', () => {
  assert.match(
    ESIGN_ORIGINATORS,
    /path:\s*'\/incorporate\/cofounder-agreement',\s*label:\s*'Open the Co-founder Agreement'/,
  );
});

test('App.jsx retains both cofounder agreement routes with proper role gates', () => {
  assert.match(APP, /\/incorporate\/cofounder-agreement/);
  assert.match(APP, /\/spinout-lab\/cofounder-agreement/);
  assert.match(APP, /labRoles\(\['admin',\s*'founder',\s*'partner'\]\)/);
});

test('SpinoutLabStartupPage routes active Lab members to lab page and others to standalone wizard', () => {
  assert.match(STARTUP_PAGE, /export function cofounderAgreementRoute/);
  assert.match(STARTUP_PAGE, /spinout-lab\/cofounder-agreement/);
  assert.match(STARTUP_PAGE, /incorporate\/cofounder-agreement/);
});
