/**
 * D278 — provider and database text stops reaching the page.
 *
 * The three audiences are also exercised through real routes elsewhere, each
 * re-aimed by D278 rather than loosened:
 *   member — trust_intro.test.mjs (DocuSign's text logged, never in the body)
 *   owner  — stripe_import_route.test.ts (our sentence, the reason on `upstream`)
 *   admin  — admin_licences_deploy.test.ts (GitHub's reason on `upstream`)
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/refusal_bodies_d278.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import { refusalBody, rowFailureSentence, UPSTREAM_MAX } from '../src/util/refusal.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
// @ts-ignore — a plain .mjs script, imported for its exported functions.
import { check, readRoutes, scan, LEDGER, HELPER_FLOOR } from '../../scripts/check-refusal-bodies.mjs';

function captureErrors<T>(fn: () => T): { out: T; logged: string[] } {
  const orig = console.error;
  const logged: string[] = [];
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try { return { out: fn(), logged }; } finally { console.error = orig; }
}

const STRIPE_JSON = 'stripe_error:402:{"error":{"code":"card_declined","message":"Your card was declined.","type":"card_error"}}';

// ---------------------------------------------------------------- the helper

test('member: our sentence, a code in error, no provider text anywhere in the body — and it was logged', () => {
  const { out, logged } = captureErrors(() => refusalBody({
    code: 'checkout_failed', message: 'Checkout could not be started.', raw: new Error(STRIPE_JSON),
  }));
  assert.equal(out.error, 'checkout_failed');
  assert.equal(out.message, 'Checkout could not be started.');
  assert.equal(out.detail, 'Checkout could not be started.');
  assert.equal(out.upstream, undefined);
  assert.doesNotMatch(JSON.stringify(out), /card_declined|stripe_error|declined/);
  assert.ok(logged.some((l) => l.includes('checkout_failed') && l.includes('card_declined')), 'the raw text was not logged beside the code');
  // The log call's first argument is a constant: the Semgrep rule this repo has fixed twenty-one times.
  assert.ok(logged.every((l) => l.startsWith('[refusal] ')));
});

test('owner and admin: the provider text travels clipped on upstream, never in message, detail or error', () => {
  const long = `${STRIPE_JSON} ${'x'.repeat(1000)}`;
  for (const audience of ['owner', 'admin'] as const) {
    const { out } = captureErrors(() => refusalBody({ code: 'sync_failed', message: 'The sync did not complete.', raw: long, audience }));
    assert.equal(typeof out.upstream, 'string', audience);
    assert.match(out.upstream as string, /card_declined/);
    assert.ok((out.upstream as string).length <= UPSTREAM_MAX + 1, `${audience}: upstream is not clipped`);
    for (const k of ['message', 'detail', 'error']) {
      assert.doesNotMatch(String(out[k]), /card_declined/, `${audience}: the raw text reached ${k}`);
    }
  }
});

test('extra keys cannot overwrite the sentence, the code or upstream', () => {
  const { out } = captureErrors(() => refusalBody({
    code: 'x', message: 'Ours.', raw: 'theirs', extra: { message: 'theirs', detail: 'theirs', error: 'theirs', upstream: 'theirs', slide: 3 },
  }));
  assert.deepEqual(out, { slide: 3, error: 'x', message: 'Ours.', detail: 'Ours.' });
});

test('an import row reads which kind of failure it was, never SQLite', () => {
  const { out } = captureErrors(() => rowFailureSentence(new Error('D1_ERROR: UNIQUE constraint failed: portfolio_companies.name: SQLITE_CONSTRAINT')));
  assert.match(out, /duplicates one that already exists/);
  assert.doesNotMatch(out, /D1_ERROR|SQLITE|portfolio_companies/);
});

// ---------------------------------------------------------------- mapError

const app = new Hono<any>();
app.get('/throw', (c) => {
  try { throw new Error(c.req.query('m') || ''); } catch (e) { return mapError(c, e); }
});
async function thrown(m: string) {
  const { out } = captureErrors(() => app.request(`/throw?m=${encodeURIComponent(m)}`));
  const res = await out;
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

test('mapError: a thrown UNIQUE failure is a 400 in our words, with no SQLite text', async () => {
  const r = await thrown('D1_ERROR: UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT');
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'already_exists');
  assert.match(String(r.body.detail), /already exists/);
  assert.doesNotMatch(JSON.stringify(r.body), /D1_ERROR|SQLITE|users\.email|constraint/);
  const fk = await thrown('FOREIGN KEY constraint failed');
  assert.equal(fk.status, 400);
  assert.equal(fk.body.error, 'related_record_missing');
});

test('mapError: any other D1 or SQLite failure is a logged 500, not a refusal', async () => {
  const r = await thrown('D1_ERROR: database is locked: SQLITE_BUSY');
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.body), /locked|SQLITE/);
});

test('mapError: a sentence a route wrote passes through unchanged', async () => {
  const r = await thrown('A support session needs a reason of at least ten characters.');
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { detail: 'A support session needs a reason of at least ten characters.' });
});

// ---------------------------------------------------------------- the guard

const RAW_BODY = "x.post('/a', async (c) => { try {} catch (e) { return c.json({ error: 'a_failed', detail: (e as Error).message }, 502); } });";
const HELPER_BODY = "x.post('/a', async (c) => { try {} catch (e) { return refuse(c, 502, { code: 'a_failed', message: 'A failed.', raw: e }); } });";

test('the guard fails a raw body and passes a helper body', () => {
  assert.equal(scan(new Map([['a.ts', RAW_BODY]]), []).violations.length, 1);
  for (const raw of ["detail: e?.message", "message: String(e)", "error: err.message", "detail: await r.text()"]) {
    assert.equal(scan(new Map([['a.ts', `return c.json({ ${raw} }, 500);`]]), []).violations.length, 1, raw);
  }
  assert.equal(scan(new Map([['a.ts', HELPER_BODY]]), []).violations.length, 0);
});

test('the guard refuses a stale ledger entry', () => {
  const r = check(new Map([['a.ts', HELPER_BODY]]), { floor: 1, ledger: [{ file: 'a.ts', contains: 'detail: e.message', reason: 'gone' }] });
  assert.equal(r.stale.length, 1);
  assert.ok(r.problems.some((p: string) => p.startsWith('stale ledger entry')));
});

test('the guard cannot pass on an empty tree: its floor fails it', () => {
  const r = check(new Map(), { ledger: [] });
  assert.equal(r.violations.length, 0);
  assert.ok(r.problems.some((p: string) => /floor/.test(p)), 'an empty tree passed');
});

test('the real routes pass, above the floor, with every ledger entry still live', () => {
  const r = check(readRoutes());
  assert.deepEqual(r.problems, []);
  assert.ok(r.helperCalls >= HELPER_FLOOR);
  assert.ok(LEDGER.every((l: { reason: string }) => l.reason.length > 10), 'a ledger entry has no reason');
});
