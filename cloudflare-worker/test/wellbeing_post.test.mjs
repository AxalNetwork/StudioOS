/**
 * Task #33 — POST /api/wellbeing/{daily,checkins} unit tests.
 *
 * Covers the validation helpers + encryption-fallback helper exported
 * from `routes/wellbeing.helpers.ts`. Tests:
 *   (a) valid body validates clean (happy path)
 *   (b) missing field → 400 with field-level error
 *   (c) oversized free_text / notes → 400
 *   (d) too many tags → 400
 *   (e) non-1..5 slider value → 400
 *   (f) `connection` alias maps to `social`
 *   (g) encryptOrFallback returns enc when JWT_SECRET is set
 *   (h) encryptOrFallback falls back to plaintext when no secret AND
 *       emits a warn log
 *   (i) encryptOrFallback null in → null out
 *
 * The helpers are pure TS so we transpile the source on the fly with the
 * same tsc.transpileModule pattern used by `spinout_lab.test.mjs` — no
 * new test deps. The cryptoBox dependency is also transpiled.
 *
 * Run with:
 *   node --test cloudflare-worker/test/wellbeing_post.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const ts = require_('typescript');

function transpile(src) {
  return ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
  }).outputText;
}

async function loadHelpers() {
  const helpersSrc = await readFile(
    resolve(__dirname, '../src/routes/wellbeing.helpers.ts'),
    'utf8',
  );
  const cryptoBoxSrc = await readFile(
    resolve(__dirname, '../src/services/cryptoBox.ts'),
    'utf8',
  );
  const tmp = await mkdtemp(join(tmpdir(), 'wb-test-'));
  // Write cryptoBox first; the helpers import it as a relative path. We
  // mirror the source layout `services/cryptoBox` + `routes/helpers`.
  const cbDir = join(tmp, 'services');
  const rtDir = join(tmp, 'routes');
  await Promise.all([
    writeFile(join(tmp, 'placeholder.txt'), ''),
  ]);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(cbDir, { recursive: true });
  await mkdir(rtDir, { recursive: true });
  await writeFile(join(cbDir, 'cryptoBox.mjs'), transpile(cryptoBoxSrc));
  await writeFile(join(rtDir, 'wellbeing.helpers.mjs'),
    transpile(helpersSrc).replace(
      "'../services/cryptoBox'",
      "'../services/cryptoBox.mjs'",
    ),
  );
  return import(join(rtDir, 'wellbeing.helpers.mjs'));
}

const { validateCheckinBody, validateDailyBody, encryptOrFallback } = await loadHelpers();

/* -------------------- validateDailyBody -------------------- */

test('validateDailyBody: happy path returns ok', () => {
  const r = validateDailyBody({
    mood: 4, stress: 2, sleep: 5, energy: 3, focus: 4, social: 4,
    free_text: 'hello', tags: ['therapy'],
  });
  assert.equal(r.ok, true);
  assert.equal(r.values.mood, 4);
  assert.deepEqual(r.tags, ['therapy']);
});

test('validateDailyBody: empty body → fields.mood', () => {
  const r = validateDailyBody({});
  assert.equal(r.ok, false);
  assert.ok(r.fields.mood);
});

test('validateDailyBody: invalid slider value → field-level error', () => {
  const r = validateDailyBody({ mood: 9 });
  assert.equal(r.ok, false);
  assert.match(r.fields.mood, /1\.\.5/);
});

test('validateDailyBody: oversized free_text → 400 fields.free_text', () => {
  const r = validateDailyBody({ mood: 3, free_text: 'a'.repeat(4001) });
  assert.equal(r.ok, false);
  assert.ok(r.fields.free_text);
});

test('validateDailyBody: too many tags → 400 fields.tags', () => {
  const r = validateDailyBody({
    mood: 3, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
  });
  assert.equal(r.ok, false);
  assert.match(r.fields.tags, /at most 8/);
});

test('validateDailyBody: non-string tag → 400 fields.tags', () => {
  const r = validateDailyBody({ mood: 3, tags: [123] });
  assert.equal(r.ok, false);
  assert.ok(r.fields.tags);
});

test('validateDailyBody: connection alias maps to social', () => {
  const r = validateDailyBody({ mood: 3, connection: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.values.social, 5);
});

/* -------------------- validateCheckinBody -------------------- */

test('validateCheckinBody: happy path', () => {
  const r = validateCheckinBody({
    stress: 2, sleep: 4, support: 3, decisions: 5, energy: 4,
  });
  assert.equal(r.ok, true);
  assert.equal(r.answers.support, 3);
});

test('validateCheckinBody: missing field → fields[<name>]', () => {
  const r = validateCheckinBody({ stress: 2, sleep: 4, support: 3, decisions: 5 });
  assert.equal(r.ok, false);
  assert.ok(r.fields.energy);
});

test('validateCheckinBody: oversized notes', () => {
  const r = validateCheckinBody({
    stress: 2, sleep: 4, support: 3, decisions: 5, energy: 4,
    notes: 'x'.repeat(4001),
  });
  assert.equal(r.ok, false);
  assert.ok(r.fields.notes);
});

/* -------------------- encryptOrFallback -------------------- */

test('encryptOrFallback: encrypts when JWT_SECRET is set', async () => {
  const env = { JWT_SECRET: 'a'.repeat(32) };
  const r = await encryptOrFallback(env, 4);
  assert.equal(r.fellBack, false);
  assert.equal(typeof r.enc, 'string');
  assert.ok(r.enc.length > 0);
  assert.equal(r.plain, null);
});

test('encryptOrFallback: no PII key → plaintext fallback + warn log', async () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    const r = await encryptOrFallback({}, 3);
    assert.equal(r.fellBack, true);
    assert.equal(r.enc, null);
    assert.equal(r.plain, 3);
    assert.ok(
      warnings.some((w) => /encryption fallback/i.test(w)),
      `expected fallback warn log, got: ${warnings.join(' | ')}`,
    );
  } finally {
    console.warn = origWarn;
  }
});

test('encryptOrFallback: production with no secret also falls back (never 500)', async () => {
  // Per Task #33: missing key is an operator problem, never a user-facing
  // 500. Fallback must work regardless of ENVIRONMENT.
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    const r = await encryptOrFallback({ ENVIRONMENT: 'production' }, 4);
    assert.equal(r.fellBack, true);
    assert.equal(r.plain, 4);
    assert.equal(r.enc, null);
  } finally {
    console.warn = origWarn;
  }
});

test('encryptOrFallback: null in → null out', async () => {
  const r = await encryptOrFallback({ JWT_SECRET: 'a'.repeat(32) }, null);
  assert.equal(r.enc, null);
  assert.equal(r.plain, null);
  assert.equal(r.fellBack, false);
});
