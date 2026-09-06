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
