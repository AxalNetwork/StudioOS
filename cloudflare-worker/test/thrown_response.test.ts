/**
 * A thrown Response must be the response.
 *
 * Nine gates in this worker refuse by THROWING a Response — the institutional
 * tier upsell, the MI and generic tier gates, `fundGpAccess`'s 404, the
 * integrations role gate, three billing refusals. Throwing is deliberate: a
 * gate that throws cannot be forgotten by a handler that ignores a return
 * value, which is the argument `services/fundGpAccess.ts` makes for having one
 * gate rather than twelve inline ones.
 *
 * It did not reach the client. Hono 4 re-throws anything that is not an
 * `Error` WITHOUT consulting `app.onError`, and `index.ts` returned
 * `app.fetch(...)` directly, so the rejection escaped to the runtime: the
 * caller got an opaque worker exception instead of the 402 carrying the
 * upsell, or the 404 saying the fund is not there.
 *
 * Every existing test of those refusals reads the SOURCE — funds_deadmin
 * checks gate order by reading the file, fundGpAccess.test.ts checks the shape
 * of `notFound()` the same way — which is why nothing caught it. The first
 * test below is therefore the one that matters: it drives a throw through a
 * real Hono router with a real `onError`, and would have failed before the fix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

/** The exact refusal `services/fundGpAccess.ts` throws. */
const notFound = () => new Response(JSON.stringify({ error: 'Fund not found' }), {
  status: 404, headers: { 'Content-Type': 'application/json' },
});

test('Hono re-throws a thrown Response past onError — the bug this fixes', async () => {
  const sub = new Hono();
  sub.get('/y', () => { throw notFound(); });
  const app = new Hono();
  app.route('/api/funds', sub);
  let onErrorSaw: string | null = null;
  app.onError((err: any, c) => {
    onErrorSaw = err?.constructor?.name ?? 'unknown';
    return c.json({ detail: 'Internal server error' }, 500);
  });

  // Unwrapped: the throw escapes the router entirely. onError is not even
  // called, so an app-level handler cannot be the place this gets fixed.
  //
  // Plain try/catch and not assert.rejects: that helper re-throws a rejection
  // value that is not an Error instead of handing it to the validator, so it
  // cannot express "rejects with a Response" at all.
  let escaped: unknown = null;
  try { await app.request('/api/funds/y'); } catch (e) { escaped = e; }
  assert.ok(escaped instanceof Response, 'the Response escapes the router');
  assert.equal((escaped as Response).status, 404);
  assert.equal(onErrorSaw, null, 'onError never sees a non-Error');

  // Wrapped exactly as index.ts wraps app.fetch: the refusal is the response,
  // body and status intact.
  const res = await withThrownResponses(() => app.request('/api/funds/y'));
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Fund not found' });
});

test('a normal response passes through untouched', async () => {
  const res = await withThrownResponses(() => new Response('ok', { status: 201 }));
  assert.equal(res.status, 201);
  assert.equal(await res.text(), 'ok');
});

test('a real Error is re-thrown, so app.onError still handles errors', async () => {
  // The narrow claim: this catches Responses and nothing else. Swallowing
  // Errors here would turn every genuine 500 into a silent success and take
  // the app's error mapping (step_up_required, AUTH_ERROR_STATUSES) with it.
  await assert.rejects(
    () => withThrownResponses(() => { throw new Error('boom'); }),
    /boom/,
  );
  await assert.rejects(
    () => withThrownResponses(async () => { throw new TypeError('async boom'); }),
    TypeError,
  );
});

test('index.ts routes every request through the wrapper', () => {
  // The helper is worthless unwired, and there are TWO returns of app.fetch —
  // the non-/api/ branch and the /api/ one. A fix applied to only one leaves
  // half the worker throwing.
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.equal((src.match(/withThrownResponses\(\(\) => app\.fetch\(/g) || []).length, 2);
  assert.doesNotMatch(src, /\n\s*return app\.fetch\(/, 'no unwrapped app.fetch may remain');
});
