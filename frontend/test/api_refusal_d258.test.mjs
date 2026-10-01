/**
 * D258 — a refusal shows its sentence, and its code travels on `e.code`.
 *
 * WHAT WAS WRONG. `request()` built `e.message` as errorObj.message, then a
 * string `error`, then detailObj.message, then a string `detail`, and only
 * then the body's own `message` — fifth. About 190 Worker refusals are shaped
 * `{ error: '<code>', message: '<sentence>' }`, so a page printing `e.message`
 * printed `kind_not_available` where the Worker had written a sentence for the
 * person reading it. An HTTP refusal carried no `e.code` at all. And fifteen
 * raw-fetch helpers in the same file built their own Error from a body, in
 * four different orders.
 *
 * WHAT IS ASSERTED, AND HOW. The mapping is driven through the REAL
 * `request()` and one real raw-fetch helper with `fetch` stubbed, because what
 * a refusal becomes is the whole point and a source scan cannot see it. The
 * stub answers with a real `Response`, so `ok` is derived from the status the
 * same way the browser derives it. `readRefusal` is also called directly, for
 * the inputs a Response cannot easily produce. Then a structural test holds
 * the property that keeps fifteen roots from becoming fifteen again, and a
 * cross-tier test holds the premise of the code rule.
 *
 * WHAT IS DELIBERATELY NOT PRODUCED HERE. There is no DOM, so no refusal here
 * is a 401 — that branch reads `window.location` to decide on a redirect.
 * The 402 and 423 branches also dispatch window events, which are skipped
 * without a `window`. The throw they all end in is the same one tested here,
 * which is what a page's own catch receives. The 403 step-up branch does run:
 * with no modal to answer it, it rethrows the original refusal, and that is the
 * path which shows the code surviving it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { api, readRefusal, REFUSAL_CODE, request, timeoutError } from '../src/lib/api.js';
import { codeOnly } from './_codeOnly.mjs';

// `request()` reads the auth token, the active company and the CSRF cookie on
// its way out. Signed out, no company, no cookie.
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.document ??= { cookie: '' };

/** Swap in a fake `fetch` for one call and always put the real one back. */
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/** A refusal exactly as `fetch` hands it over. A string body is sent as is. */
function refusalResponse(status, body, statusText = '') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, statusText, headers: { 'content-type': 'application/json' } });
}

/** What a page's catch receives when `request()` meets this refusal. */
async function refuse(status, body, statusText = '', path = '/branch/escalations') {
  return withFetch(
    async () => refusalResponse(status, body, statusText),
    () => request(path, { method: 'POST', body: '{}' }).then(
      () => assert.fail(`a ${status} was answered as a success`),
      (e) => e,
    ),
  );
}

const SENTENCE = 'This kind is not available on your licence. Raise it as a content submission instead.';

// ── The message order and the code, through request() ─────────────────────

test('a code in `error` beside a `message` shows the message, and the code travels on e.code', async () => {
  const body = { error: 'kind_not_available', message: SENTENCE };
  const e = await refuse(409, body);
  assert.ok(e instanceof Error);
  assert.equal(e.message, SENTENCE, 'the page printed the code instead of the sentence written for it');
  assert.equal(e.code, 'kind_not_available');
  assert.equal(e.status, 409);
  // e.data and e.field are unchanged by D258: a page that reads the code off
  // e.data keeps working.
  assert.deepEqual(e.data, body);
  assert.equal(e.field, null);
});

test('a sentence in `error` is the message, and never becomes a code', async () => {
  const e = await refuse(400, { error: 'That email address is already registered.' });
  assert.equal(e.message, 'That email address is already registered.');
  assert.equal(e.code, undefined, 'a sentence became e.code');

  // A one-word HTTP reason phrase is a word, not a code: capitalised, so it is
  // printed as it is and nothing branches on it.
  const f = await refuse(403, { error: 'Forbidden' });
  assert.equal(f.message, 'Forbidden');
  assert.equal(f.code, undefined);
});

