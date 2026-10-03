/**
 * D506 — HQ gets a door to the Spin-Out moderation console.
 *
 * D442 built `/admin/spinout-moderation` and linked it from the branch
 * Approvals board, and left the HQ door to this slot: lane 4 of Admin ·
 * Approvals on HQ-held accounts still said "No console". What fails quietly
 * here, and so what this file pins:
 *
 *   - A door that is not literal. `admin_route_reachability.test.mjs` walks
 *     `to="/…"` syntax; a mapped link is invisible to it and the console
 *     reads as unreachable again.
 *   - A door onto a route HQ cannot open. The console is `guard(['admin'])`
 *     with no `hqOnly`, so both HQ-held shells reach it; a wrapper added
 *     later would make this row a door onto a refusal.
 *   - The page still saying no console exists, in its rail or its header.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/held_approvals_moderation_door_d506.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const HELD_RAW = read('frontend/src/pages/admin/HeldApprovals.jsx');
const HELD = codeOnly(HELD_RAW);
const APP = codeOnly(read('frontend/src/App.jsx'));
const BOARD = codeOnly(read('frontend/src/pages/branch/BranchApprovals.jsx'));
const CONSOLE = '/admin/spinout-moderation';

const lane4 = () => {
  const m = HELD.match(/<tr data-lane="4">([\s\S]*?)<\/tr>/);
  assert.ok(m, 'lane 4 is drawn');
  return m[1];
};

test('lane 4 links the moderation console, literally, and says it does', () => {
  const row = lane4();
  assert.match(row, /Spinout moderation/);
  assert.match(row, new RegExp(`<Link to="${CONSOLE}" className=\\{CONSOLE\\}>${CONSOLE}</Link>`), 'the console cell is a literal Link, as the other lanes are');
  assert.match(row, /Links to its console/);
  assert.doesNotMatch(row, /No console/);
  assert.equal((HELD.match(new RegExp(`to="${CONSOLE}"`, 'g')) || []).length, 1, 'one door, not two');
});

test('the console the door opens is a registered admin route both HQ-held shells can open', () => {
  const line = APP.split('\n').find((l) => l.includes(`path="${CONSOLE}"`));
  assert.ok(line, `${CONSOLE} is not a registered route`);
  assert.match(line, /guard\(\['admin'\]/, 'the console admits any admin');
  assert.doesNotMatch(line, /hqOnly\(/, 'an hqOnly wrapper would make lane 4 a door onto a refusal for a plain admin');
  // The branch board's own door is unchanged — two doors, one console.
  assert.match(BOARD, new RegExp(`to="${CONSOLE}"`));
});

test('the page no longer says no console exists, in its rail or its header', () => {
  const unavailable = HELD.slice(HELD.indexOf('unavailable={['), HELD.indexOf(']}', HELD.indexOf('unavailable={[')));
  assert.doesNotMatch(unavailable, /Spinout moderation/, 'the rail still lists moderation as unavailable');
  assert.doesNotMatch(HELD_RAW, /No console exists anywhere yet/);
  assert.doesNotMatch(HELD_RAW, /SPINOUT MODERATION LINKS NOWHERE/);
  assert.match(HELD_RAW, /D442 built the console/, 'the header comment names where the console came from');
  assert.match(HELD_RAW, /FIFTEEN LITERAL ROWS/, 'the row count in the header comment is the drawn count');
});

test('Approvals draws fifteen literal doors, none under /branch/, and the two no-link lanes say why', () => {
  const doors = [...HELD.matchAll(/<Link to="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(doors.length, 15);
  assert.ok(doors.includes(CONSOLE));
  for (const d of doors) assert.ok(!d.startsWith('/branch'), `${d} is under /branch/`);
  const lane5 = HELD.match(/<tr data-lane="5">([\s\S]*?)<\/tr>/)[1];
  assert.match(lane5, /Not applicable to HQ-held accounts/);
  assert.doesNotMatch(HELD, /\.map\([^)]*<Link/, 'a mapped link is invisible to the reachability walk');
});
