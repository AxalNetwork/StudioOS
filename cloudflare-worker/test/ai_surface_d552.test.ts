import {aiBudgetFixture} from './_ai_budget_fixture.mjs';
/**
 * D552 — every AI run records the page it was asked from, and a page can read
 * its own month and its own last run.
 *
 * Three groups, each guarding a different way the rail's "This page this
 * month" can go wrong:
 *
 *   1. A CALL SITE THAT RECORDS NO PAGE. Scanned from source: every call into
 *      `aiRouter.run`, under whatever local name a file imports it as, must
 *      pass `surface`, and a fixed name must come from `AI_SURFACE` rather than
 *      a quoted string. A new model call without one fails here, before it
 *      ships a month of unattributed spend.
 *   2. A NAME THAT DOES NOT REACH THE ROW. Executed: the shared services are
 *      run against a real SQLite `ai_usage_logs` with a stub model, and the
 *      row they leave is read back.
 *   3. THE ROUTE. `GET /api/ai/me/spend?surface=` answers for one listed page,
 *      refuses anything else, never shows another account's rows, and says
 *      "unreadable" rather than drawing a zero.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_surface_d552.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { makeD1 } from './_d1_sqlite.mjs';
import { AI_SURFACE, AI_SURFACES, isAiSurface } from '../src/services/aiSurfaces.ts';
import { SURFACE_RE, normaliseSurface } from '../src/services/aiRouter.ts';
import { loadMyAiSpendForSurface, SURFACE_REASONS } from '../src/services/aiSpend.ts';
import { classifyInput } from '../src/services/advisor/guardrails.ts';
import { mapSections, generateReview } from '../src/services/deckExtract.ts';
import { citeFromResearch } from '../src/services/fills/citations.ts';
import { draftSummary } from '../src/services/publications.ts';
import ai, { isSpendSurface } from '../src/routes/ai.ts';
import { createJWT } from '../src/auth.ts';

const SRC = resolve(process.cwd(), 'cloudflare-worker/src');

// ---------------------------------------------------------------------------
// 0. The list itself
// ---------------------------------------------------------------------------

test('every fixed name is an app path the router records unchanged', () => {
  assert.ok(AI_SURFACES.length >= 9, 'the list lost names');
  assert.equal(new Set(AI_SURFACES).size, AI_SURFACES.length, 'a name is listed twice');
  for (const s of AI_SURFACES) {
    assert.match(s, SURFACE_RE, `${s} would be recorded as NULL`);
    assert.equal(normaliseSurface(s), s, `${s} is rewritten by the router before it is stored`);
  }
  assert.ok(Object.isFrozen(AI_SURFACES), 'the allow-list can be pushed to at runtime');
});

test('isAiSurface is an exact match — no folding into a name it resembles', () => {
  assert.equal(isAiSurface('/research/ask'), true);
  for (const bad of ['', ' /research/ask', '/research/ask/', '/RESEARCH/ASK', '/research', '/research/ask?x=1',
    '/validate/interviews/12', 'research/ask', null, undefined, 42, ['/studio']]) {
    assert.equal(isAiSurface(bad), false, `${JSON.stringify(bad)} was accepted`);
  }
});

// ---------------------------------------------------------------------------
// 1. Source scan — every router call names its page
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** The local expressions a file calls `aiRouter.run` through. */
function routerCallees(src: string): string[] {
  const out: string[] = [];
  const FROM = String.raw`from\s*['"](?:\.\.?\/)+(?:services\/)?aiRouter['"]`;
  for (const m of src.matchAll(new RegExp(String.raw`import\s*\{([^}]*)\}\s*` + FROM, 'g'))) {
    for (const part of m[1].split(',')) {
      const t = part.trim().replace(/^type\s+/, '');
      const as = t.match(/^run\s+as\s+(\w+)$/);
      if (as) out.push(as[1]);
      else if (t === 'run') out.push('run');
    }
  }
  for (const m of src.matchAll(new RegExp(String.raw`import\s*\*\s*as\s+(\w+)\s*` + FROM, 'g'))) {
    out.push(`${m[1]}.run`);
  }
  return out;
}

