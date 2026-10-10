/**
 * The cycle pages (/validate, /build, /raise, /grow) are full-bleed routes, so
 * their content carries its own inset, the same `p-5` WorkspaceShell gives
 * every other workspace page. Without it the header and cards touch the
 * sidebar and the rail.
 *
 * Run with:
 *   node --test frontend/test/cycle_route_inset.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the cycle route body is inset like every other workspace page', () => {
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  const shell = readFileSync('frontend/src/workspaces/WorkspaceShell.jsx', 'utf8');
  assert.match(shell, /<div className="p-5">/, 'WorkspaceShell\'s inset is the reference');
  const body = /<div className="([^"]*)" data-testid="cycle-route-body">/.exec(route);
  assert.ok(body, 'the cycle route body is found');
  assert.ok(body[1].split(/\s+/).includes('p-5'), `cycle route body classes: ${body[1]}`);
});
