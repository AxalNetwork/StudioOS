/**
 * A recovery reload is bounded, or it is a reload loop.
 *
 * WHAT WENT WRONG. Safari showed "This webpage was reloaded because a problem
 * occurred" on /login and /register — its message for a tab that reloaded or
 * crashed repeatedly. `main.jsx` reloaded the page on a stale-chunk error and
 * bounded that with one sessionStorage flag, which a `load` handler then
 * CLEARED five seconds later so the next failure could recover too. Every lazy
 * route chunk fails later than five seconds after load, so each reload restored
 * the conditions for the next one: an unbounded loop, worst exactly when the
 * chunk was permanently gone, which is the stale-deploy case the code exists
 * for. A second path had the reload sitting after its own try/catch, so a
 * browser that refuses `sessionStorage.setItem` — Safari Private Browsing —
 * reloaded with no guard at all.
 *
 * These pin the shape rather than the wording: bounded attempts, no timer that
 * resets them, and no guard whose only enforcement is a write that can throw.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const main = codeOnly(read('frontend/src/main.jsx'));
const boundary = codeOnly(read('frontend/src/components/RouteErrorBoundary.jsx'));

test('nothing clears a reload guard on a timer', () => {
  // The removals were inside `setTimeout(..., 5000)` under a `load` listener.
  // Any timer that clears a guard re-opens the loop, whatever it is named.
  assert.doesNotMatch(main, /removeItem\(['"]axal:chunk-reload['"]\)/,
    'the chunk guard must not be cleared on a timer');
  assert.doesNotMatch(main, /removeItem\(['"]axal:boot-reboot['"]\)/,
    'clearing this while also stripping ?__reboot= leaves the boot watchdog unbounded');
  assert.doesNotMatch(main, /addEventListener\('load'[\s\S]{0,400}?removeItem/,
    'no load handler may clear a reload guard');
});

test('the reload budget is a count, and it survives blocked storage', () => {
  assert.match(main, /MAX_CHUNK_RELOADS = \d+/, 'attempts must be bounded by a number');
  assert.match(main, /if \(attempts >= MAX_CHUNK_RELOADS\) return;/,
    'the bound must be checked before reloading');
  // sessionStorage throws in Safari Private Browsing, so it cannot be the only
  // thing carrying the count.
  assert.match(main, /__chunk=/, 'the count needs a storage-free carrier in the URL');
  assert.match(main, /function reloadCarryingCount/,
    'the reload must propagate the attempt count');
});

test('a guard write that throws never falls through to a reload', () => {
  // The failing shape was:  try { ...setItem... } catch {}  then reload().
  // Every reload must be reachable only when the budget was actually read and
  // found to have room — never as the statement after a swallowed write.
  assert.doesNotMatch(main, /catch \{[^}]*\}\s*\n\s*window\.location\.reload\(\)/,
    'a reload must not sit directly after a swallowed storage failure');

  // RouteErrorBoundary already had this right and is the reference: its reload
  // is inside the try, so a blocked write falls through to the error card.
  assert.match(boundary, /sessionStorage\.setItem\(RELOAD_GUARD_KEY[\s\S]{0,200}?window\.location\.reload\(\)/,
    'the boundary must keep its reload inside the guarded block');
});

test('the boot watchdog keeps at least one loop guard', () => {
  // index.html bounds itself two ways: a ?__reboot= marker and sessionStorage.
  // main.jsx tidies the marker out of the URL after a successful boot, which is
  // only safe while the other guard works.
  const html = read('frontend/index.html');
  assert.match(html, /__reboot=/, 'the watchdog keeps its storage-free guard');
  assert.match(main, /_storageWorks/,
    'the URL marker may only be stripped when sessionStorage is proven to work');
  assert.match(main, /_storageWorks && _u\.searchParams\.has\('__reboot'\)/,
    'the strip must be gated on that probe');
});
