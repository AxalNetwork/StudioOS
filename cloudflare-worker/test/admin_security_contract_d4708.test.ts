/**
 * D4708 (#4708) — the Security desk's shared contract (`frontend/src/lib/securityContract.js`) holds on both sides.
 *
 * `services/adminSecurity/contract.ts` makes the typecheck fail when a service's own union drifts from the
 * contract. This file pins what a typecheck cannot: that the JavaScript values are the words its `.d.ts`
 * declares, that the services' runtime lists are the contract's, that the Worker serves the contract's own
 * outcome list, and that the Security page's models spell no result or outcome the contract does not name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as contract from '../../frontend/src/lib/securityContract.js';
import { USER_SESSION_STATUSES, SUPPORT_SESSION_STATUSES } from '../src/services/sessionStatus.ts';
import { FEED_OUTCOMES as ROUTE_FEED_OUTCOMES } from '../src/routes/admin_security.ts';
import { OUTCOME_OPTIONS } from '../../frontend/src/pages/hq/security/eventsModel.js';
import { RESULTS, ROW_OUTCOMES } from '../../frontend/src/pages/hq/security/accessModel.js';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

test('the availability shape is one shape, and only a part that says so is unavailable', () => {
  assert.deepEqual(contract.absent('The store could not be read.'), { available: false, reason: 'The store could not be read.' });
  assert.equal(contract.isUnavailable({ available: false, reason: 'x' }), true);
  assert.equal(contract.isUnavailable({ available: true }), false);
  assert.equal(contract.isUnavailable(null), false, 'a part that is not there yet is not an unreadable one');
  assert.equal(contract.isUnavailable(undefined), false);
  assert.equal(contract.isUnavailable({}), false);
});

test('every list in the .js is the tuple its .d.ts declares', () => {
  const dts = read('frontend/src/lib/securityContract.d.ts');
  const lists = Object.entries(contract).filter(([, v]) => Array.isArray(v)) as Array<[string, readonly string[]]>;
  assert.ok(lists.length >= 8);
  for (const [name, values] of lists) {
    assert.ok(Object.isFrozen(values), `${name} can be changed at run time`);
    const m = new RegExp(`export const ${name}: readonly \\[([^\\]]*)\\]`).exec(dts);
    assert.ok(m, `${name} has no type in securityContract.d.ts`);
    assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean), [...values], name);
  }
});

test('the session services spell the contract\'s status words, in order', () => {
  assert.deepEqual([...USER_SESSION_STATUSES], [...contract.USER_SESSION_STATUSES]);
  assert.deepEqual([...SUPPORT_SESSION_STATUSES], [...contract.SUPPORT_SESSION_STATUSES]);
});

test('the ledger route serves the contract\'s outcome list itself, not a copy', () => {
  assert.equal(ROUTE_FEED_OUTCOMES, contract.FEED_OUTCOMES);
  assert.deepEqual([...contract.FEED_OUTCOMES], ['ok', 'refused', 'live', 'ended', 'not_closed'], 'the wire list changed');
});

test('the Security page filters on, and words, exactly the contract\'s values', () => {
  // The bar lists them in its own reading order; the set is the contract's.
  assert.deepEqual(OUTCOME_OPTIONS.map((o: { key: string }) => o.key).filter(Boolean).sort(), [...contract.FEED_OUTCOMES].sort());
  for (const k of Object.keys(RESULTS)) assert.ok(contract.MUTATION_RESULTS.includes(k), `accessModel result ${k} is not in the contract`);
  assert.deepEqual(Object.keys(ROW_OUTCOMES).filter((k) => k !== 'missing'), [...contract.SESSION_REVOKE_OUTCOMES]);
  // The other write models spell their results inline; every one they return is a contract word.
  for (const f of ['privacyModel.js', 'trustModel.js', 'accessModel.js', 'mfaPolicyModel.js']) {
    const src = read(`frontend/src/pages/hq/security/${f}`);
    for (const m of src.matchAll(/\bresult: '([a-z_]+)'/g)) {
      assert.ok(contract.MUTATION_RESULTS.includes(m[1]), `${f} returns result '${m[1]}', which the contract does not name`);
    }
  }
  assert.match(read('frontend/src/pages/hq/security/aiSafetyModel.js'), /from '\.\.\/\.\.\/\.\.\/lib\/securityContract\.js'/,
    'the AI Safety model no longer reads availability through the contract');
});
