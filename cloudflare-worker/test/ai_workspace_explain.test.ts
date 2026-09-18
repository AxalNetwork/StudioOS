/**
 * THE CARD MAY NAME A MODEL BECAUSE THIS ROUTE RUNS ONE.
 *
 * The workspace rail carried no model block for a long time, and the guards
 * that enforced that said why: `ASSIST_SURFACES` binds a surface to an aiRouter
 * task class, that class decides the model and the price, and no workspace ran
 * one — so a card would have named a model for a page that never called it.
 * Those guards also warned about the shortcut, in `workspace_frame_contract`:
 * "inventing the registration to get the card" is the failure, not the fix.
 *
 * So the route came first and the registration followed. What this file pins is
 * the things that make the route worth having a card for:
 *
 *   · it is auth-gated, and an unauthenticated call reaches no model;
 *   · it refuses a page with nothing on it rather than asking a model to
 *     explain an empty list — an "explanation" of nothing is the invented
 *     content its own prompt spends most of its length forbidding;
 *   · it is bounded on the way in, because the lines it forwards are the only
 *     thing standing between a page and a prompt;
 *   · a router refusal — a spent budget, an unreachable model — comes back as
 *     that reason, not as a 500 and not as an empty success;
 *   · the answer is never cached, because a cached read-back describes a page
 *     state that has moved on while looking current.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_workspace_explain.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ai from '../src/routes/ai.ts';
import { ROUTE } from '../src/services/aiRouter.ts';
import { createJWT } from '../src/auth.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const SRC = read('cloudflare-worker/src/routes/ai.ts');

/** An env whose AI binding records that it was reached. */
function envThatRecords() {
  const calls: unknown[] = [];
  return {
    calls,
    env: {
      DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }) }) },
      AI: { run: async (...a: unknown[]) => { calls.push(a); return { response: 'x' }; } },
    } as any,
  };
}

const post = (body: unknown, env: any, headers: Record<string, string> = {}) =>
  ai.request('/workspace/explain', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, env);

test('an unauthenticated call never reaches a model', async () => {
  // The assertion that matters is the second one. A 401 that still ran the
  // model would have spent someone's budget answering a stranger.
  const { env, calls } = envThatRecords();
  await post({ workspace: 'Build', coverage: ['3 rows'] }, env).catch(() => null);
  assert.deepEqual(calls, [], 'no model call may happen before auth resolves');
});

test('the route is behind requireAuth, before anything else', () => {
  const handler = SRC.slice(SRC.indexOf("ai.post('/workspace/explain'"));
  const authAt = handler.indexOf('requireAuth(c)');
  const runAt = handler.indexOf('aiRun(');
  assert.ok(authAt > 0, 'the route must call requireAuth');
  assert.ok(authAt < runAt, 'auth resolves before the model runs');
});

test('a page with nothing on it is refused, not explained', () => {
  // An empty coverage list is a page that has not loaded. Asking a model to
  // summarise it produces exactly the fabricated content the prompt forbids,
  // with a model's authority behind it.
  assert.match(SRC, /if \(coverage\.length === 0\)/);
  assert.match(SRC, /nothing_to_read/);
  const handler = SRC.slice(SRC.indexOf("ai.post('/workspace/explain'"));
  assert.ok(handler.indexOf('nothing_to_read') < handler.indexOf('aiRun('),
    'the refusal must come before the model call, not after it');
});

test('what reaches the prompt is bounded on every axis', () => {
  // These lines are the only thing between a page and a prompt. Unbounded,
  // one page with a long list turns a rail read into an expensive run.
  assert.match(SRC, /\.slice\(0, 12\)/, 'cap the number of lines');
  assert.match(SRC, /\.slice\(0, 200\)/, 'cap each line');
  assert.match(SRC, /\.slice\(0, 60\)/, 'cap the workspace and zone names');
  assert.match(SRC, /classifyInput\(c\.env, user\.id, facts\)/,
    'the same input classifier the advisor surface runs');
  const handler = SRC.slice(SRC.indexOf("ai.post('/workspace/explain'"));
  assert.ok(handler.indexOf('classifyInput') < handler.indexOf('aiRun('),
    'classify before running, or the classifier is decoration');
});

test('the prompt forbids going beyond the lines it was given', () => {
  // The whole product rule in one paragraph: a page whose coverage says
  // "3 quotes out, 1 decided" cannot support a sentence about win rate.
  assert.match(SRC, /Never state a fact that is not in the lines you were given/);
  assert.match(SRC, /Do not estimate/);
  assert.match(SRC, /say which line is missing instead/);
  // The product's standing constraint on regulated advice.
  assert.match(SRC, /No advice about raising money, investing, taxes, or legal structure/);
});