/** Index just past the `}` that closes the `{` at `open`, skipping quoted strings and comments. */
function closeBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** The text of an object literal at nesting depth 1 only — its own keys, not its children's. */
function topLevel(obj: string): string {
  let depth = 0;
  let out = '';
  for (const ch of obj) {
    if (ch === '{' || ch === '[' || ch === '(') { depth++; if (depth === 1) continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; continue; }
    if (depth === 1) out += ch;
  }
  return out;
}

interface CallSite { file: string; line: number; surface: string | null }

function scanCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/');
    if (rel === 'services/aiRouter.ts') continue; // the router itself, not a caller
    const src = readFileSync(file, 'utf8');
    for (const callee of routerCallees(src)) {
      const re = new RegExp(String.raw`(?<![\w.$])` + callee.replace('.', String.raw`\.`) + String.raw`\s*\(`, 'g');
      for (const m of src.matchAll(re)) {
        const at = m.index!;
        // Skip mentions in comments: the line up to the match opens one.
        const lineStart = src.lastIndexOf('\n', at) + 1;
        const before = src.slice(lineStart, at);
        if (/^\s*(\*|\/\/)/.test(before) || before.includes('//')) continue;
        const open = src.indexOf('{', at);
        const close = closeBrace(src, open);
        assert.ok(open > 0 && close > open, `${rel}: could not read the options of the call at offset ${at}`);
        const own = topLevel(src.slice(open, close));
        const kv = own.match(/(?:^|[,\s])surface\s*:\s*([^,]+?)\s*(?:,|$)/);
        const shorthand = /(?:^|[,\s])surface\s*(?:,|$)/.test(own);
        sites.push({
          file: rel,
          line: src.slice(0, at).split('\n').length,
          surface: kv ? kv[1].trim() : shorthand ? 'surface' : null,
        });
      }
    }
  }
  return sites;
}

/**
 * The ONE call that records no page, and why. Not a convenience list: an entry
 * here is a claim about the code, and the test below fails when the claim
 * stops being true (the function gains a caller, or a surface).
 */
const NO_PAGE: Record<string, string> = {
  // `paraphraseForSnippet` has no caller anywhere in src/ — the reducer that
  // was to use it says so in its own header. No page can ask for it, so there
  // is no page to name, and inventing one would put a false row on a page.
  'services/market_intel/extractors/index.ts': 'unreferenced; no page asks for it',
};

/**
 * Callers that FORWARD a page rather than name one. Each is a path the router
 * re-validates with `normaliseSurface` before it is stored.
 */
const FORWARDED: Record<string, string[]> = {
  'routes/ai.ts': ['page'],                     // the rail's own app path (D404)
  'routes/research.ts': ['page'],               // the zone draft's app path (D404, D510)
  'services/advisor/guardrails.ts': ['surface'], // classifyInput's required parameter
};

/** Every call site's fixed name, by file — the table D552.md lists. */
const EXPECTED: Record<string, string[]> = {
  'routes/founder_validate.ts': ['AI_SURFACE.validate', 'AI_SURFACE.validateInterviews'],
  'routes/research.ts': ['AI_SURFACE.researchAsk'],
  'routes/brand.ts': ['AI_SURFACE.buildBrand', 'AI_SURFACE.buildBrand', 'AI_SURFACE.buildBrand'],
  'services/competitorAnalysis.ts': ['AI_SURFACE.researchCompanies'],
  'services/deckExtract.ts': ['AI_SURFACE.raisePitchReview', 'AI_SURFACE.raisePitchReview'],
  'services/publications.ts': ['AI_SURFACE.adminPublications'],
  'services/updateShare.ts': ['AI_SURFACE.growUpdate'],
  'services/fills/citations.ts': ['AI_SURFACE.validate'],
  'services/advisor/rerank.ts': ['AI_SURFACE.studio'],
  'routes/profiling.ts': ['AI_SURFACE.onboardingChat', 'AI_SURFACE.onboardingChat'],
  'routes/advisor.ts': ['AI_SURFACE.studio', 'AI_SURFACE.studio', 'AI_SURFACE.studio'],
};

