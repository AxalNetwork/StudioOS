/**
 * D5070 (#5070) — a failed Raise call is shown as an approved sentence, never as the raw error.
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_errors_5070.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { userFacingRaiseError, raiseValidationErrors, isSentence, RAISE_ERROR_COPY, raiseErrorKind } from '../src/lib/raiseErrors.js';

const err = (message, props = {}) => Object.assign(new Error(message), props);
const warn = console.warn; const quiet = (fn) => { console.warn = () => {}; try { return fn(); } finally { console.warn = warn; } };

test('a known code is its approved sentence, whatever text came with it', () => {
  for (const [code, kind] of [['changed_since_open', 'changed'], ['forbidden', 'forbidden'], ['not_found', 'not_found'], ['rate_limited', 'rate_limited'], ['pricing_unavailable', 'pricing_unavailable'], ['conflict', 'conflict'], ['invalid_input', 'invalid_input'], ['tier_required', 'plan_required']]) {
    const out = userFacingRaiseError(err('SQLITE_ERROR: no such column: secret_col', { status: 409, code }), { fallback: 'fb' });
    assert.equal(out, RAISE_ERROR_COPY[kind], code);
    assert.equal(raiseErrorKind({ code }), kind);
  }
});

test('internal text, thrown errors and server failures are never shown verbatim', () => {
  for (const e of [
    err('D1_ERROR: no such table: raise_prospects', { status: 500 }),
    err('Failed to fetch'),
    err('TypeError: Cannot read properties of undefined (reading \'id\')'),
    err('Unexpected token < in JSON at position 0', { status: 502 }),
    err('upstream provider said: key sk_live_123 rejected', { status: 500, code: 'provider_error' }),
    err('at handler (/src/routes/x.ts:12:5)', { status: 422, code: 'weird' }),
    err('SQLITE_CONSTRAINT: UNIQUE constraint failed: raise_prospects.email', { status: 400, code: 'dup' }),
  ]) {
    const out = quiet(() => userFacingRaiseError(e, { fallback: 'This did not save.' }));
    assert.ok(!out.includes(e.message), `${e.message} was shown`);
    assert.doesNotMatch(out, /sqlite|d1_|typeerror|sk_live|fetch|json|\.ts/i);
  }
  assert.equal(quiet(() => userFacingRaiseError(err('boom', { status: 500 }), { fallback: 'This did not save.' })), 'This did not save.');
  assert.equal(quiet(() => userFacingRaiseError(err('x'))), RAISE_ERROR_COPY.unavailable);
});

test('a Worker refusal with its own code keeps its sentence: 4xx, a code, a plain sentence', () => {
  const e = err('Use of Funds must total exactly 100%.', { status: 400, code: 'total_not_100' });
  assert.equal(userFacingRaiseError(e, { fallback: 'fb' }), 'Use of Funds must total exactly 100%.');
  // The same text with no code or a 5xx is not that contract.
  assert.equal(quiet(() => userFacingRaiseError(err('Use of Funds must total exactly 100%.', { status: 400 }))), RAISE_ERROR_COPY.invalid_input);
  assert.equal(quiet(() => userFacingRaiseError(err('Use of Funds must total exactly 100%.', { status: 500, code: 'total_not_100' }), { fallback: 'fb' })), 'fb');
});

test('a page can name its own sentence for a code, and status alone maps to the taxonomy', () => {
  assert.equal(userFacingRaiseError(err('x', { status: 400, code: 'invalid_plan' }), { sentences: { invalid_plan: 'Use of Funds must total exactly 100%.' } }), 'Use of Funds must total exactly 100%.');
  assert.equal(userFacingRaiseError(err('This project already has a cap table. Edit that one instead.', { status: 409, code: 'project_has_cap_table' })), 'This project already has a cap table. Edit that one instead.', 'a Worker code outside the taxonomy keeps its sentence');
  for (const [status, kind] of [[401, 'signed_out'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [429, 'rate_limited']]) {
    assert.equal(quiet(() => userFacingRaiseError(err('raw', { status }), { fallback: 'fb' })), RAISE_ERROR_COPY[kind], String(status));
  }
});

test('validation lists keep only sentences from a 400', () => {
  const e = err('x', { status: 400, data: { errors: ['At least one founder is required.', 'D1_ERROR: boom', 7] } });
  assert.deepEqual(raiseValidationErrors(e), ['At least one founder is required.']);
  assert.deepEqual(raiseValidationErrors(err('x', { status: 500, data: { errors: ['A sentence here.'] } })), []);
  assert.equal(isSentence('plain_code'), false);
});