test('a router refusal keeps its reason instead of becoming a 500', () => {
  // `run` never throws — it returns a refusal with a usage row — so a spent
  // budget and an unreachable model both arrive as values. Turning either into
  // a 500 would tell the reader their page is broken when their budget is
  // simply spent.
  assert.match(SRC, /if \(!r\.ok\)/);
  assert.match(SRC, /budget_user_month/);
  assert.match(SRC, /refusal: r\.refusal \?\? null/);
  assert.match(SRC, /Nothing was run, and nothing was charged/);
});

test('the read-back is never cached', () => {
  // `explain` caches for a week because a topic explanation is the same answer
  // every time. This one reads a page's CURRENT figures, so a cached answer
  // describes a state that has moved on — worse than no answer, because it
  // looks current.
  const entry = (ROUTE as any).workspace_explain;
  assert.ok(entry, 'workspace_explain must be a real route entry');
  assert.equal(entry.cacheTtlSec, undefined, 'a cached read-back is a stale page dressed as a fresh one');
  assert.ok(Array.isArray(entry.fallbackChain) && entry.fallbackChain.length > 0,
    'a zone read-back should degrade to the smaller model rather than fail');
});

test('the frontend sends only what the rail already shows', () => {
  // Not the rows. The Coverage lines are the page's own summary of itself and
  // carry no personal data; the records behind them carry client names.
  const apiSrc = read('frontend/src/lib/api.js');
  const method = apiSrc.slice(apiSrc.indexOf('aiWorkspaceExplain:'), apiSrc.indexOf('aiWorkspaceExplain:') + 500);
  assert.match(method, /\/ai\/workspace\/explain/);
  assert.match(method, /workspace, zone, coverage/);
  assert.match(method, /timeoutMs: 60_000/,
    'a model call is not a read; the 30s default would abort a run still being paid for');
});

test('the model the caller picks is the model the route asks for', () => {
  // The gap this closes is silent and expensive. The rail lets a founder pick
  // a cheaper model and renders that model's rate beside it; a route that
  // reads `model` and forgets to forward it would run the 70b at eight times
  // the price the screen just quoted, report success, and log the run under a
  // model the founder did not choose. Nothing else in the stack notices —
  // `run()` is happy, the usage row is consistent with itself, and only the
  // invoice disagrees.
  const handler = SRC.slice(SRC.indexOf("ai.post('/workspace/explain'"));
  assert.match(handler, /const model = String\(body\?\.model \|\| ''\)/,
    'the route no longer reads a caller-chosen model');
  const runCall = handler.slice(handler.indexOf('aiRun('), handler.indexOf('aiRun(') + 400);
  assert.match(runCall, /^\s*model,\s*$/m,
    'the route reads `model` and does not pass it to aiRun');
});

test('the route keeps no allow-list of its own', () => {
  // `run()` owns the list. A second copy here is a second thing to keep true,
  // and the failure mode of the copy going stale is the worst one available:
  // the route rejects a model the router would happily run, or forwards one it
  // will not, and the two disagree without anything failing.
  const handler = SRC.slice(SRC.indexOf("ai.post('/workspace/explain'"));
  assert.doesNotMatch(handler, /alternates/,
    'the route is re-deriving what models are offered instead of letting run() decide');
  assert.doesNotMatch(handler, /@cf\//,
    'the route names a model id; the router is the only place that may');
});

test('a model the task does not offer comes back as its own reason', () => {
  // Distinct from a spent budget and from an unreachable model, because the
  // fix is different: the request itself is wrong and re-running it unchanged
  // fails identically. The rail reads this to clear the saved choice — an
  // answer of "the model could not be reached" would have it retry forever.
  assert.match(SRC, /model_not_offered/);
  assert.match(SRC, /no longer offered for this page/);
  const refusal = SRC.slice(SRC.indexOf('if (!r.ok)'));
  assert.ok(refusal.indexOf('model_not_offered') < refusal.indexOf('budget_user_month'),
    'the request-was-wrong case must be distinguished before the budget cases');
});

/* ------------------------------------------------------------------ *
 * D154 · H13 rule 4 — "anything about a named branch is logged"
 * ------------------------------------------------------------------ */

/**
 * WHY THIS IS TESTED AT ALL, given D150 refused it.
 *
 * D150 declined to log a rail read-back, and its reason was right: the rail
 * summarises coverage lines the PAGE rendered, not rows, so no branch was
 * named in them and a row claiming one had been read would have been FALSE.
 * D153's view-as overlay changed the fact under that reason — under it a page
 * routes its reads through one branch, so those same lines are that branch's
 * figures. The rule then applies on the canvas's own terms: "reading a branch
 * is a privileged act even when it is only a question."
 *
 * So the row is conditional, and BOTH directions matter. A row on every run
 * would resurrect exactly the false entry D150 refused; no row on a scoped run
 * leaves a privileged read with no trace.
 */
