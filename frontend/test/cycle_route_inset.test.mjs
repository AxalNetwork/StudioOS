/**
 * Every cycle path is full-bleed (`cyclePaths.js`, D694), so the cycle body's
 * own gutter is the only one: the canvas's 22/24/30px on a wide desktop, and
 * 14/22/18px below 1024px. Without it the header and cards touch the sidebar
 * and the rail. `cycle_spacing_d694.test.mjs` holds the rest (the narrow
 * column's 14/14/40px and the size container).
 *
 * Run with:
 *   node --test frontend/test/cycle_route_inset.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the cycle route body carries the canvas gutter, not WorkspaceShell\'s p-5', () => {
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  const body = /<div className="([^"]*)" data-testid="cycle-route-body">/.exec(route);
  assert.ok(body, 'the cycle route body is found');
  const classes = body[1].split(/\s+/);
  for (const c of ['px-[22px]', 'pt-[14px]', 'pb-[18px]', 'lg:px-6', 'lg:pt-[22px]', 'lg:pb-[30px]']) {
    assert.ok(classes.includes(c), `${c} in the cycle route body: ${body[1]}`);
  }
  assert.ok(!classes.includes('p-5'), 'the body has one gutter, not p-5 as well');
});
