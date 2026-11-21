/**
 * D4870 part 2 (#4870) — the throwaway probe Worker of the hosted gateway live
 * check (`src/probes/gatewayLiveCheck.ts`). The binding is a stub: no live call
 * is made and no gateway exists.
 *
 *   1. The call is built as `callGateway` builds it: the owner's gateway id, the
 *      router's option (log collection off, cache skipped, gateway retries off),
 *      the payload header off, the raw response, the synthetic prompt only.
 *   2. The answer: the pin, the usage, D851's settled charge at multiplier 1, and
 *      the log read with `logCarriesNoPayload` (no payload, payload, absent).
 *   3. The rows `runGatewayTextModel` would mark `reconcile: 'gateway_log'`.
 *   4. The handler refuses anything but the run's token on a preview Worker,
 *      and its answer never carries the answer's text or a log head.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/gateway_live_check_d4870.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import probe, { PROBE_REQUEST, reconcileMarked, runProbe } from '../src/probes/gatewayLiveCheck.ts';
import { GATEWAY_TEXT_MODELS } from '../src/services/ai/catalogue.ts';
import { usdRatesBilledMicro } from '../src/services/ai/pricing.ts';
import { GATEWAY_LOG_PAYLOAD_HEADER } from '../src/services/aiProviders.ts';

const M = GATEWAY_TEXT_MODELS[0];
const SECRET_ANSWER = 'ready-synthetic-answer-text';
const TOKEN = 'a'.repeat(64);
const USAGE = { prompt_tokens: 40, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 100 } };
const SETTLED = usdRatesBilledMicro(M.rates, { tokens_in: 40, tokens_cached: 0, tokens_out: 120 }, 1);

const answer = (over: Record<string, unknown> = {}, headers: Record<string, string> = { 'cf-aig-log-id': 'log_s4870_1' }, status = 200) => new Response(JSON.stringify({
  model: 'gpt-5-mini-2025-08-07', gatewayMetadata: { keySource: 'Unified' }, usage: USAGE,
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: SECRET_ANSWER, refusal: null } }], ...over,
}), { status, headers });

type LogReply = Record<string, unknown> | 'missing';
function stubAi(reply: () => Response | Promise<never>, logs: LogReply[] = [{ tokens_in: 40, tokens_out: 120, cost: SETTLED / 1e6 }]) {
  const calls: Array<{ model: string; input: any; options: any }> = [];
  const logReads: string[] = [];
  return {
    calls, logReads,
    ai: {
      async run(model: string, input: unknown, options: Record<string, unknown>) { calls.push({ model, input, options }); return reply(); },
      gateway(id: string) {
        return {
          async getLog(logId: string) {
            logReads.push(`${id}:${logId}`);
            const next = logs.length > 1 ? logs.shift()! : logs[0];
            if (next === 'missing') throw new Error('AiGatewayLogNotFound');
            return next;
          },
        };
      },
    },
  };
}
const env = (ai: unknown, over: Record<string, unknown> = {}) =>
  ({ AI: ai, ENVIRONMENT: 'preview', STUDIOOS_ENV: 'preview', CF_AI_GATEWAY_SLUG_PROVIDERS: 'owner-gw', AI_GATEWAY_PROVIDERS_ZDR: 'on', PROBE_TOKEN: TOKEN, ...over }) as any;
const noSleep = async () => {};

test('the call is built as callGateway builds it, on the synthetic prompt only', async () => {
  const s = stubAi(() => answer());
  await runProbe(env(s.ai), 'a1', noSleep);
  assert.equal(s.calls.length, 1, 'one call, no retry');
  const [c] = s.calls;
  assert.equal(c.model, 'openai/gpt-5-mini');
  assert.deepEqual(c.input, { messages: [{ role: 'system', content: PROBE_REQUEST.system }, { role: 'user', content: PROBE_REQUEST.messages[0].content }], max_completion_tokens: 256 });
  assert.equal(c.options.gateway.id, 'owner-gw');
  assert.equal(c.options.gateway.collectLog, false);
  assert.equal(c.options.gateway.skipCache, true);
  assert.deepEqual(c.options.gateway.retries, { maxAttempts: 1 });
  assert.equal(c.options.gateway.metadata.execution, 's4870:live:a1');
  assert.equal(c.options.gateway.metadata.account, undefined, 'no member: no account metadata');
  assert.equal(c.options.extraHeaders[GATEWAY_LOG_PAYLOAD_HEADER], 'false');
  assert.equal(c.options.returnRawResponse, true);
  assert.equal('temperature' in c.input, false);
});

test('an answer: pinned, its usage, the settled charge at multiplier 1, a log with no payload', async () => {
  const s = stubAi(() => answer());
  const p: any = await runProbe(env(s.ai), 'a1', noSleep);
  assert.deepEqual(p.call, { ok: true, status: 200, finish_reason: 'stop', output_chars: SECRET_ANSWER.length });
  assert.deepEqual(p.pin, { served_model_ok: true, key_source: 'Unified' });
  assert.deepEqual(p.usage, { tokens_in: 40, tokens_cached: 0, tokens_out: 120 });
  assert.equal(p.reasoning_tokens, 100);
  assert.equal(p.charge.settled_microusd, SETTLED);
  assert.ok(SETTLED > 0);
  assert.deepEqual(p.log, { state: 'no_payload', reads: 1, tokens_in: 40, tokens_out: 120, cost_usd: SETTLED / 1e6 });
  assert.deepEqual(s.logReads, ['owner-gw:log_s4870_1'], 'the call\'s own log entry, on the owner\'s gateway');
  assert.equal(p.reconcile_marked, 0);
  assert.doesNotMatch(JSON.stringify(p), new RegExp(SECRET_ANSWER), 'never the answer\'s text');
});

test('a log entry carrying a payload is reported as such, and its head is never returned', async () => {
  const s = stubAi(() => answer(), [{ tokens_in: 40, tokens_out: 120, cost: 0.0001, request_head: '{"messages":[SECRET]}', response_head: 'SECRET' }]);
  const p: any = await runProbe(env(s.ai), 'a1', noSleep);
  assert.equal(p.log.state, 'payload_present');
  assert.doesNotMatch(JSON.stringify(p), /SECRET/);
});

test('a log entry that never lands is absent after bounded reads; no log id is no read', async () => {
  const slept: number[] = [];
  const s = stubAi(() => answer(), ['missing']);
  const p: any = await runProbe(env(s.ai), 'a1', async (ms) => { slept.push(ms); });
  assert.equal(p.log.state, 'absent');
  assert.equal(p.log.reads, 6);
  assert.equal(slept.length, 5, 'no wait after the last read');

  const late = stubAi(() => answer(), ['missing', 'missing', { cost: 0.00002, tokens_in: 40, tokens_out: 120 }]);
  assert.equal(((await runProbe(env(late.ai), 'a1', noSleep)) as any).log.reads, 3);

  const none = stubAi(() => answer({}, {}));
  const q: any = await runProbe(env(none.ai), 'a1', noSleep);
  assert.equal(q.log.state, 'no_log_id');
  assert.deepEqual(none.logReads, []);
});

test('the rows runGatewayTextModel would mark reconcile: gateway_log', async () => {
  const noUsage: any = await runProbe(env(stubAi(() => answer({ usage: undefined })).ai), 'a1', noSleep);
  assert.equal(noUsage.reconcile_marked, 1, 'an answer with no usage settles at the quote and is marked');
  assert.equal(noUsage.charge.settled_microusd, null);

  const byok: any = await runProbe(env(stubAi(() => answer({ gatewayMetadata: { keySource: 'BYOK' } })).ai), 'a1', noSleep);
  assert.equal(byok.pin.key_source, 'BYOK');
  assert.equal(byok.reconcile_marked, 1, 'a pin mismatch is marked');

  const timeout: any = await runProbe(env(stubAi(() => answer({}, {}, 504)).ai), 'a1', noSleep);
  assert.deepEqual([timeout.call.ok, timeout.call.error, timeout.call.completion, timeout.reconcile_marked], [false, 'timeout', 'unknown', 1]);

  const billing: any = await runProbe(env(stubAi(() => answer({ errors: [{ code: 2052, message: 'Insufficient balance' }] }, {}, 402)).ai), 'a1', noSleep);
  assert.deepEqual([billing.call.error, billing.call.completion, billing.reconcile_marked], ['billing', 'none', 0], 'refused before the provider ran: not marked');

  const thrown: any = await runProbe(env(stubAi(() => Promise.reject(new Error('internal SECRET'))).ai), 'a1', noSleep);
  assert.deepEqual([thrown.call.error, thrown.call.completion, thrown.reconcile_marked], ['unknown', 'unknown', 1]);
  assert.doesNotMatch(JSON.stringify(thrown), /SECRET/);

  assert.equal(reconcileMarked({ ok: false, error: 'rate_limited', status: 429, code: 2018, retryAfterSec: 1, completion: 'none', logId: null, usage: null }, false), 0);
});

test('misconfigured: no gateway id, ZDR not stated, or no binding, and no call', async () => {
  for (const over of [{ CF_AI_GATEWAY_SLUG_PROVIDERS: '' }, { AI_GATEWAY_PROVIDERS_ZDR: 'yes' }, { AI: undefined }]) {
    const s = stubAi(() => answer());
    assert.deepEqual(await runProbe(env(s.ai, over), 'a1', noSleep), { error: 'misconfigured' });
    assert.equal(s.calls.length, 0);
  }
});

test('the handler: preview only, POST /check only, the run token only', async () => {
  const req = (path = '/check?run=a1', init: RequestInit = { method: 'POST', headers: { 'x-probe-token': TOKEN } }) => new Request(`https://studioos-s4870-a1.example.workers.dev${path}`, init);
  const s = stubAi(() => answer());
  const statusOf = async (r: Request, e: any = env(s.ai)) => (await probe.fetch(r, e)).status;
  assert.equal(await statusOf(req(), env(s.ai, { ENVIRONMENT: 'production' })), 404);
  assert.equal(await statusOf(req(), env(s.ai, { STUDIOOS_ENV: 'production' })), 404);
  assert.equal(await statusOf(req(), env(s.ai, { ENVIRONMENT: undefined })), 404);
  assert.equal(await statusOf(req('/check', { method: 'GET' })), 404);
  assert.equal(await statusOf(req('/other', { method: 'POST', headers: { 'x-probe-token': TOKEN } })), 404);
  assert.equal(await statusOf(req('/check', { method: 'POST' })), 403);
  assert.equal(await statusOf(req('/check', { method: 'POST', headers: { 'x-probe-token': 'b'.repeat(64) } })), 403);
  assert.equal(await statusOf(req(), env(s.ai, { PROBE_TOKEN: 'short' })), 403, 'a short token is no token');
  assert.equal(await statusOf(req(), env(s.ai, { PROBE_TOKEN: undefined })), 403, 'before the secret is set, nothing runs');
  assert.equal(s.calls.length, 0, 'no refused request reached the gateway');

  const ok = await probe.fetch(req(), env(s.ai));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  const body: any = await ok.json();
  assert.equal(body.call.ok, true);
  assert.equal(s.calls.length, 1);
});