function envThatRecordsWrites() {
  const sql: string[] = [];
  const binds: unknown[][] = [];
  return {
    sql,
    binds,
    env: {
      JWT_SECRET,
      DB: {
        prepare: (q: string) => {
          sql.push(q);
          let bound: unknown[] = [];
          const api: any = {
            bind: (...b: unknown[]) => { bound = b; binds.push(b); return api; },
            // THE ACCOUNT LOOKUP HAS TO ANSWER, or every test below passes
            // without reaching a line of the code it claims to test — which is
            // exactly what the first version of this harness did: `first()`
            // returned null, `requireAuth` threw, and the two NEGATIVE tests
            // went green because nothing ran at all. An assertion that cannot
            // fail is not a guard, and a fixture that cannot authenticate
            // makes every assertion behind it one.
            // The live session row. Without it `getCurrentUser` refuses the
            // Bearer and every assertion behind this fixture is vacuous.
            first: async () => (/FROM user_sessions/i.test(q)
              ? { revoked_at: null, step_up_due_at: null }
              : null),
            // `getCurrentUser` reads the account through a tagged-template
            // helper that returns an ARRAY, not through `.first()` — measured
            // by probing the real route rather than assumed, after a fixture
            // that only answered `.first()` authenticated nobody.
            all: async () => ({
              results: /FROM\s+users/i.test(q)
                ? [{ id: USER_ID, email: 'hq@axal.vc', role: 'admin', is_active: 1, name: 'HQ' }]
                : [],
            }),
            run: async () => ({ meta: { changes: 1 }, bound }),
          };
          return api;
        },
        exec: async () => ({ count: 0, duration: 0 }),
      },
      AI: { run: async () => ({ response: 'x' }) },
    } as any,
  };
}

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const USER_ID = 7;

/** A Bearer for that account, minted the way sign-in does. */
async function bearer(env: any): Promise<Record<string, string>> {
  const token = await createJWT(env, USER_ID, 'hq@axal.vc', 'admin', undefined, `jti-${USER_ID}`);
  return { authorization: `Bearer ${token}` };
}

const auditWrites = (sql: string[]) => sql.filter((q) => /INSERT INTO admin_audit_log/i.test(q));

test('rule 4 — a scoped read-back writes ONE audit row naming the branch', async () => {
  const { env, sql, binds } = envThatRecordsWrites();
  await post(
    { workspace: 'HQ', zone: 'Read-only branch view', coverage: ['12 accounts on fr'], branch: 'fr' },
    env, await bearer(env),
  ).catch(() => null);
  const rows = auditWrites(sql);
  assert.equal(rows.length, 1, 'a scoped read-back left no audit row, or left more than one');
  assert.match(rows[0], /'ai_branch_readback'/, 'the row does not say what act it records');
  // The branch is IN the row, not merely implied by its existence. A row that
  // recorded "a branch was read" without saying which answers nothing.
  const payload = binds.find((b) => b.some((v) => typeof v === 'string' && v.includes('ai_branch_readback')))
    || binds.find((b) => b.some((v) => typeof v === 'string' && v.includes('"branch"')));
  assert.ok(payload, 'the audit row was prepared but never bound');
  assert.ok(
    payload.some((v) => typeof v === 'string' && v.includes('"branch":"fr"')),
    'the audit row does not name the branch it recorded',
  );
});

test('rule 4 — an UNSCOPED read-back writes nothing, which is D150\'s point kept', async () => {
  const { env, sql } = envThatRecordsWrites();
  await post({ workspace: 'HQ', coverage: ['4 licences on the ledger'] }, env, await bearer(env)).catch(() => null);
  assert.deepEqual(
    auditWrites(sql),
    [],
    'an unscoped run wrote a branch-read audit row — the false entry D150 refused to write',
  );
});

test('rule 4 — a branch code that is not one is not logged as though it were', async () => {
  // The value arrives from a client. Logging it unvalidated would put arbitrary
  // text into the audit trail under a column an operator reads as a branch.
  for (const bad of ['../etc', 'All branches', 'FR; DROP', '', 'a'.repeat(200)]) {
    const { env, sql } = envThatRecordsWrites();
    await post({ workspace: 'HQ', coverage: ['1 row'], branch: bad }, env, await bearer(env)).catch(() => null);
    assert.deepEqual(auditWrites(sql), [], `"${bad.slice(0, 20)}" was logged as a branch code`);
  }
});

test('rule 4 — the row is written BEFORE the run, so a refused read still leaves one', () => {
  // "What was asked of this branch" is the question the row answers, and the
  // reads an operator most wants to see are the ones that did not come back.
  const handler = SRC.slice(SRC.indexOf("ai.post('/workspace/explain'"));
  const auditAt = handler.indexOf("'ai_branch_readback'");
  const runAt = handler.indexOf('aiRun(');
  assert.ok(auditAt > 0, 'the branch read-back is no longer audited');
  assert.ok(auditAt < runAt, 'the audit row is written after the run, so a refused read leaves no trace');
});
