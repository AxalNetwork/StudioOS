/**
 * D230 — Analytics Engine read gate by branch environment.
 *
 * Branches share the Analytics Engine dataset but cannot read it. aeReadable()
 * returns false on branch deployments and true on HQ with credentials present.
 * This guards against branch environments bypassing the intent that only HQ
 * reads analytics data.
 *
 * Run with: node --test cloudflare-worker/test/analytics-branch-readable.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { transpileTs } from './_transpile-ts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadAeReadable() {
  const reportsSrc = await readFile(
    resolve(__dirname, '../src/services/analyticsReports.ts'),
    'utf8',
  );
  const branchSrc = await readFile(
    resolve(__dirname, '../src/util/branch.ts'),
    'utf8',
  );

  // Extract aeReadable and branchOf functions
  function extractFn(src, name) {
    const start = src.indexOf(`export function ${name}`);
    assert.notEqual(start, -1, `${name} not found`);
    let j = src.indexOf('(', start);
    for (let pd = 0; j < src.length; j++) {
      if (src[j] === '(') pd++;
      else if (src[j] === ')') { pd--; if (pd === 0) { j++; break; } }
    }
    let i = src.indexOf('{', j), depth = 0, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return src.slice(start, end).replace(/^export\s+/, '');
  }

  const branchOfFn = extractFn(branchSrc, 'branchOf');
  const aeReadableFn = extractFn(reportsSrc, 'aeReadable');
  const branchCodeRe = branchSrc.match(/BRANCH_CODE_RE = [^;]+;/)[0];

  const tsBody = `
    type Env = { BRANCH_CODE?: string; CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_AE_API_TOKEN?: string; };
    ${branchCodeRe}
    ${branchOfFn}
    ${aeReadableFn}
  `;
  const wrapped = `const __out = (() => { ${tsBody}; return { aeReadable, branchOf }; })();`;
  const outputText = transpileTs(wrapped);
  return new Function(`${outputText}; return __out;`)();
}

test('HQ with both credentials set → aeReadable returns true', async () => {
  const { aeReadable } = await loadAeReadable();
  const env = {
    CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
    CLOUDFLARE_AE_API_TOKEN: 'test-token',
  };
  assert.equal(aeReadable(env), true);
});

test('HQ with missing CLOUDFLARE_ACCOUNT_ID → aeReadable returns false', async () => {
  const { aeReadable } = await loadAeReadable();
  const env = {
    CLOUDFLARE_AE_API_TOKEN: 'test-token',
  };
  assert.equal(aeReadable(env), false);
});

test('HQ with missing CLOUDFLARE_AE_API_TOKEN → aeReadable returns false', async () => {
  const { aeReadable } = await loadAeReadable();
  const env = {
    CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
  };
  assert.equal(aeReadable(env), false);
});

test('Branch with both credentials set → aeReadable returns false (D230)', async () => {
  const { aeReadable } = await loadAeReadable();
  const env = {
    BRANCH_CODE: 'demo',
    CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
    CLOUDFLARE_AE_API_TOKEN: 'test-token',
  };
  assert.equal(aeReadable(env), false,
    'branch deployments must not read Analytics Engine even with credentials');
});

test('Branch with no credentials → aeReadable returns false', async () => {
  const { aeReadable } = await loadAeReadable();
  const env = {
    BRANCH_CODE: 'demo',
  };
  assert.equal(aeReadable(env), false);
});
