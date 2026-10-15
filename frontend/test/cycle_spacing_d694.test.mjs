/** D694: cycle routes share one shell inset, with no hand-maintained slug list. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODULES } from '../src/pages/cycles/modules.js';
import { ACTION_PATHS, RECORD_ID, STATIC_CHILDREN, isCyclePath } from '../src/pages/cycles/cyclePaths.js';

const read = (path) => readFileSync(path, 'utf8');

test('cycle roots, every declared module, action, new page and record have the cycle gutter', () => {
  for (const cycle of Object.keys(MODULES)) {
    assert.equal(isCyclePath(`/${cycle}`), true);
    assert.equal(isCyclePath(`/${cycle}/${ACTION_PATHS[cycle]}`), true);
    for (const { slug } of MODULES[cycle]) {
      for (const suffix of ['', '/new', '/12', '/data_room']) {
        assert.equal(isCyclePath(`/${cycle}/${slug}${suffix}`), true, `${cycle}/${slug}${suffix}`);
      }
    }
  }
  assert.equal(isCyclePath('/validate/record/live'), true);
  assert.deepEqual(ACTION_PATHS, { validate: 'record', build: 'connect', raise: 'call', grow: 'update' });
  assert.deepEqual(STATIC_CHILDREN, ['/raise/cap-table/variants']);
  assert.equal(RECORD_ID.test('data_room'), true);
  const defs = read('frontend/src/pages/cycles/CycleRoute.jsx');
  for (const [cycle, action] of Object.entries(ACTION_PATHS)) {
    assert.match(defs, new RegExp(`${cycle}: \\{[\\s\\S]*?path: '${action}'`));
  }
});

test('legacy, static, unknown and malformed child routes keep their own shell', () => {
  for (const path of [
    '/raise/cap-table/variants', '/raise/cap-table/variants/a',
    '/validate/interviews', '/validate/interviews/5', '/validate/session/9', '/validate/inbox',
    '/raise/calls/abc', '/build/roadmap', '/raise/pitch', '/grow/focus', '/studio',
    '/validate/customer-research/Ab12', '/validate/customer-research/12/edit', '/validatex',
  ]) assert.equal(isCyclePath(path), false, path);
});

test('literal cycle routes mount a cycle page or a redirect', () => {
  const app = read('frontend/src/App.jsx');
  const routes = [...app.matchAll(/<Route path="([^":]+)" element=\{/g)];
  const exceptions = new Set(['/validate/record/live', '/raise/data-room']);
  for (const [index, route] of routes.entries()) {
    if (!isCyclePath(route[1]) || exceptions.has(route[1])) continue;
    const section = app.slice(route.index, routes[index + 1]?.index ?? app.length);
    assert.match(section, /<CycleRoute\b|<Navigate\b|<HistoryRedirect\b/, route[1]);
  }
});

test('App applies the predicate for every role without changing the pinned shell clauses', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /import \{ isCyclePath \} from '\.\/pages\/cycles\/cyclePaths';/);
  assert.match(app, /const fullBleedSurface = \(FULL_BLEED_BY_ROLE\[activeRole\] \|\| \[\]\)\.includes\(location\.pathname\)/);
  assert.match(app, /\|\| isCyclePath\(location\.pathname\);/);
  assert.match(app, /const flushSurface = fullBleedSurface;/);
  assert.match(read('frontend/src/pages/cycles/cyclePaths.js'), /^import \{ MODULES \} from '\.\/modules\.js';/);
});
