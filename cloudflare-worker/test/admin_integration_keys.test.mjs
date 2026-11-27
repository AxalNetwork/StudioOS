/**
 * Task #3 — Admin Integration Keys: rotate + test endpoint shape checks.
 *
 * These are pure-function unit tests over the provider OAuth probe
 * classifier (services/providerOauthTest.ts). The full route surface
 * is covered by the Playwright smoke + AP drift suite; we exercise
 * the only piece of non-trivial logic here (provider error → ok/fail
 * classification) without touching the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { transpileTs } from './_transpile-ts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadClassifier() {
  const srcPath = resolve(__dirname, '../src/services/providerOauthTest.ts');
  const src = await readFile(srcPath, 'utf8');
  // Slice out the two SETs + classify(). They're declared at module
  // scope with no inter-deps so we can lift them as a unit.
  const startMarkers = ['const CLIENT_ERRORS', 'const GRANT_ERRORS', 'function classify'];
  const pieces = startMarkers.map((m) => {
    const i = src.indexOf(m);
    assert.notEqual(i, -1, `${m} not found`);
    // brace/paren balanced extraction by scanning to first `;` after
    // matching close. CLIENT_ERRORS / GRANT_ERRORS end at `]);`,
    // classify() ends at the matching `}`.
    if (m.startsWith('const ')) {
      const end = src.indexOf(']);', i) + 3;
      return src.slice(i, end);
    }
    let j = src.indexOf('{', i);
    let depth = 0;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(i, j);
  });
  const tsBody = pieces.join('\n');
  const wrapped = `const __out = (() => { ${tsBody}; return { classify, CLIENT_ERRORS, GRANT_ERRORS }; })();`;
  const outputText = transpileTs(wrapped);
  return new Function(`${outputText}; return __out;`)();
}

test('classify: invalid_client → fail', async () => {
  const { classify } = await loadClassifier();
  assert.equal(classify('invalid_client', 401), false);
  assert.equal(classify('invalid_client_id', 400), false);
  assert.equal(classify('unauthorized_client', 401), false);
});

test('classify: invalid_grant / invalid_code → pass (creds accepted)', async () => {
  const { classify } = await loadClassifier();
  assert.equal(classify('invalid_grant', 400), true);
  assert.equal(classify('invalid_code', 400), true);
  assert.equal(classify('bad_verification_code', 400), true);
  assert.equal(classify('redirect_uri_mismatch', 400), true);
});

test('classify: 401 with no provider error → fail (likely creds rejected)', async () => {
  const { classify } = await loadClassifier();
  assert.equal(classify(null, 401), false);
  assert.equal(classify('', 401), false);
});

test('classify: 5xx → fail (provider broken)', async () => {
  const { classify } = await loadClassifier();
  assert.equal(classify(null, 500), false);
  assert.equal(classify('', 503), false);
});

test('classify: 4xx (non-401) with no error → pass (creds reached provider)', async () => {
  const { classify } = await loadClassifier();
  assert.equal(classify(null, 400), true);
  assert.equal(classify(null, 422), true);
});
