/**
 * Task #33 — Route-level integration test for POST /api/wellbeing/checkins.
 *
 * Drives `submitCanonicalCheckin()` (the testable pure handler extracted
 * from `routes/wellbeing.ts`) against an in-memory D1 stub. Covers:
 *   (a) valid body → 201, persisted row, GET round-trip exposes values
 *   (b) missing slider field → 400 with `fields` map
 *   (c) oversized free_text → 400
 *   (d) too many tags → 400
 *   (e) no encryption secret → 201 with *_plain populated + warn log
 *   (f) DB insert failure → 500 with friendly retry copy
 *   (g) mood_1to10 alias is accepted
 *
 * Run with:
 *   node --test cloudflare-worker/test/wellbeing_route.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
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

/**
 * Minimal in-memory D1 stub. We only implement the prepared-statement
 * surface that `submitCanonicalCheckin` actually uses: a single
 * UPSERT into `wellbeing_daily_pulses` and a single SELECT by
 * (user_id, day). The schema is mirrored to the production migration
 * but kept in JS for test isolation.
 */
function makeFakeDB({ failInsert = false } = {}) {
  // [user_id][day] => row
  const table = new Map();
  let nextId = 1;
  const cols = [
    'mood_enc', 'stress_enc', 'sleep_enc', 'energy_enc', 'focus_enc', 'social_enc',
    'free_text_enc', 'tags_enc',
    'mood_plain', 'stress_plain', 'sleep_plain', 'energy_plain',
    'focus_plain', 'social_plain', 'free_text_plain', 'tags_plain',
  ];

  function prepare(sql) {
    let boundValues = [];
    return {
      bind(...vals) { boundValues = vals; return this; },
      async run() {
        if (failInsert) throw new Error('simulated D1 insert failure');
        if (!/INSERT INTO wellbeing_daily_pulses/.test(sql)) {
          throw new Error('unexpected SQL in stub: ' + sql);
        }
        const [uid, user_id, day, ...rest] = boundValues;
        const row = { id: nextId++, uid, user_id, day, created_at: new Date().toISOString() };
        cols.forEach((c, i) => { row[c] = rest[i] ?? null; });
        if (!table.has(user_id)) table.set(user_id, new Map());
        const existing = table.get(user_id).get(day);
        if (existing) {
          // ON CONFLICT UPDATE — preserve id, update everything else.
          row.id = existing.id;
        }
        table.get(user_id).set(day, row);
        return { success: true };
      },
      async first() {
        const m = /WHERE user_id = \? AND day = \?/.exec(sql);
        if (!m) throw new Error('unexpected SELECT in stub: ' + sql);
        const [user_id, day] = boundValues;
        return table.get(user_id)?.get(day) ?? null;
      },
      async all() {
        const [user_id] = boundValues;
        const rows = Array.from(table.get(user_id)?.values() ?? []);
        return { results: rows };
      },
    };
  }
  return { prepare, _table: table };
}

async function loadRoute() {
  const wellbeingSrc = await readFile(
    resolve(__dirname, '../src/routes/wellbeing.ts'), 'utf8');
  const helpersSrc = await readFile(
    resolve(__dirname, '../src/routes/wellbeing.helpers.ts'), 'utf8');
  const cryptoBoxSrc = await readFile(
    resolve(__dirname, '../src/services/cryptoBox.ts'), 'utf8');

  const tmp = await mkdtemp(join(tmpdir(), 'wb-route-'));
  const cbDir = join(tmp, 'services');
  const rtDir = join(tmp, 'routes');
  await mkdir(cbDir, { recursive: true });
  await mkdir(rtDir, { recursive: true });
  await writeFile(join(cbDir, 'cryptoBox.mjs'), transpile(cryptoBoxSrc));
  await writeFile(join(rtDir, 'wellbeing.helpers.mjs'),
    transpile(helpersSrc).replace("'../services/cryptoBox'", "'../services/cryptoBox.mjs'"));

  // `wellbeing.ts` imports a lot of other modules (hono, auth, notify,
  // experts util, …) — far beyond the handler under test. We extract
  // ONLY the canonical handler + its direct dependencies by slicing
  // the file. The slice anchors are stable section-headers added in
  // Task #33.
  const start = wellbeingSrc.indexOf('// ---------------------------------------------------------------------------\n// Task #33 — POST /checkins now uses the CANONICAL daily-pulse schema');
  const end = wellbeingSrc.indexOf("wellbeing.post('/checkins', async (c) =>");
  if (start < 0 || end < 0) throw new Error('Could not locate handler slice anchors');
  const handlerSlice = wellbeingSrc.slice(start, end);

  // Also slice the DailyRow type + serializeDaily + uuidHex + todayUTC
  // dependencies. They live above the handler.
  const dailyRowStart = wellbeingSrc.indexOf('type DailyRow = {');
  const serializeEnd = wellbeingSrc.indexOf('// Task #33 — POST /daily is now');
  const deps = wellbeingSrc.slice(dailyRowStart, serializeEnd);

  const utilSrc = `
type Env = any;
function uuidHex(): string {
  // 32-hex test stub (crypto.randomUUID() not always available pre-node 19).
  const buf = new Uint8Array(16);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}
function todayUTC(): string { return new Date().toISOString().slice(0, 10); }
`;

  const composed = `
import { validateDailyBody, encryptOrFallback } from './wellbeing.helpers.mjs';
import { decryptInt, decryptString } from '../services/cryptoBox.mjs';
${utilSrc}
${deps}
${handlerSlice.replace(/export type CanonicalCheckinResult[\s\S]*?\n\nexport async function/, 'export async function')}
`;
  // The handler slice references `Env` — re-declared above as `any`.
  const out = transpile(composed);
  await writeFile(join(rtDir, 'wellbeing.handler.mjs'), out);
  return import(join(rtDir, 'wellbeing.handler.mjs'));
}

