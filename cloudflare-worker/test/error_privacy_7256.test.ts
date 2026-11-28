/** D7256 (#7256): real HTTP refusals and diagnostic records must not serialize private exception context. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { refusalBody, rowFailureSentence } from '../src/util/refusal.ts';
import { errorDiagnostic, reportPrivateError } from '../src/util/errorPrivacy.ts';

// The private marker is assembled at runtime so no secret-shaped literal sits in source for scanners to flag.
const MARK = ['synthetic', 'private', '7256'].join('-');
const PRIVATE = `Bearer ${MARK}`;
const PATH = '/workspace/synthetic-private-7256/worker.ts';
const failures = [
  new TypeError('A value is missing.'), new ReferenceError('A variable is not defined.'),
  new Error('Failure\n    at callback (module.js:27:9)'),
  new TypeError(`Cannot read ${PRIVATE}`), new ReferenceError(PATH), new SyntaxError(`token=${PRIVATE}`),
  new RangeError(PATH), new URIError(PRIVATE), new EvalError(PATH), new AggregateError([new Error(PRIVATE)], PATH),
  new Error(`Failure\n    at privateFunction (${PATH}:27:9)`),
  new Error(`password="${MARK}"`), new Error(`api_key=${MARK}`), new Error(`Authorization: ${PRIVATE}`),
  new Error('read failed at C:\\private\\worker.ts'), new Error('https://user:synthetic-private-7256@example.test/api'),
  new Error(PRIVATE), new Error('-----BEGIN PRIVATE KEY----- synthetic-private-7256'),
];

function capture<T>(fn: () => T): { value: T; records: unknown[][] } {
  const original = console.error, records: unknown[][] = [];
  console.error = (...args: unknown[]) => { records.push(args); };
  try { return { value: fn(), records }; } finally { console.error = original; }
}

test('native runtime errors and private diagnostic messages get the same stable HTTP 500 body', async () => {
  for (const error of failures) {
    const app = new Hono();
    let logged: unknown[][] = [];
    app.get('/', c => { const out = capture(() => mapError(c as any, error)); logged = out.records; return out.value; });
    const response = await app.request('/');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { detail: 'Internal server error' });
    const serialized = JSON.stringify(logged);
    assert.doesNotMatch(serialized, /synthetic-private-7256|privateFunction|worker\.ts|Bearer|password|api_key/);
    assert.equal(logged.length, 1);
    const diagnostic = JSON.parse(String(logged[0][1]));
    assert.equal(diagnostic.event, 'map_error');
    assert.equal(typeof diagnostic.kind, 'string');
    assert.equal(diagnostic.message, undefined);
    assert.equal(diagnostic.stack, undefined);
  }
});

test('intentional validation, auth refusals and thrown Responses keep their existing contracts', async () => {
  const app = new Hono();
  app.get('/validation', c => mapError(c as any, new Error('A support session needs a reason of at least ten characters.')));
  app.get('/auth', c => mapError(c as any, new Error('Forbidden')));
  app.post('/json', async c => { try { await c.req.json(); return c.json({ ok: true }); } catch (error) { return mapError(c as any, error); } });
  const refusal = new Response('not found', { status: 404 });
  assert.equal(mapError({} as any, refusal), refusal);
  const validation = await app.request('/validation');
  assert.equal(validation.status, 400);
  assert.deepEqual(await validation.json(), { detail: 'A support session needs a reason of at least ten characters.' });
  assert.equal((await app.request('/auth')).status, 403);
  const malformed = await app.request('/json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"synthetic-private-7256":' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { detail: 'Invalid JSON request' });
});

test('all audiences withhold private provider context and logs retain a bounded error classification', () => {
  for (const audience of ['member', 'owner', 'admin'] as const) {
    for (const raw of [new Error(`card_declined: token=${PRIVATE}`), `card_declined: ${PATH}`, `card_declined\n at ${PATH}`]) {
      const { value, records } = capture(() => refusalBody({ code: 'checkout_failed', message: 'Checkout could not be completed.', raw, audience }));
      assert.equal(value.detail, 'Checkout could not be completed.');
      assert.equal(value.upstream, audience === 'member' ? undefined : 'Provider diagnostic withheld.');
      assert.doesNotMatch(JSON.stringify({ value, records }), /synthetic-private-7256|worker\.ts|Bearer/);
      assert.deepEqual(JSON.parse(String(records[0][1])), { event: 'refusal', kind: raw instanceof Error ? 'error' : 'non_error', code: 'checkout_failed', provider_code: 'card_declined' });
    }
  }
  const { value } = capture(() => refusalBody({ code: 'sync_failed', message: 'Sync failed.', raw: 'Rate limit exceeded.', audience: 'owner' }));
  assert.equal(value.upstream, 'Rate limit exceeded.');
});

test('custom error names, stack, cause and import-row exceptions never enter diagnostic records', () => {
  const error = new Error(PRIVATE, { cause: new Error(PATH) }); error.name = PRIVATE; error.stack = PATH;
  assert.deepEqual(errorDiagnostic(error), { kind: 'error' });
  const unreadable = new Error();
  Object.defineProperty(unreadable, 'message', { get() { throw new Error(PRIVATE); } });
  const safe = capture(() => reportPrivateError('edge_unhandled', unreadable));
  assert.deepEqual(safe.records, [['[error]', JSON.stringify({ event: 'edge_unhandled', kind: 'error' })]]);
  const { records } = capture(() => reportPrivateError('edge_unhandled', error));
  assert.deepEqual(records, [['[error]', JSON.stringify({ event: 'edge_unhandled', kind: 'error' })]]);
  const row = capture(() => rowFailureSentence(error));
  assert.equal(row.value, 'This row could not be saved, so it was skipped.');
  assert.doesNotMatch(JSON.stringify(row), /synthetic-private-7256|worker\.ts|Bearer/);
});

test('the production boundary and visual catch use the bounded logger while retaining generic public replies', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const worker = source('../src/index.ts');
  // D9186: the boundary's last branch moved to util/edgeError.ts, which logs with method and route.
  assert.match(worker, /return edgeFallback\(c, err\);\n\}\);/);
  assert.match(source('../src/util/edgeError.ts'), /reportPrivateError\('edge_unhandled', err, code, \{ method: c\.req\.method, route: routePattern\(c\) \}\)/);
  assert.doesNotMatch(worker, /console\.error\('\[edge\] unhandled error/);
  const visual = source('../../frontend/tests/visual/server.ts');
  assert.match(visual, /reportPrivateError\('visual_request', e\)/);
  assert.match(visual, /res\.end\('The visual test server could not answer this request\.'\)/);
  assert.match(visual, /server\.listen\(PORT, '127\.0\.0\.1'/);
});

test('runtime diagnostic kinds are stable without serializing error contents', () => {
  const examples: Array<[Error, string]> = [[new TypeError(PRIVATE), 'type_error'], [new ReferenceError(PRIVATE), 'reference_error'],
    [new SyntaxError(PRIVATE), 'syntax_error'], [new RangeError(PRIVATE), 'range_error'], [new URIError(PRIVATE), 'uri_error'],
    [new EvalError(PRIVATE), 'eval_error'], [new AggregateError([], PRIVATE), 'aggregate_error'], [new Error(PRIVATE), 'error']];
  for (const [error, kind] of examples) assert.deepEqual(errorDiagnostic(error), { kind });
  assert.deepEqual(errorDiagnostic({ message: PRIVATE, stack: PATH }), { kind: 'non_error' });
});
