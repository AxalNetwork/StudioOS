/**
 * Sanctions matcher — pure-function unit tests.
 *
 * Covers the positive + negative cases that gate `screenUser`:
 *   1. exact-name + exact-DOB              → severity will become `block`
 *   2. typo within Levenshtein 2           → still hits (review)
 *   3. clearly different name              → no hit
 *   4. same name but conflicting DOB       → suppressed (no hit)
 *   5. alias match                         → hit on alias name
 *   6. diacritic-insensitive normalisation → hits
 *
 * Drives the EXACT source bytes that ship to Cloudflare via the same
 * type-erasure + new-Function pattern used by the other worker test files
 * (see `trust_intro.test.mjs` and `_transpile-ts.mjs`).
 *
 * Run with: node --test cloudflare-worker/test/sanctions_match.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { transpileTs } from './_transpile-ts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMatcher() {
  const srcPath = resolve(__dirname, '../src/services/sanctions.ts');
  const src = await readFile(srcPath, 'utf8');
  // Slice out the three pure functions: normalizeName, levenshtein,
  // fuzzyMatchEntities. They appear in that order with no inter-deps
  // beyond what's defined inline. We grab from the first to the end of
  // fuzzyMatchEntities by brace-balancing.
  function sliceFn(name) {
    const sig = `export function ${name}`;
    const start = src.indexOf(sig);
    assert.notEqual(start, -1, `${name} not found`);
    // Skip past the parameter list — params can contain `{` for
    // destructuring + default values, which would otherwise fool a
    // naive brace-balancer.
    let parenDepth = 0, j = src.indexOf('(', start);
    for (; j < src.length; j++) {
      if (src[j] === '(') parenDepth++;
      else if (src[j] === ')') { parenDepth--; if (parenDepth === 0) { j++; break; } }
    }
    let i = src.indexOf('{', j), depth = 0, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return src.slice(start, end).replace(/^export\s+/, '');
  }
  const tsBody = `${sliceFn('normalizeName')}\n${sliceFn('levenshtein')}\n${sliceFn('fuzzyMatchEntities')}`;
  const wrapped = `const __out = (() => { ${tsBody}; return { normalizeName, levenshtein, fuzzyMatchEntities }; })();`;
  const outputText = transpileTs(wrapped);
  return new Function(`${outputText}; return __out;`)();
}

const ENTITIES = [
  { source: 'ofac',   name: 'ivan ivanov',     aliases: ['vanya ivanov'], dob: '1970-05-12', nationality: 'RU', ref: 'OFAC-1' },
  { source: 'eu',     name: 'maria gonzalez',  aliases: [],               dob: '1985-09-30', nationality: 'ES', ref: 'EU-2' },
  { source: 'uk_hmt', name: 'mohammed al saud', aliases: [],              dob: null,         nationality: 'SA', ref: 'UK-3' },
];

test('positive: exact name + exact DOB matches', async () => {
  const { fuzzyMatchEntities } = await loadMatcher();
  const hits = fuzzyMatchEntities(
    { full_legal_name: 'Ivan Ivanov', date_of_birth: '1970-05-12', nationality: 'RU' },
    ENTITIES,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ref, 'OFAC-1');
  assert.ok(hits[0].reasons.includes('name_exact'));
  assert.ok(hits[0].reasons.includes('dob_exact'));
  assert.ok(hits[0].reasons.includes('nationality_match'));
  assert.equal(hits[0].score, 1);
});

test('positive: single-character typo within Levenshtein 2 still matches', async () => {
  const { fuzzyMatchEntities } = await loadMatcher();
  const hits = fuzzyMatchEntities(
    { full_legal_name: 'Ivan Ivanof', date_of_birth: '1970-05-12' }, // typo: f vs v
    ENTITIES,
  );
  assert.equal(hits.length, 1);
  assert.ok(hits[0].reasons.some(r => r.startsWith('name_levenshtein_')));
  assert.ok(hits[0].reasons.includes('dob_exact'));
});

test('positive: alias match (vanya → ivan)', async () => {
  const { fuzzyMatchEntities } = await loadMatcher();
  const hits = fuzzyMatchEntities(
    { full_legal_name: 'Vanya Ivanov', date_of_birth: '1970-05-12' },
    ENTITIES,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].matched_name, 'vanya ivanov');
});

test('positive: diacritic-insensitive normalisation', async () => {
  const { fuzzyMatchEntities } = await loadMatcher();
  const hits = fuzzyMatchEntities(
    { full_legal_name: 'María González', date_of_birth: '1985-09-30' },
    ENTITIES,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ref, 'EU-2');
});

test('negative: clearly different name produces no hit', async () => {
  const { fuzzyMatchEntities } = await loadMatcher();
  const hits = fuzzyMatchEntities(
    { full_legal_name: 'Jane Smith', date_of_birth: '1990-01-01', nationality: 'US' },
    ENTITIES,
  );
  assert.equal(hits.length, 0);
});

test('negative: name fuzzy-matches but DOB conflicts → suppressed', async () => {
  const { fuzzyMatchEntities } = await loadMatcher();
  const hits = fuzzyMatchEntities(
    { full_legal_name: 'Ivan Ivanof', date_of_birth: '1980-01-01' }, // wrong DOB
    ENTITIES,
  );
  assert.equal(hits.length, 0,
    'fuzzy name + DOB-mismatch must not promote a hit');
});

test('negative: empty subject name returns no hits', async () => {
  const { fuzzyMatchEntities } = await loadMatcher();
  assert.deepEqual(
    fuzzyMatchEntities({ full_legal_name: '   ' }, ENTITIES),
    [],
  );
});

test('exact name + missing DOB on entity still surfaces for review', async () => {
  const { fuzzyMatchEntities } = await loadMatcher();
  const hits = fuzzyMatchEntities(
    { full_legal_name: 'Mohammed Al Saud' },
    ENTITIES,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ref, 'UK-3');
  assert.ok(hits[0].reasons.includes('name_exact'));
});
