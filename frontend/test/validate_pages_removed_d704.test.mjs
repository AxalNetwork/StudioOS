/**
 * D704 (#1666) — the three retired Validate pages.
 *   test 1, `validateZoneTarget` returns decision 1's table exactly;
 *   test 2's MemoryRouter case, `ValidateZoneRedirect` lands on the module (PR 2a);
 *   test 3, `/validate` no longer branches (PR 2a);
 *   test 4's empty-bucket case, `zoneForPath` answers null, not `undefined`.
 * PR 2b and the closing PR add test 2's route case and tests 4-8 when they
 * mount the redirects and remove the zones.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_pages_removed_d704.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { ValidateZoneRedirect } from '../src/pages/cycles/ValidateZoneRedirect.jsx';
import { installDocument } from './_contracts_dom.mjs';
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

// ── PR 2a ─────────────────────────────────────────────────────────────────

/** Where `ValidateZoneRedirect` at `entry` lands, read from the router after it navigates. */
async function landing(zone, entry) {
  const restore = installDocument();
  const at = {};
  function Address() { const l = useLocation(); const type = useNavigationType(); Object.assign(at, { pathname: l.pathname, search: l.search, hash: l.hash, type }); return null; }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [entry] },
      React.createElement(Address),
      React.createElement(Routes, null, React.createElement(Route, { path: `/validate/${zone}`, element: React.createElement(ValidateZoneRedirect, { zone }) })))));
    return { ...at };
  } finally { await act(async () => root.unmount()); restore(); }
}

test('D704 test 2: ValidateZoneRedirect in a MemoryRouter lands on the module, the venture and the hash kept, replacing the old address', async () => {
  assert.deepEqual(await landing('pain-map', '/validate/pain-map?project_id=3#x'), { pathname: '/validate/problem-discovery', search: '?project_id=3', hash: '#x', type: 'REPLACE' });
  assert.deepEqual(await landing('hypotheses', '/validate/hypotheses?project_id=3'), { pathname: '/validate/experiments', search: '?project_id=3', hash: '', type: 'REPLACE' });
  assert.deepEqual(await landing('interviews', '/validate/interviews?project_id=3&new=record'), { pathname: '/validate/record', search: '?project_id=3', hash: '', type: 'REPLACE' });
  // App.jsx re-exports it beside HistoryRedirect; PR 2b and the closing PR mount it.
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.ok(app.includes("import { ValidateZoneRedirect } from './pages/cycles/ValidateZoneRedirect.jsx';"));
  assert.ok(app.includes('export { ValidateZoneRedirect };'));
  assert.ok(app.indexOf('export { ValidateZoneRedirect };') > app.indexOf('export function HistoryRedirect('), 'beside HistoryRedirect');
});

test('D704 test 3: /validate renders CycleRoute for every admitted role, with no ternary and no Navigate; founderValidateLanding is gone', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  const at = app.indexOf('<Route path="/validate" element=');
  assert.ok(at > 0);
  const line = app.slice(at, app.indexOf('\n', at));
  assert.equal(line, `<Route path="/validate" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" />)} />`);
  assert.doesNotMatch(app, /founderValidateLanding/);
  assert.doesNotMatch(app, /<Navigate to="\/validate\/interviews"/, 'no role is sent to the Interviews page from the root');
  assert.ok(existsSync('frontend/src/pages/cycles/ValidateZoneRedirect.jsx'));
});