test('the scan finds the router calls it is meant to guard', () => {
  // A scanner that matched nothing would pass every assertion below.
  const sites = scanCallSites();
  assert.ok(sites.length >= 20, `only ${sites.length} router calls found — the scanner has gone blind`);
  const files = new Set(sites.map((s) => s.file));
  for (const f of [...Object.keys(EXPECTED), ...Object.keys(FORWARDED), ...Object.keys(NO_PAGE)]) {
    assert.ok(files.has(f), `${f} has no router call any more — update D552's table`);
  }
});

test('every AI call records a page', () => {
  const missing = scanCallSites()
    .filter((s) => s.surface === null && !(s.file in NO_PAGE))
    .map((s) => `${s.file}:${s.line}`);
  assert.deepEqual(missing, [],
    'these router calls set no `surface` — add the page to services/aiSurfaces.ts and pass it (D552)');
});

test('the one call that records no page still has no caller', () => {
  for (const [file, reason] of Object.entries(NO_PAGE)) {
    const sites = scanCallSites().filter((s) => s.file === file);
    assert.ok(sites.every((s) => s.surface === null), `${file} now sets a surface — drop it from NO_PAGE`);
    assert.match(reason, /unreferenced/);
  }
  const callers = walk(SRC)
    .filter((f) => !f.endsWith('extractors/index.ts'))
    .filter((f) => /\bparaphraseForSnippet\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(callers, [], 'paraphraseForSnippet gained a caller — it now needs a page');
});

test('a fixed name comes from AI_SURFACE, never a quoted string', () => {
  for (const s of scanCallSites()) {
    if (s.surface === null) continue;
    assert.doesNotMatch(s.surface, /^['"`]/, `${s.file}:${s.line} records a literal — use AI_SURFACE`);
    if (!s.surface.startsWith('AI_SURFACE.')) {
      assert.ok((FORWARDED[s.file] || []).includes(s.surface),
        `${s.file}:${s.line} forwards \`${s.surface}\`, which is not a known forwarded page`);
    } else {
      const key = s.surface.slice('AI_SURFACE.'.length);
      assert.ok(key in AI_SURFACE, `${s.file}:${s.line} names AI_SURFACE.${key}, which does not exist`);
    }
  }
});

test('each call site records the page D552 lists for it', () => {
  const got: Record<string, string[]> = {};
  for (const s of scanCallSites()) {
    if (!s.surface?.startsWith('AI_SURFACE.')) continue;
    (got[s.file] ||= []).push(s.surface);
  }
  assert.deepEqual(got, EXPECTED);
});

test('the D552 decision file lists every name', () => {
  const doc = readFileSync(resolve(process.cwd(), 'documentation/architecture/decisions/D552.md'), 'utf8');
  for (const s of AI_SURFACES) assert.ok(doc.includes(`\`${s}\``), `D552.md does not list ${s}`);
});

// ---------------------------------------------------------------------------
// 2. Executed — the name reaches the row
// ---------------------------------------------------------------------------

function routerEnv() {
  const { DB, db } = aiBudgetFixture();
  const env: any = {
    DB,
    AI: { run: async () => ({ response: '{"source": null, "quote": null}', usage: { prompt_tokens: 5, completion_tokens: 1 } }) },
  };
  const surfaces = () => (db.prepare('SELECT task, surface FROM ai_usage_logs ORDER BY id').all() as any[])
    .map((r) => `${r.task}@${r.surface}`);
  return { env, surfaces };
}

test('the safety pass is recorded on the page that sent the message', async () => {
  const { env, surfaces } = routerEnv();
  await classifyInput(env, 7, 'hello', AI_SURFACE.studio);
  await classifyInput(env, 7, 'hello', '/build/board');
  assert.deepEqual(surfaces(), ['safety@/studio', 'safety@/build/board']);
});

test('the deck reviewer records Raise · Pitch · Review on both of its runs', async () => {
  const { env, surfaces } = routerEnv();
  await mapSections(env, 7, '# Problem\nfoo', []);
  await generateReview(env, 7, []);
  assert.deepEqual(surfaces(), ['dd_synthesis@/raise/pitch/review', 'dd_synthesis@/raise/pitch/review']);
});

test('a researched citation is recorded on Validate', async () => {
  const { env, surfaces } = routerEnv();
  await citeFromResearch(env, 7, 'What is the size of the EU heat-pump market?');
  assert.deepEqual(surfaces(), ['research_ask@/validate']);
});

test('a publication draft is recorded on HQ · Publications', async () => {
  const { env, surfaces } = routerEnv();
  await draftSummary(env, 1, { title: 't', section: 's', audience: 'public', filters: {}, aggregates: [] });
  assert.deepEqual(surfaces(), ['publication@/admin/publications']);
});

// ---------------------------------------------------------------------------
// 3. GET /api/ai/me/spend?surface=
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, task TEXT NOT NULL, model TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0, est_cost_usd REAL NOT NULL DEFAULT 0, safety_score REAL,
  fallback_used INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, refusal TEXT,
  created_at TEXT NOT NULL, surface TEXT
);`;
const NO_SURFACE_COLUMN = SCHEMA.replace(', surface TEXT', '');

/**
 * 'YYYY-MM-DD HH:MM:SS', `seconds` before now. The route reads the wall clock,
 * so the rows sit seconds behind it: a run of this file has to straddle a
 * month boundary by under a minute to see a row fall into the previous month.
 */
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
const LAST_MONTH = (() => {
  const d = new Date(); d.setUTCDate(1); d.setUTCDate(0); d.setUTCHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
})();

const ME = 7;
const OTHER = 9;
const SEED = `
INSERT INTO ai_usage_logs (user_id, task, model, prompt_tokens, completion_tokens, est_cost_usd, created_at, surface) VALUES
  (${ME},    'research_ask', 'm-ask', 400, 90, 0.0010, '${ago(30)}', '/research/ask'),
  (${ME},    'research_ask', 'm-ask', 410, 95, 0.0020, '${ago(20)}', '/research/ask'),
  (${ME},    'research_ask', 'm-old', 400, 90, 0.5000, '${LAST_MONTH}', '/research/ask'),
  (${ME},    'dd_synthesis', 'm-val', 300, 80, 0.0300, '${ago(10)}', '/validate'),
  (${ME},    'advisor_turn', 'm-nul', 300, 80, 0.0040, '${ago(15)}', NULL),
  (${OTHER}, 'research_ask', 'm-theirs', 999, 999, 9.0000, '${ago(1)}', '/research/ask'),
  (${OTHER}, 'transcribe',   'm-theirs', 0, 0, 7.0000, '${ago(2)}', '/validate/interviews'),
  (${ME},    'workspace_explain', 'm-rail', 120, 40, 0.0005, '${ago(5)}', '/research/funds/catalog/fund-42'),
  (${OTHER}, 'workspace_explain', 'm-theirs', 999, 999, 3.0000, '${ago(3)}', '/research/funds/catalog/fund-42');
`;

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

/**
 * A real SQLite `ai_usage_logs` behind a stub for the account lookup. Only the
 * usage table is answered by SQL; everything `requireAuth` reads gets a live
 * session and the one account, as `ai_workspace_explain.test.ts` does.
 */
function routeEnv(userId: number, schema = SCHEMA, seed: string = SEED) {
  const { DB } = makeD1(schema, seed);
  let usageReads = 0;
  const stub = (q: string) => {
    const api: any = {
      bind: () => api,
      first: async () => (/FROM user_sessions/i.test(q) ? { revoked_at: null, step_up_due_at: null } : null),
      all: async () => ({
        results: /FROM\s+users/i.test(q)
          ? [{ id: userId, email: `u${userId}@example.test`, role: 'founder', is_active: 1, name: 'U' }]
          : [],
      }),
      run: async () => ({ meta: { changes: 0 } }),
    };
    return api;
  };
  const env: any = {
    JWT_SECRET,
    DB: {
      prepare: (q: string) => {
        if (/ai_usage_logs/.test(q)) { usageReads++; return DB.prepare(q); }
        return stub(q);
      },
      exec: async () => ({ count: 0, duration: 0 }),
    },
  };
  return { env, usageReads: () => usageReads };
}

async function getSpend(userId: number, query: string, schema?: string, seed?: string) {
  const { env, usageReads } = routeEnv(userId, schema, seed);
  const token = await createJWT(env, userId, `u${userId}@example.test`, 'founder', undefined, `jti-${userId}`);
  const res = await ai.request(`/me/spend${query}`, { headers: { authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any, usageReads: usageReads() };
}

test('an allowed surface returns that page\'s month and last run, and nothing else', async () => {
  const { status, body } = await getSpend(ME, '?surface=%2Fresearch%2Fask');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.surface, '/research/ask');
  assert.equal(body.recorded, true);
  assert.equal(body.reason, null);
  // This month's two Ask runs; last month's $0.50 and the other pages excluded.
  assert.equal(body.month.calls, 2);
  assert.equal(Number(body.month.spend_usd.toFixed(4)), 0.003);
  assert.equal(body.month.key, new Date().toISOString().slice(0, 7));
  // The page's last run, not the account's (the account's is /validate, 10 s ago).
  assert.equal(body.last_run_recorded, true);
  assert.equal(body.last_run.model, 'm-ask');
  assert.equal(body.last_run.prompt_tokens, 410);
  assert.equal(body.last_run_reason, null);
  // The month's page-less runs are reported beside it, not folded in.
  assert.deepEqual(body.unattributed, { calls: 1, spend_usd: 0.004 });
  // A page answer is not the account answer.
  assert.equal(body.by_surface, undefined);
  assert.equal(body.today, undefined);
});

test('another account\'s runs on the same page are never visible', async () => {
  // OTHER ran Ask a second ago for $9. ME must see neither the run nor the money.
  const { body } = await getSpend(ME, '?surface=/research/ask');
  assert.notEqual(body.last_run.model, 'm-theirs', 'the last run is another account\'s');
  assert.ok(body.month.spend_usd < 1, 'another account\'s spend was summed in');
  // A page only OTHER has used is an empty page for ME — a read that ran.
  const empty = await getSpend(ME, '?surface=/validate/interviews');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.recorded, true);
  assert.equal(empty.body.month.calls, 0);
  assert.equal(empty.body.month.spend_usd, 0);
  assert.equal(empty.body.last_run, null);
  assert.equal(empty.body.last_run_recorded, true);
  assert.equal(empty.body.last_run_reason, SURFACE_REASONS.noRun);
  // And OTHER sees their own.
  const theirs = await getSpend(OTHER, '?surface=/validate/interviews');
  assert.equal(theirs.body.month.calls, 1);
  assert.equal(theirs.body.last_run.task, 'transcribe');
});

test('isSpendSurface: every fixed name and any recorded page path, and nothing that is not a string', () => {
  for (const s of AI_SURFACES) assert.equal(isSpendSurface(s), true, s);
  assert.equal(isSpendSurface('/research/funds/catalog/fund-42'), true);
  assert.equal(isSpendSurface('/'), true);
  for (const v of [null, undefined, 42, ['/validate'], '', '/validate/', ' /validate', 'validate']) {
    assert.equal(isSpendSurface(v), false, JSON.stringify(v));
  }
});

test('a value that is not a page path as the router records one is refused before anything is read', async () => {
  for (const q of ['?surface=', '?surface=%2Fresearch%2Fask%2F', '?surface=research%2Fask', '?surface=1%20OR%201%3D1',
    '?surface=%20%2Fresearch%2Fask', '?surface=%2Fa%3Fb%3Dc', `?surface=%2F${'x'.repeat(160)}`]) {
    const { status, body, usageReads } = await getSpend(ME, q);
    assert.equal(status, 400, `${q} was not refused`);
    assert.equal(body.error, 'unknown_surface', `${q}`);
    assert.equal(typeof body.message, 'string');
    assert.deepEqual(body.surfaces, [...AI_SURFACES], 'the refusal does not say which names are accepted');
    assert.equal(usageReads, 0, `${q} reached the usage table`);
  }
});

test('a rail page\'s own path is read too (D552 step 3, B): its month and last run, the caller\'s rows only', async () => {
  // The rail records the path of the page it sits on (D404), parameterised pages included.
  const { status, body } = await getSpend(ME, '?surface=%2Fresearch%2Ffunds%2Fcatalog%2Ffund-42');
  assert.equal(status, 200);
  assert.equal(body.surface, '/research/funds/catalog/fund-42');
  assert.equal(body.month.calls, 1, 'another account\'s run on the same page was counted');
  assert.equal(body.last_run.model, 'm-rail');
  // A page path with no runs is an empty page, a read that ran — not a refusal.
  const none = await getSpend(ME, '?surface=%2Fresearch%2Ffunds');
  assert.equal(none.status, 200);
  assert.equal(none.body.month.calls, 0);
  assert.equal(none.body.last_run, null);
  assert.equal(none.body.last_run_reason, SURFACE_REASONS.noRun);
});

test('no surface still returns the whole account, as before', async () => {
  const { status, body } = await getSpend(ME, '');
  assert.equal(status, 200);
  assert.equal(body.recorded, true);
  assert.ok(Array.isArray(body.by_surface));
  assert.equal(body.month.calls, 5, 'the account month covers every page');
  assert.equal(body.surface, undefined);
});

test('an unreadable store says so — no zero, no last run', async () => {
  // Before migration 319 the column does not exist; that is not "this page is free".
  const { status, body } = await getSpend(ME, '?surface=/research/ask', NO_SURFACE_COLUMN,
    `INSERT INTO ai_usage_logs (user_id, task, model, est_cost_usd, created_at) VALUES (${ME}, 'research_ask', 'm', 0.002, '${ago(5)}');`);
  assert.equal(status, 200);
  assert.equal(body.recorded, false);
  assert.equal(body.reason, SURFACE_REASONS.unreadable);
  assert.equal(body.month.spend_usd, null);
  assert.equal(body.month.calls, null);
  assert.equal(body.last_run, null);
  assert.equal(body.last_run_recorded, false);
  assert.equal(body.last_run_reason, SURFACE_REASONS.lastRunUnreadable);
  assert.equal(body.unattributed, null);
});

test('the last run is the page\'s own, bounded by now', async () => {
  // Called directly with the clock set between the two Ask runs (30 s and 20 s
  // ago). The last run is not bounded to the month, so this holds on any day.
  const { DB } = makeD1(SCHEMA, SEED);
  const cut = new Date(Date.now() - 25_000);
  const r = await loadMyAiSpendForSurface({ DB } as any, { id: ME, role: 'founder' }, '/research/ask', cut);
  assert.equal(r.last_run?.prompt_tokens, 400, 'a run after `now` was reported as the last one');
  assert.equal(r.last_run?.model, 'm-ask');
});