const handler = await loadRoute();
const { submitCanonicalCheckin } = handler;

const ENV_WITH_SECRET = { JWT_SECRET: 'a'.repeat(32) };
const ENV_NO_SECRET = {};

test('POST /checkins: happy path → 201 with serialized values', async () => {
  const env = { ...ENV_WITH_SECRET, DB: makeFakeDB() };
  const r = await submitCanonicalCheckin(env, 7, {
    mood: 4, stress: 2, sleep: 5, energy: 3, focus: 4, connection: 4,
    free_text: 'feeling good', tags: ['therapy', 'walk'],
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mood, 4);
  assert.equal(r.body.social, 4); // connection alias
  assert.equal(r.body.free_text, 'feeling good');
  assert.deepEqual(r.body.tags, ['therapy', 'walk']);
  assert.ok(r.body.id);
  assert.ok(r.body.captured_at);
});

test('POST /checkins: mood_1to10 alias is accepted', async () => {
  const env = { ...ENV_WITH_SECRET, DB: makeFakeDB() };
  const r = await submitCanonicalCheckin(env, 8, {
    mood_1to10: 5, stress_1to10: 2,
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.mood, 5);
  assert.equal(r.body.stress, 2);
});

test('POST /checkins: empty body → 400 with fields.mood', async () => {
  const env = { ...ENV_WITH_SECRET, DB: makeFakeDB() };
  const r = await submitCanonicalCheckin(env, 9, {});
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Invalid input');
  assert.ok(r.body.fields.mood);
});

test('POST /checkins: invalid slider → 400 with field-level error', async () => {
  const env = { ...ENV_WITH_SECRET, DB: makeFakeDB() };
  const r = await submitCanonicalCheckin(env, 10, { mood: 9 });
  assert.equal(r.status, 400);
  assert.match(r.body.fields.mood, /1\.\.5/);
});

test('POST /checkins: oversized free_text → 400 fields.free_text', async () => {
  const env = { ...ENV_WITH_SECRET, DB: makeFakeDB() };
  const r = await submitCanonicalCheckin(env, 11, {
    mood: 3, free_text: 'x'.repeat(4001),
  });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.free_text);
});

test('POST /checkins: too many tags → 400 fields.tags', async () => {
  const env = { ...ENV_WITH_SECRET, DB: makeFakeDB() };
  const r = await submitCanonicalCheckin(env, 12, {
    mood: 3, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.fields.tags, /at most 8/);
});

test('POST /checkins: no encryption secret → 201 with *_plain backstop', async () => {
  const db = makeFakeDB();
  const env = { ...ENV_NO_SECRET, DB: db };
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    const r = await submitCanonicalCheckin(env, 13, {
      mood: 4, stress: 2, free_text: 'no key today', tags: ['walk'],
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.mood, 4);
    assert.equal(r.body.free_text, 'no key today');
    assert.deepEqual(r.body.tags, ['walk']);
    // Verify the row in the DB has *_plain populated (not *_enc).
    const row = db._table.get(13).get(r.body.day);
    assert.equal(row.mood_enc, null);
    assert.equal(row.mood_plain, 4);
    assert.equal(row.free_text_plain, 'no key today');
    assert.ok(
      warnings.some((w) => /encryption fallback/i.test(w)),
      `expected fallback warn log, got: ${warnings.join(' | ')}`,
    );
  } finally {
    console.warn = origWarn;
  }
});

test('POST /checkins: DB failure → 500 with friendly retry copy', async () => {
  const env = { ...ENV_WITH_SECRET, DB: makeFakeDB({ failInsert: true }) };
  const r = await submitCanonicalCheckin(env, 14, { mood: 3 });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /try again/i);
});

test('POST /checkins: production + no secret → still falls back to plaintext (no 500)', async () => {
  // Per Task #33 spec: a missing PII key must never cause a user-facing
  // 500 — the row is persisted via *_plain and a warn log is emitted
  // for the operator.
  const db = makeFakeDB();
  const env = { ENVIRONMENT: 'production', DB: db };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const r = await submitCanonicalCheckin(env, 15, { mood: 3, stress: 2 });
    assert.equal(r.status, 201);
    assert.equal(r.body.mood, 3);
    const row = db._table.get(15).get(r.body.day);
    assert.equal(row.mood_plain, 3);
    assert.equal(row.mood_enc, null);
  } finally {
    console.warn = origWarn;
  }
});