test('the shapes that already read a sentence read the same one', async () => {
  const detail = await refuse(400, { detail: SENTENCE });
  assert.equal(detail.message, SENTENCE);
  assert.equal(detail.code, undefined);

  const errorObj = await refuse(422, { error: { message: SENTENCE, code: 'invalid_stage' } });
  assert.equal(errorObj.message, SENTENCE);
  assert.equal(errorObj.code, 'invalid_stage');
  assert.deepEqual(errorObj.data, { message: SENTENCE, code: 'invalid_stage' });

  const detailObj = await refuse(422, { detail: { message: SENTENCE } });
  assert.equal(detailObj.message, SENTENCE);
  assert.deepEqual(detailObj.data, { message: SENTENCE });
});

test('a code named in `code` travels beside a sentence in `error`, the step-up refusal included', async () => {
  const conflict = await refuse(409, { code: 'step_up_required', error: SENTENCE });
  assert.equal(conflict.message, SENTENCE);
  assert.equal(conflict.code, 'step_up_required');

  // The real 403: with no modal mounted the step-up branch cannot prompt, so it
  // rethrows the ORIGINAL refusal — which must still carry its code.
  const stepUp = await refuse(403, { code: 'step_up_required', error: SENTENCE, ttl_minutes: 15 });
  assert.equal(stepUp.status, 403);
  assert.equal(stepUp.message, SENTENCE);
  assert.equal(stepUp.code, 'step_up_required');

  // The two 423 banners key on the same field a page can now read.
  const frozen = await refuse(423, { detail: SENTENCE, code: 'admin_frozen', notice: { uid: 'n_1' } });
  assert.equal(frozen.message, SENTENCE);
  assert.equal(frozen.code, 'admin_frozen');
  const suspended = await refuse(423, { detail: SENTENCE, code: 'branch_suspended', since: '2026-09-01 00:00:00' });
  assert.equal(suspended.code, 'branch_suspended');
});

test('a code in `error` gives way to a human `detail`', async () => {
  const e = await refuse(400, { error: 'invalid_market_sizing', detail: 'SAM cannot exceed TAM' });
  assert.equal(e.message, 'SAM cannot exceed TAM', 'the code beat the sentence written for the founder');
  assert.equal(e.code, 'invalid_market_sizing');
});

test('a sentence in `error` keeps its place ahead of a provider\'s raw `detail`', async () => {
  // Seven Worker sites pair a sentence `error` with the provider's own text in
  // `detail`. "detail first" would put Stripe's JSON on the screen.
  const e = await refuse(502, {
    error: 'Stripe refund failed',
    detail: '{"error":{"code":"charge_already_refunded","message":"Charge ch_test_000 has already been refunded."}}',
  });
  assert.equal(e.message, 'Stripe refund failed');
  assert.equal(e.code, undefined);
});

test('\'timeout\' belongs to the client deadline alone', async () => {
  // routes/competitors.ts can answer 422 { error: 'timeout' } when a web fetch
  // it made was aborted. _analyticsRead stops retrying on e.code === 'timeout',
  // so an HTTP refusal must never carry it.
  const bare = await refuse(422, { error: 'timeout' });
  assert.equal(bare.code, undefined, 'an HTTP refusal claimed the client deadline\'s code');
  assert.equal(bare.message, 'timeout', 'with nothing else to say, the code is the last-resort text');

  const named = await refuse(504, { code: 'timeout', error: 'The upstream fetch took too long.' });
  assert.equal(named.code, undefined);
  assert.equal(named.message, 'The upstream fetch took too long.');

  const nested = await refuse(504, { error: { code: 'timeout', message: SENTENCE } });
  assert.equal(nested.code, undefined);

  assert.equal(timeoutError('/x', 30_000, 'GET').code, 'timeout', 'the deadline lost its own flag');
});

test('an uppercase code travels in `code`, where it is not shape-checked', async () => {
  // routes/projects.ts answers a premium deck method on the free tier this way.
  const e = await refuse(402, { error: 'paywall', code: 'PAYWALL_PREMIUM_METHOD' });
  assert.equal(e.code, 'PAYWALL_PREMIUM_METHOD');
  assert.equal(e.message, 'paywall');
  assert.equal(e.status, 402);
});

test('a numeric `code` is not a code, and the status line stands in for a missing sentence', async () => {
  const e = await refuse(503, { code: 503 }, 'Service Unavailable');
  assert.equal(e.code, undefined);
  assert.equal(e.message, 'Service Unavailable');
});

