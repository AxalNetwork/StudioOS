/**
 * D704 (#1666) — the three retired Validate pages. This PR's part:
 *   test 1, `validateZoneTarget` returns decision 1's table exactly;
 *   test 4's empty-bucket case, `zoneForPath` answers null, not `undefined`.
 * PR 2 adds tests 2-8 when it mounts the redirects and removes the zones.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_pages_removed_d704.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { VALIDATE_ZONE_TARGETS, validateZoneTarget } from '../src/pages/cycles/validateRedirects.js';
import { zoneForPath, bucketsFor } from '../src/workspaces/shellConfig.js';

/** A target with its query as a set of `key=value` pairs, so order never matters. */
const asSet = (t) => (t == null ? t : {
  pathname: t.pathname,
  query: new Set([...new URLSearchParams(t.search.replace(/^\?/, ''))].map(([k, v]) => `${k}=${v}`)),
  hash: t.hash,
});
const lands = (zone, search, hash, pathname, query, frag = '') => {
  assert.deepEqual(asSet(validateZoneTarget(zone, search, hash)), { pathname, query: new Set(query), hash: frag },
    `${zone}${search}${hash}`);
};

test('D704 test 1: Interviews lands on Customer research, with the venture and the hash kept', () => {
  lands('interviews', '?project_id=3', '#top', '/validate/customer-research', ['project_id=3'], '#top');
  assert.deepEqual(validateZoneTarget('interviews', '?project_id=3', '#top'),
    { pathname: '/validate/customer-research', search: '?project_id=3', hash: '#top' });
  lands('interviews', '', '', '/validate/customer-research', []);
  assert.deepEqual(validateZoneTarget('interviews', '', ''), { pathname: '/validate/customer-research', search: '', hash: '' });
});

test('D704 test 1: ?new=record opens Record a session, with new dropped and the rest kept', () => {
  lands('interviews', '?new=record&project_id=3', '', '/validate/record', ['project_id=3']);
  lands('interviews', '?project_id=3&new=record', '#x', '/validate/record', ['project_id=3'], '#x');
});

test('D704 test 1: ?new=notes and ?new=upload become #1659\'s ?log= opener; any other new is dropped', () => {
  lands('interviews', '?new=notes', '', '/validate/customer-research', ['log=notes']);
  lands('interviews', '?new=upload&project_id=3', '', '/validate/customer-research', ['log=upload', 'project_id=3']);
  lands('interviews', '?new=zzz', '', '/validate/customer-research', []);
  lands('interviews', '?new=zzz&project_id=3', '#h', '/validate/customer-research', ['project_id=3'], '#h');
  lands('interviews', '?new=', '', '/validate/customer-research', []);
});

test('D704 test 1: Pain map and Hypotheses land on their modules, query and hash kept, and keep a new they do not read', () => {
  lands('pain-map', '?project=3', '#x', '/validate/problem-discovery', ['project=3'], '#x');
  lands('hypotheses', '?project=3', '#y', '/validate/experiments', ['project=3'], '#y');
  lands('pain-map', 'project_id=3', 'x', '/validate/problem-discovery', ['project_id=3'], '#x');
  // Only the Interviews page ever read `?new=`; the other two pass it on untouched.
  lands('hypotheses', '?new=record', '', '/validate/experiments', ['new=record']);
});

test('D704 test 1: exactly the three retired pages, and nothing else redirects', () => {
  assert.ok(Object.isFrozen(VALIDATE_ZONE_TARGETS));
  assert.deepEqual(Object.keys(VALIDATE_ZONE_TARGETS), ['interviews', 'pain-map', 'hypotheses']);
  for (const zone of ['verdict', 'customer-research', 'record', 'constructor', '', undefined]) {
    assert.equal(validateZoneTarget(zone, '?project_id=3', ''), null, String(zone));
  }
});

test('D704 test 4 (empty bucket): zoneForPath answers a bucket with no zones with null, not undefined', () => {
  const empty = { prefix: '/validate', zones: [] };
  assert.equal(zoneForPath(empty, '/validate'), null);
  assert.equal(zoneForPath(empty, '/validate/'), null);
  assert.equal(zoneForPath(empty, '/validate/interviews'), null, 'an unknown slug is null too');
  // A bucket with zones still answers its root with the first one.
  const validate = bucketsFor('founder').find((b) => b.prefix === '/validate');
  assert.ok(validate && validate.zones.length > 0, 'Validate keeps its zones until PR 2');
  assert.equal(zoneForPath(validate, '/validate'), validate.zones[0]);
});
