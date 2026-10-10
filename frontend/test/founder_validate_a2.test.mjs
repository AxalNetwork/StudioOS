import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const app = read('frontend/src/App.jsx');

test('founder active role owns the A2 Validate landing page', () => {
  // D422. `/build/discovery` was a second address for this desk: a founder
  // there got FounderValidatePage, the same element `/validate` mounts. It
  // redirects to `/validate` now, query and all, and the desk is `/validate`'s
  // alone. Every other licence keeps DiscoveryPage at the old path.
  const route = app.slice(app.indexOf('<Route path="/build/discovery"'), app.indexOf('/>)} />', app.indexOf('<Route path="/build/discovery"')) + 7);
  assert.match(route, /effectiveRole !== 'founder'\s*\? <DiscoveryPage \/>/, 'another licence lost DiscoveryPage');
  assert.match(route, /: <Navigate to=\{`\/validate\$\{location\.search\}`\} replace \/>/,
    'a founder on the bare path is not redirected to /validate with the query kept');
  assert.ok(!route.includes('<FounderValidatePage />'), '/build/discovery is a second address for the desk again');
  // D661 (#1474): a founder's /validate is the cycle overview now, drawn from
  // #1487's read, and the A2 desk is retired: its file is gone.
  assert.match(app, /<Route path="\/validate" element=\{founderValidateLanding\s*\? guard\([^)]*\), <CycleRoute cycle="validate" \/>\)/);
  assert.ok(!app.includes('<FounderValidatePage />'), 'the A2 desk is mounted again beside the cycle overview');
  assert.ok(!existsSync('frontend/src/pages/founder/FounderValidatePage.jsx'), 'the retired A2 desk is back');
});

test('the Discovery editor stays reachable for a founder at the route', () => {
  // THE EDITOR LEFT THE DESK (D422) and is mounted at the route: a founder's
  // `?mode=workspace` or Discovery `?tab=` still opens DiscoveryPage on its
  // interviews tab, in workspace mode — nothing a founder could reach is lost.
  assert.match(app, /founderDiscoveryEditor\s*\? founderWorkspace\('validate', <DiscoveryPage initialTab="interviews" workspaceMode \/>\)/,
    'the founder Discovery editor is no longer reachable');
  assert.match(app, /\['leads', 'interviews', 'insights'\]\.includes\(new URLSearchParams\(location\.search\)\.get\('tab'\)\)/,
    'a Discovery ?tab= deep link no longer opens the editor');
});