test('a body that is not an object reads as no body at all', async () => {
  const nul = await refuse(500, 'null', 'Internal Server Error');
  assert.equal(nul.message, 'Internal Server Error');
  assert.equal(nul.code, undefined);
  assert.equal(nul.data, null);

  const html = await refuse(502, '<html><body>Bad gateway</body></html>', 'Bad Gateway');
  assert.equal(html.message, 'Bad Gateway');

  // Over HTTP/2 the status line is empty, so this is what production shows.
  const bare = await refuse(502, '<html></html>', '');
  assert.equal(bare.message, 'Request failed');
});

test('e.field still comes from the body, as it always has', async () => {
  const nested = await refuse(422, { detail: { field: 'email', message: SENTENCE } });
  assert.equal(nested.field, 'email');
  assert.equal(nested.message, SENTENCE);

  const flat = await refuse(422, { error: 'invalid_email', field: 'email', message: 'Enter a valid email address.' });
  assert.equal(flat.field, 'email');
  assert.equal(flat.code, 'invalid_email');
  assert.equal(flat.message, 'Enter a valid email address.');
});

// ── The one definition, called directly ────────────────────────────────────

test('readRefusal reads any body, and a body it cannot read gives nothing rather than throwing', () => {
  const none = { message: null, code: null };
  assert.deepEqual(readRefusal(undefined), none);
  assert.deepEqual(readRefusal(null), none);
  assert.deepEqual(readRefusal('kind_not_available'), none);
  assert.deepEqual(readRefusal(42), none);
  assert.deepEqual(readRefusal({}), none);
  // Whitespace is not a sentence, and blank is not a code.
  assert.deepEqual(readRefusal({ error: '   ', message: '', detail: ' ' }), none);
  assert.deepEqual(readRefusal({ message: 42, code: 7 }), none);

  assert.deepEqual(readRefusal({ error: 'no_method_id' }), { message: 'no_method_id', code: 'no_method_id' });
  assert.deepEqual(
    readRefusal({ error: 'not_found', detail: 'No startup with that id is visible to you.' }),
    { message: 'No startup with that id is visible to you.', code: 'not_found' },
  );
  assert.deepEqual(
    readRefusal({ error: { message: SENTENCE }, message: 'second', detail: { message: 'third' } }),
    { message: SENTENCE, code: null },
  );
  // A code in `code` wins over a code-shaped `error`.
  assert.deepEqual(
    readRefusal({ error: 'forbidden', code: 'kind_not_available', message: SENTENCE }),
    { message: SENTENCE, code: 'kind_not_available' },
  );
  // A code-shaped `detail` is a code too, once nothing sits above it.
  assert.deepEqual(readRefusal({ detail: 'already_detached' }), { message: 'already_detached', code: 'already_detached' });
});

test('the code shape is lower-case snake_case, and nothing else', () => {
  for (const code of ['kind_not_available', 'pii_linter_blocked', 'x_y', 'e164_invalid', 'a']) {
    assert.ok(REFUSAL_CODE.test(code), `${code} should read as a code`);
  }
  for (const text of ['A sentence.', 'Forbidden', 'PAYWALL_PREMIUM_METHOD', 'not-found', '2fa_required', 'stripe_error:402', '', 'kind not available']) {
    assert.ok(!REFUSAL_CODE.test(text), `${JSON.stringify(text)} should not read as a code`);
  }
});

// ── A raw-fetch helper, end to end ─────────────────────────────────────────

test('a raw-fetch helper builds its refusal through the same definition', async () => {
  const declined = await withFetch(
    async () => refusalResponse(409, { error: 'x_y', message: SENTENCE }),
    () => api.esignReject('tok_test', 'Not ours to sign').then(() => assert.fail('resolved'), (e) => e),
  );
  assert.equal(declined.message, SENTENCE);
  assert.equal(declined.code, 'x_y');
  assert.equal(declined.status, 409);

  const signed = await withFetch(
    async () => refusalResponse(400, { error: 'signature_invalid', detail: 'Signature must be a PNG canvas drawing' }),
    () => api.esignSubmitSignature('tok_test', {}).then(() => assert.fail('resolved'), (e) => e),
  );
  assert.equal(signed.message, 'Signature must be a PNG canvas drawing');
  assert.equal(signed.code, 'signature_invalid');

  // No readable body: the status line, then the helper's own sentence.
  const status = await withFetch(
    async () => refusalResponse(404, '<html></html>', 'Not Found'),
    () => api.esignFetchByToken('tok_test').then(() => assert.fail('resolved'), (e) => e),
  );
  assert.equal(status.message, 'Not Found');
  assert.equal(status.status, 404);
  assert.equal(status.code, undefined);

  const fallback = await withFetch(
    async () => refusalResponse(404, '<html></html>', ''),
    () => api.esignFetchByToken('tok_test').then(() => assert.fail('resolved'), (e) => e),
  );
  assert.equal(fallback.message, 'Failed to load signing envelope');
});

