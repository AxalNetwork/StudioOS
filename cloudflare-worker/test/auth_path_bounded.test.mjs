/**
 * THE AUTH PATH MAY NOT AWAIT SOMETHING THAT CAN NEVER ANSWER.
 *
 * On 2026-09-12 sign-in on axal.vc returned the browser's own "The server did
 * not respond within 30s. Nothing was changed." — and the production D1 showed
 * the request had not reached its first INSERT. Nothing was in the log, because
 * nothing had failed: every remote call on that path was awaited with no bound
 * on how long it might take, and a call that never answers is not an error. The
 * fail-open, the 503, the cookie fallback — each already written and each
 * correct — were unreachable for as long as the stall lasted.
 *
 * The same outage is why the Continue with Google button vanished from /login:
 * LoginPage probes `/api/auth/google/start` on mount and hides the control if
 * the probe does not resolve. One stall, two symptoms, and the second one looked
 * cosmetic.
 *
 * So this file asserts the SHAPE, not the incident: in the files that answer a
 * sign-in, every `fetch` carries a signal and every awaited KV call carries a
 * deadline. It then proves the shape does its job by running the rate-limit
 * middleware against a KV namespace whose promises never settle, and requiring
 * an answer.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/auth_path_bounded.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { codeOnly, callArgs } from './_codeOnly.mjs';

const SRC = path.resolve(import.meta.dirname, '../src');

// THE WATCHED SET is every file a sign-in touches before it can answer: the
// middleware that runs on all of /api/*, the auth routes themselves, and the
// services they call out through. Adding a file here is cheap; the cost of
// leaving one out was a day of nobody being able to log in.
function watched() {
  const out = [];
  const add = (p) => out.push(p);
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) add(p);
    }
  };
  walk(path.join(SRC, 'middleware'));
  for (const e of readdirSync(path.join(SRC, 'routes'))) {
    if (/^auth.*\.ts$/.test(e)) add(path.join(SRC, 'routes', e));
  }
  walk(path.join(SRC, 'services', 'email'));
  add(path.join(SRC, 'services', 'email.ts'));
  add(path.join(SRC, 'services', 'turnstile.ts'));
  add(path.join(SRC, 'services', 'authBlockersSchema.ts'));
  return out;
}

const FILES = watched().map((p) => ({
  rel: path.relative(SRC, p),
  code: codeOnly(readFileSync(p, 'utf8')),
}));

test('the watched set is the auth path, and it is not empty', () => {
  // A scanner over zero files passes every assertion below. This is the control
  // that says the walk actually found something.
  assert.ok(FILES.length >= 10, `expected ≥10 watched files, found ${FILES.length}`);
  for (const must of [
    'middleware/rateLimit.ts', 'routes/auth.ts', 'routes/auth_google.ts',
    'services/email.ts', 'services/email/gmail.ts', 'services/turnstile.ts',
    'services/authBlockersSchema.ts',
  ]) {
    assert.ok(FILES.some((f) => f.rel === must), `watched set is missing ${must}`);
  }
});

test('every fetch on the auth path carries a timeout signal', () => {
  const bare = [];
  for (const { rel, code } of FILES) {
    const re = /\bfetch\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      const open = code.indexOf('(', m.index);
      const args = callArgs(code, open);
      if (/\bsignal\s*:/.test(args)) continue;
      const line = code.slice(0, m.index).split('\n').length;
      bare.push(`${rel}:${line}`);
    }
  }
  assert.deepEqual(
    bare, [],
    'fetch with no `signal:` — use AbortSignal.timeout(ms). A hung connection '
    + 'never reaches the catch below it:\n  ' + bare.join('\n  '),
  );
});

test('every awaited KV call on the auth path carries a deadline', () => {
  // KV takes no AbortSignal, so a deadline is the only way to stop waiting.
  // `RATE_LIMITS` and `TOKENS` are the two KVNamespace bindings in types.ts.
  const bare = [];
  for (const { rel, code } of FILES) {
    const re = /\b(RATE_LIMITS|TOKENS)\s*\.\s*(get|put|delete|list)\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      // The deadline wraps the call, so it sits to the LEFT of the binding on
      // the same statement. Walk back to the statement start rather than the
      // line start: the wrapped form is routinely split across lines.
      const stmt = code.slice(0, m.index);
      const from = Math.max(
        stmt.lastIndexOf(';'), stmt.lastIndexOf('{'), stmt.lastIndexOf('}'),
      );
      const head = code.slice(from + 1, m.index);
      if (/withDeadline\s*\(/.test(head)) continue;
      // A call that is never awaited cannot hang a response. `waitUntil` work
      // and bare fire-and-forget are out of scope.
      if (!/\bawait\b/.test(head)) continue;
      const line = stmt.split('\n').length;
      bare.push(`${rel}:${line} (${m[1]}.${m[2]})`);
    }
  }
  assert.deepEqual(
    bare, [],
    'awaited KV call with no withDeadline(...):\n  ' + bare.join('\n  '),
  );
});

test('the two endpoints that broke are not exempt from the limiter — by design, now bounded', () => {
  // The exempt list is why the outage hit exactly these two: /api/auth/me is on
  // it and kept answering, /api/auth/magic/start and /api/auth/google/start are
  // not and hung. Exempting them would ALSO have hidden the symptom, which is
  // the wrong fix — /magic/start carries its own stricter per-IP and per-email
  // limiters and must keep them. This pins the decision so nobody "fixes" a
  // future stall by quietly removing a limiter.
  const code = codeOnly(readFileSync(path.join(SRC, 'middleware/rateLimit.ts'), 'utf8'));
  const exempt = code.slice(code.indexOf('RATE_LIMIT_EXEMPT'));
  const list = exempt.slice(exempt.indexOf('['), exempt.indexOf(']'));
  assert.ok(!list.includes('/api/auth/magic/start'), 'magic/start must stay behind the limiter');
  assert.ok(!list.includes('/api/auth/google/start'), 'google/start must stay behind the limiter');
});

test('magic/start does not make sign-in wait on the mail provider', () => {
  const code = codeOnly(readFileSync(path.join(SRC, 'routes/auth.ts'), 'utf8'));
  const start = code.indexOf("auth.post('/magic/start'");
  const end = code.indexOf("auth.get('/magic/verify'");
  assert.ok(start > 0 && end > start, 'could not slice the /magic/start handler');
  const handler = code.slice(start, end);
  assert.ok(
    /waitUntil\s*\(\s*deliver\s*\)/.test(handler),
    'the magic-link send must be handed to waitUntil: the token row is already '
    + 'committed, so the link is valid whether or not the provider answers',
  );
  assert.ok(
    !/await\s+sendEmail\s*\(/.test(handler),
    'awaiting sendEmail here couples the availability of sign-in to the '
    + 'availability of Gmail',
  );
});

test('a stalled rate-limit KV still answers, inside the deadline', async () => {
  const { rateLimitMiddleware } = await import('../src/middleware/rateLimit.ts');
  const { Hono } = await import('hono');

  // A namespace that accepts every call and settles none. This is the failure
  // the incident was: not an error, an absence.
  const nothing = () => new Promise(() => {});
  const deadKv = { get: nothing, put: nothing, delete: nothing, list: nothing };

  const app = new Hono();
  app.use('/api/*', rateLimitMiddleware());
  app.get('/api/settings/explainers', (c) => c.json({ ok: true }));

  const env = { RATE_LIMITS: deadKv, DB: { prepare: () => ({ bind: () => ({ run: nothing }) }) } };
  // Hono's c.executionCtx THROWS when absent, and the middleware reads it.
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

  const began = Date.now();
  const res = await app.fetch(
    new Request('https://axal.vc/api/settings/explainers', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    }),
    env,
    ctx,
  );
  const took = Date.now() - began;

  assert.equal(res.status, 200, 'a fail-open bucket must let the request through');
  assert.deepEqual(await res.json(), { ok: true });
  // One deadline, not one per matching bucket: `global` matches every /api/
  // path alongside any specific bucket, and each would otherwise pay its own.
  assert.ok(took < 4_000, `answered in ${took}ms — expected one ~2s deadline, not several`);
});

test('a stalled KV still 503s where the bucket declares fail-closed', async () => {
  const { rateLimitMiddleware } = await import('../src/middleware/rateLimit.ts');
  const { Hono } = await import('hono');
  const nothing = () => new Promise(() => {});

  const app = new Hono();
  app.use('/api/*', rateLimitMiddleware());
  app.post('/api/auth/register', (c) => c.json({ ok: true }));

  const env = {
    RATE_LIMITS: { get: nothing, put: nothing, delete: nothing, list: nothing },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
  };
  const res = await app.fetch(
    new Request('https://axal.vc/api/auth/register', {
      method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.8' },
    }),
    env,
    { waitUntil: () => {}, passThroughOnException: () => {} },
  );
  assert.equal(res.status, 503, 'the register bucket is failClosed; a stall must reject');
  const body = await res.json();
  assert.equal(body.code, 'rate_limit_unavailable');
  // The message must say the limiter is what failed. "Too many requests" here
  // would blame the person for our outage.
  assert.match(body.detail, /temporarily unavailable/i);
});

test('withDeadline: resolves, throws on a stall, and swallows the straggler', async () => {
  const { withDeadline, DeadlineExceeded } = await import('../src/util/deadline.ts');

  assert.equal(await withDeadline(Promise.resolve(7), 1_000, 'ok'), 7);

  await assert.rejects(
    () => withDeadline(new Promise(() => {}), 30, 'stall'),
    (e) => e instanceof DeadlineExceeded && /did not answer within 30ms/.test(e.message),
  );

  // A straggler that rejects AFTER we stopped waiting must not surface as an
  // unhandled rejection — by then the response has gone out and the isolate
  // would log a failure nobody can act on.
  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e; };
  process.on('unhandledRejection', onUnhandled);
  let reject;
  const late = new Promise((_, rj) => { reject = rj; });
  await assert.rejects(() => withDeadline(late, 20, 'late'), (e) => e instanceof DeadlineExceeded);
  reject(new Error('too late'));
  await new Promise((r) => setTimeout(r, 60));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, null, `straggler rejection escaped: ${unhandled}`);
});

test('the auth-blockers bootstrap gives up rather than holding up a sign-in', async () => {
  const { ensureAuthBlockersSchema } = await import('../src/services/authBlockersSchema.ts');
  const nothing = () => new Promise(() => {});
  const env = { DB: { prepare: () => ({ run: nothing }) } };

  const began = Date.now();
  await ensureAuthBlockersSchema(env);            // must return, not hang
  const first = Date.now() - began;
  assert.ok(first < 5_000, `first call took ${first}ms — expected the ~3s deadline`);

  // And the cooldown must hold: without it a slow D1 makes every request re-run
  // all eleven statements and wait all over again.
  const again = Date.now();
  await ensureAuthBlockersSchema(env);
  assert.ok(Date.now() - again < 200, 'a second call must be skipped, not re-paid');
});
