import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const app = read('frontend/src/App.jsx');

test('founder active role owns the A2 Validate landing page', () => {
  // D422. `/build/discovery` was a second address for this desk: a founder
  // there got FounderValidatePage, the same element `/validate` mounts. #2335
  // (the owner's "Remove", #2297) retired the page for every licence: the
  // address forwards to Validate · Customer research, query and hash kept.
  const route = app.slice(app.indexOf('<Route path="/build/discovery"'), app.indexOf('/>', app.indexOf('<Route path="/build/discovery"')) + 2);
  assert.match(route, /<Navigate replace to=\{\{ pathname: '\/validate\/customer-research', search: location\.search, hash: location\.hash \}\} \/>/,
    '/build/discovery no longer forwards to Customer research with its query');
  assert.ok(!/DiscoveryPage|guard\(/.test(route), '/build/discovery renders a page again');
  assert.ok(!route.includes('<FounderValidatePage />'), '/build/discovery is a second address for the desk again');
  // D661 (#1474): /validate is the cycle overview, drawn from #1487's read,
  // and the A2 desk is retired: its file is gone. D704 (#1666): the root no
  // longer branches on the role or `?mode=workspace`.
  assert.ok(app.includes(`<Route path="/validate" element={guard(labRoles(['admin', 'founder']), <CycleRoute cycle="validate" />)} />`));
  assert.ok(!app.includes('<FounderValidatePage />'), 'the A2 desk is mounted again beside the cycle overview');
  assert.ok(!existsSync('frontend/src/pages/founder/FounderValidatePage.jsx'), 'the retired A2 desk is back');
});

test('the Discovery editor is retired with its page (#2335)', () => {
  // The owner's call (#2335): the editor's interview and pain-group writes
  // went with `/build/discovery`, and so did the partner and investor view.
  assert.ok(!existsSync('frontend/src/pages/DiscoveryPage.jsx'), 'DiscoveryPage is back');
  assert.doesNotMatch(app, /(?<!SpinoutLab)DiscoveryPage\b/, 'App.jsx mounts DiscoveryPage again');
  assert.ok(!app.includes('founderDiscoveryEditor'), 'the founder Discovery editor switch is back');
  assert.match(app, /<Route path="\/customer-discovery" element=\{<Navigate to="\/validate\/customer-research" replace \/>\} \/>/,
    '/customer-discovery hops through the retired address');
});