test('the LPA download keeps the server\'s two refusals apart, as D174 asked of it', async () => {
  // D174 pinned this helper as "the server's own reason survives the
  // transport", by matching the chain it used to build the message from. The
  // chain is gone; the property is held here, against the route's real bodies
  // (`routes/funds.ts`): the drawer prints the sentence, and a page that wants
  // to tell the two apart now has the code to do it with.
  const refused = await withFetch(
    async () => refusalResponse(403, { error: 'You are not an LP of this fund.', code: 'lpa_not_entitled' }),
    () => api.downloadFundLpa(7).then(() => assert.fail('resolved'), (e) => e),
  );
  assert.equal(refused.message, 'You are not an LP of this fund.');
  assert.equal(refused.code, 'lpa_not_entitled');
  assert.equal(refused.status, 403);

  const empty = await withFetch(
    async () => refusalResponse(404, { error: 'No LPA body is stored for this fund.', code: 'lpa_no_body' }),
    () => api.downloadFundLpa(7).then(() => assert.fail('resolved'), (e) => e),
  );
  assert.equal(empty.message, 'No LPA body is stored for this fund.');
  assert.equal(empty.code, 'lpa_no_body');
  assert.equal(empty.status, 404);
});

// ── The property that keeps it one definition ──────────────────────────────

const API_CODE = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/lib/api.js'), 'utf8'));

/** The index of `needle`, which must occur exactly once or the slice is ambiguous. */
function onlyOnce(needle, what) {
  const at = API_CODE.indexOf(needle);
  assert.ok(at >= 0, `${what}: "${needle}" is not in api.js`);
  assert.equal(API_CODE.indexOf(needle, at + 1), -1, `${what}: "${needle}" occurs more than once in api.js`);
  return at;
}

/** A function's body: from its unique signature to the next column-0 brace. */
function body(signature) {
  const at = onlyOnce(signature, signature);
  const end = API_CODE.indexOf('\n}\n', at);
  assert.ok(end > at, `${signature}: no closing brace at column 0`);
  return { at, end };
}

const lineOf = (i) => API_CODE.slice(0, i).split('\n').length;

