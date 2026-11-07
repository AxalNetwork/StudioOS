/**
 * #4707 — the HQ licence API's shared contracts hold on both sides.
 *
 * `services/licenceContracts.ts` is the Worker's authority; the routes build
 * their answers with `satisfies` against its types, so `npm run test:types`
 * catches a route that drifts. The SPA cannot be type-checked against it (its
 * `.js` is not checked), so `frontend/src/lib/licenceContracts.js` mirrors the
 * values and lists each answer's fields, and THIS test is what holds the two
 * together, and holds both to the migrations and to the routes' real answers.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_contracts_4707.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as worker from '../src/services/licenceContracts.ts';
// @ts-expect-error — plain JavaScript, loaded as it ships to the SPA.
import * as spa from '../../frontend/src/lib/licenceContracts.js';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
/** The quoted values of `CHECK (<col> IN (...))`, found by plain string search. */
const listIn = (sql: string, col: string) => {
  const marker = `CHECK (${col} IN (`;
  const at = sql.indexOf(marker);
  assert.ok(at >= 0, `no CHECK on ${col}`);
  const inner = sql.slice(at + marker.length, sql.indexOf(')', at + marker.length));
  return inner.split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
};

test('the SPA mirrors every value the Worker contract names', () => {
  for (const k of ['LICENCE_STATUSES', 'LICENCE_KINDS', 'SEAT_TYPES', 'EVENT_OUTCOMES', 'ACTOR_STATES'] as const) {
    assert.deepEqual([...spa[k]], [...worker[k]], k);
  }
  assert.equal(spa.EVENTS_PAGE_DEFAULT, worker.EVENTS_PAGE_DEFAULT);
  assert.equal(spa.EVENTS_PAGE_MAX, worker.EVENTS_PAGE_MAX);
});

test('statuses and kinds are the migrations\' own CHECK lists', () => {
  assert.deepEqual([...worker.LICENCE_STATUSES], listIn(read('cloudflare-worker/sql/migrations/187_territory_licences.sql'), 'status'));
  assert.deepEqual([...worker.LICENCE_KINDS], listIn(read('cloudflare-worker/sql/migrations/279_licence_kind.sql'), 'kind'));
});

test('the SPA draws every status, kind and seat the contract names', () => {
  const shared = read('frontend/src/pages/admin/licences/licenceShared.jsx');
  const tones = shared.slice(shared.indexOf('export const STATUS_TONE = {'), shared.indexOf('};', shared.indexOf('export const STATUS_TONE = {')));
  const toneKeys = [...tones.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
  for (const st of worker.LICENCE_STATUSES) assert.ok(toneKeys.includes(st), `no tone for ${st}`);
  const seats = shared.slice(shared.indexOf('export const SEAT_TYPES = ['), shared.indexOf('];', shared.indexOf('export const SEAT_TYPES = [')));
  assert.deepEqual([...seats.matchAll(/k: '(\w+)'/g)].map((m) => m[1]), [...worker.SEAT_TYPES]);
  const page = read('frontend/src/pages/admin/AdminLicences.jsx');
  const filters = page.slice(page.indexOf('const KIND_FILTERS = ['), page.indexOf('];', page.indexOf('const KIND_FILTERS = [')));
  assert.deepEqual([...filters.matchAll(/\['(\w+)',/g)].map((m) => m[1]), ['all', ...worker.LICENCE_KINDS]);
});

/** The keys of the object literal a route returns `satisfies T`. */
function answerKeys(file: string, type: string): string[] {
  const src = read(`cloudflare-worker/src/routes/${file}`);
  const at = src.indexOf(`} satisfies ${type})`);
  assert.ok(at > 0, `${file} no longer answers \`satisfies ${type}\``);
  const open = src.lastIndexOf('c.json({', at);
  const body = src.slice(open + 'c.json({'.length, at);
  return body.split(',').map((p) => p.trim()).filter(Boolean)
    .map((p) => (p.startsWith('...') ? p : p.split(':')[0].trim()));
}

test('the SPA\'s field lists are the routes\' real answers', () => {
  const F = spa.LICENCE_RESPONSE_FIELDS;
  assert.deepEqual(answerKeys('admin_licences_lifecycle.ts', 'LicenceTransitionResult'), [...F.transition]);
  assert.deepEqual(answerKeys('admin_licences_lifecycle.ts', 'LicenceSuspendResult'), [...F.suspend]);
  assert.deepEqual(answerKeys('admin_licences_lifecycle.ts', 'LicenceRenewResult'), [...F.renew]);
  assert.deepEqual(answerKeys('admin_licences_terms.ts', 'LicenceTerritoriesResult'), [...F.territories]);
  assert.deepEqual(answerKeys('admin_licences_terms.ts', 'LicenceSeatsResult'), [...F.seats]);
  // `...terms` spreads the terms object; its fields are LicenceTermsResult's, read off the type.
  assert.deepEqual(answerKeys('admin_licences_terms.ts', 'LicenceTermsResult'), ['ok', '...terms', 'pushed']);
  const contract = read('cloudflare-worker/src/services/licenceContracts.ts');
  const fieldsOf = (type: string) => {
    const at = contract.indexOf(`export type ${type} =`);
    const body = contract.slice(contract.indexOf('{', at), contract.indexOf('};', at));
    return [...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
  };
  assert.deepEqual(['ok', ...fieldsOf('LicenceTermsResult').filter((k) => k !== 'ok'), 'pushed'], [...F.terms]);
  assert.deepEqual(fieldsOf('LicenceEventItem'), [...F.event_item]);
  assert.deepEqual(fieldsOf('LicenceEventsPage'), [...F.events]);
  assert.deepEqual(answerKeys('admin_licences_history.ts', 'LicenceEventsPage'), [...F.events]);
});

test('an outcome the contract does not name reads as not recorded on the SPA', () => {
  assert.equal(spa.eventOutcomeOf('committed'), 'committed');
  assert.equal(spa.eventOutcomeOf('partial'), 'partial');
  assert.equal(spa.eventOutcomeOf('done'), null);
  assert.equal(spa.eventOutcomeOf(null), null);
});