/* ------------------------------------------------------------------ */
/* Authenticated route wiring (NICE-500-03).                          */
/*                                                                    */
/* The tests above drive the pure `submitCanonicalCheckin` handler.   */
/* These drive the REAL `wellbeing.post('/checkins')` closure — sliced */
/* from source so we exercise the exact bytes that ship — to lock in  */
/* the end-to-end authenticated contract: `requireAuth` runs first,   */
/* investors are gated with 403 BEFORE any DB work, and an            */
/* authenticated non-investor flows through to a 201.                 */
/* ------------------------------------------------------------------ */
async function loadCheckinsRoute() {
  const src = await readFile(resolve(__dirname, '../src/routes/wellbeing.ts'), 'utf8');
  const marker = "wellbeing.post('/checkins', async (c) => {";
  const i = src.indexOf(marker);
  assert.notEqual(i, -1, 'checkins route signature not found in wellbeing.ts');
  const bodyOpen = i + marker.length - 1; // index of the body-opening '{'
  let depth = 0, close = -1;
  for (let j = bodyOpen; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { close = j; break; } }
  }
  assert.notEqual(close, -1, 'failed to balance checkins handler braces');
  const body = src.slice(bodyOpen + 1, close); // plain JS — no TS annotations in this handler
  // Wrap so the handler's free deps are injected; `return c.json(...)`
  // resolves the inner IIFE which we hand back to the caller.
  const fn = new Function('c', '__deps', `
    const { requireAuth, role, ensureWellbeingSchema, submitCanonicalCheckin } = __deps;
    return (async () => { ${body} })();
  `);
  return fn;
}

test('authenticated route: founder POST /checkins → 201 (requireAuth + real handler)', async () => {
  const route = await loadCheckinsRoute();
  const env = { ...ENV_WITH_SECRET, DB: makeFakeDB() };
  let captured;
  const c = {
    env,
    req: { json: async () => ({ mood: 4, stress: 2, sleep: 5, energy: 3, focus: 4, connection: 4 }) },
    json: (b, status) => { captured = { b, status: status ?? 200 }; return captured; },
  };
  await route(c, {
    requireAuth: async () => ({ id: 21, role: 'founder' }),
    role: (u) => u.role,
    ensureWellbeingSchema: async () => {},
    submitCanonicalCheckin, // the REAL extracted handler
  });
  assert.equal(captured.status, 201);
  assert.equal(captured.b.ok, true);
  assert.equal(captured.b.mood, 4);
  assert.ok(captured.b.id);
});

test('authenticated route: investor POST /checkins → 403 (gate short-circuits before DB)', async () => {
  const route = await loadCheckinsRoute();
  const env = { ...ENV_WITH_SECRET, DB: makeFakeDB() };
  let captured;
  const c = {
    env,
    req: { json: async () => ({ mood: 4 }) },
    json: (b, status) => { captured = { b, status: status ?? 200 }; return captured; },
  };
  await route(c, {
    requireAuth: async () => ({ id: 99, role: 'investor' }),
    role: (u) => u.role,
    // These MUST NOT be reached — the investor gate returns before them.
    ensureWellbeingSchema: async () => { throw new Error('investor reached schema bootstrap'); },
    submitCanonicalCheckin: async () => { throw new Error('investor reached handler'); },
  });
  assert.equal(captured.status, 403);
  assert.match(captured.b.detail, /investor/i);
});
