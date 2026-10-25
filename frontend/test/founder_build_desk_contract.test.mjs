import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fe = (path) => readFileSync(resolve(here, '..', path), 'utf8');

test('founder /execution redirects to the Build cycle, and the editor keeps its own address', () => {
  const app = fe('src/App.jsx');
  const route = app.match(/<Route path="\/execution"[\s\S]*?\/>/)?.[0] || '';

  // D422. `/execution` was a second address for A3 — a founder there got
  // FounderBuildDesk, the element `/build` mounts. It redirects to `/build`
  // with the query kept (`?new=1` and `?project_id=` survive), so A3 has one
  // address; the editor keeps `?mode=workspace`.
  assert.match(route, /effectiveRole === 'founder' && !founderExecutionEditor\s*\? <Navigate to=\{`\/build\$\{location\.search\}`\} replace \/>/,
    'founder /execution no longer lands on A3 at /build');
  assert.ok(!route.includes('<FounderBuildDesk />'), '/execution is a second address for A3 again');
  assert.match(app, /const founderExecutionEditor = effectiveRole === 'founder'\s*&& new URLSearchParams\(location\.search\)\.get\('mode'\) === 'workspace';/);
  // D661 (#1474): a founder's /build is the Build cycle overview now, and the
  // A3 desk is retired: its file is gone. The create-a-startup form it held
  // moved with it (`projects_partners_retired.test.mjs`).
  assert.match(app, /<Route path="\/build" element=\{founderBuildLanding\s*\? guard\(labRoles\(\[[^\]]*\]\), <CycleRoute cycle="build" \/>\)/);
  assert.ok(!existsSync(resolve(here, '..', 'src/pages/founder/FounderBuildDesk.jsx')), 'the retired A3 desk is back');

  // THE EDITOR LEFT THE DESK (D422): `/execution?mode=workspace` mounts
  // ExecutionPage at the route.
  const fullRoute = app.slice(app.indexOf('<Route path="/execution"'), app.indexOf('<Route path="/build/this-week"'));
  assert.match(fullRoute, /: founderWorkspace\('build', founderEditor\(<ExecutionPage \/>\)\)/,
    'the execution editor is no longer reachable at /execution?mode=workspace');
});