test('api.js reads a refusal body in one place, and every refusal goes through it', () => {
  const readRefusalBody = body('export function readRefusal(');
  const refusalErrorBody = body('async function refusalError(');
  const requestStart = onlyOnce('export async function request(', 'request()');
  const requestEnd = onlyOnce('async function _analyticsRead(', 'the end of request()');
  assert.ok(requestEnd > requestStart);
  const inside = (i, span) => i >= span.at && i < span.end;
  const requestSpan = { at: requestStart, end: requestEnd };

  // Both constructions call the one definition.
  const calls = [...API_CODE.matchAll(/(?<!function )readRefusal\(/g)].map((m) => m.index);
  assert.ok(calls.some((i) => inside(i, requestSpan)), 'request() builds its refusal without readRefusal');
  assert.ok(calls.some((i) => inside(i, refusalErrorBody)), 'refusalError builds its refusal without readRefusal');

  // No helper-shaped precedence order anywhere: `x.detail || x.error`,
  // `x.message || x.error`, and the like.
  const chains = [
    ...API_CODE.matchAll(/\.(?:error|detail)\s*\|\|/g),
    ...API_CODE.matchAll(/\.message\s*\|\|\s*[\w.?]+\.(?:error|detail)\b/g),
  ].map((m) => `line ${lineOf(m.index)}: ${m[0]}`);
  assert.deepEqual(chains, [], 'a second precedence order reads a refusal body');

  // Every failed response a raw-fetch helper meets becomes its Error through
  // refusalError; the one exception is request()'s own branch.
  const failures = [...API_CODE.matchAll(/!\s*(\w+)\.ok\b/g)];
  assert.ok(failures.length >= 10, `only ${failures.length} failed-response checks were found; the scan has stopped reading the file`);
  const inRequest = failures.filter((m) => inside(m.index, requestSpan));
  assert.equal(inRequest.length, 1, 'request() should check res.ok exactly once');
  const strays = failures
    .filter((m) => !inside(m.index, requestSpan))
    .filter((m) => !/^!(\w+)\.ok\) throw await refusalError\(\1, /.test(API_CODE.slice(m.index, m.index + 60)))
    .map((m) => `line ${lineOf(m.index)}: ${API_CODE.slice(m.index, m.index + 60).split('\n')[0]}`);
  assert.deepEqual(strays, [], 'a raw-fetch helper builds a refusal of its own');

  // THE PART THE TWO PATTERNS ABOVE CANNOT SEE. request()'s old order was
  // written `(errorObj && errorObj.message) || (typeof err.error === 'string'
  // && err.error) || …` — every read wrapped in parentheses, so neither pattern
  // matched it. So: outside readRefusal, a `.message` is read only from
  // readRefusal's own result, the paywall event's upsell sentence (the 402
  // branch reads its raw body by design) and the outer catch's non-Error
  // throw — none of them the refusal's text.
  const ALLOWED_MESSAGE_READS = new Set(['refusal', 'tierPayload', 'error']);
  const messageReads = [...API_CODE.matchAll(/(\w+)\??\.message\b/g)]
    .filter((m) => !inside(m.index, readRefusalBody))
    .filter((m) => !ALLOWED_MESSAGE_READS.has(m[1]))
    .map((m) => `line ${lineOf(m.index)}: ${m[0]}`);
  assert.deepEqual(messageReads, [], 'a refusal\'s message is read outside readRefusal');

  // And outside readRefusal a body's `error` or `detail` is only ever compared
  // with a literal or taken as the object an `=== 'object'` check guards —
  // never read as text.
  const fieldReads = [...API_CODE.matchAll(/\w+\??\.(?:error|detail)\b/g)]
    .filter((m) => !inside(m.index, readRefusalBody))
    .filter((m) => {
      const after = API_CODE.slice(m.index + m[0].length, m.index + m[0].length + 40);
      const before = API_CODE.slice(Math.max(0, m.index - 4), m.index);
      const compared = /^\s*===\s*'/.test(after);
      const guardedObject = /\?\s*$/.test(before) && /^\s*:\s*null\b/.test(after);
      return !compared && !guardedObject;
    })
    .map((m) => `line ${lineOf(m.index)}: ${API_CODE.slice(m.index, m.index + 40).split('\n')[0]}`);
  assert.deepEqual(fieldReads, [], 'a refusal body\'s error or detail is read as text outside readRefusal');
});

// ── The premise of the code rule ───────────────────────────────────────────

/** Every .ts file under a directory. */
function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

test('every code the Worker sends in a bare `error` reads as a code here', () => {
  // A bare `error` becomes e.code only when it has the code shape. So a Worker
  // code spelled any other way — `not-found`, `Not_found` — would arrive as a
  // message with no e.code, and a page branching on it would never match.
  // The two HTTP reason phrases below are words the Worker means to be read.
  const WORDS = new Set(['Forbidden', 'Unauthorized']);
  const root = resolve(process.cwd(), 'cloudflare-worker/src');
  let seen = 0;
  const offShape = [];
  for (const file of tsFiles(root)) {
    const src = codeOnly(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/\berror:\s*(['"])([^'"\s]+)\1/g)) {
      seen += 1;
      const value = m[2];
      if (!REFUSAL_CODE.test(value) && !WORDS.has(value)) offShape.push(`${file.slice(root.length + 1)}: ${value}`);
    }
  }
  assert.ok(seen >= 300, `only ${seen} bare error values were read; the scan has stopped reading the Worker`);
  assert.deepEqual(offShape, [], 'a Worker code that the client would read as a sentence');
});
