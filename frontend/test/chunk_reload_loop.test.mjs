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
 *
 * THE RULE WAS RIGHT AND THE REACH WAS WRONG, which is how it happened a third
 * time. This file read `main.jsx`, `RouteErrorBoundary.jsx` and `index.html`,
 * and asserted that none of them clears a reload guard. Meanwhile
 * `App.jsx`'s `clearSession()` called a bare `sessionStorage.clear()` — wiping
 * every guard at once — and `AuthScreen` runs `clearSession` on mount for
 * anyone arriving at `/login` still signed in. The exact defect `main.jsx`'s
 * own comment warns about was committed in a file this test never opened.
 *
 * So the sweep below reads ALL of `frontend/src`. A rule about "nothing may
 * clear a reload guard" that only looks at the file which last broke it is a
 * rule about that file, not about the guards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const main = codeOnly(read('frontend/src/main.jsx'));
const boundary = codeOnly(read('frontend/src/components/RouteErrorBoundary.jsx'));
const guard = codeOnly(read('frontend/src/lib/reloadGuard.js'));
const pwa = codeOnly(read('frontend/src/lib/pwa.js'));
const app = codeOnly(read('frontend/src/App.jsx'));

/** Every `.js`/`.jsx` under `frontend/src`, so the sweep cannot miss a file. */
function allSources(dir = resolve(process.cwd(), 'frontend/src'), out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) allSources(full, out);
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

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
  // MOVED WITH THE CODE. The count and the URL marker now live in
  // `lib/reloadGuard.js`, because `lib/pwa.js` needed them too and had instead
  // grown its own guard that did not work. Two implementations of "bounded
  // reload" is how one of them ends up missing a lesson the other paid for.
  assert.match(main, /MAX_CHUNK_RELOADS = \d+/, 'attempts must be bounded by a number');
  assert.match(main, /if \(attempts >= MAX_CHUNK_RELOADS\) return;/,
    'the bound must be checked before reloading');
  assert.match(main, /readAttempts\(CHUNK_KEY, CHUNK_PARAM\)/,
    'the chunk recovery must read its budget through the shared guard');
  // sessionStorage throws in Safari Private Browsing, so it cannot be the only
  // thing carrying the count.
  assert.match(guard, /export function readAttempts/,
    'the shared guard must expose the count reader');
  assert.match(guard, /export function reloadCarryingCount/,
    'the reload must propagate the attempt count');
  assert.match(guard, /new RegExp\(`\[\?&\]\$\{urlParam\}=/,
    'the count needs a storage-free carrier in the URL');
});

test('the service-worker reload is bounded by something that outlives a reload', () => {
  // THE ONE THAT HAD NO GUARD AT ALL. `pwa.js` reloads when a newly activated
  // worker takes control, and bounded that with `let _reloadingForUpdate` —
  // a closure variable that dies with the document, so every reload re-armed it
  // with a fresh `false`. Its comment claimed a "one-shot flag"; it bounded one
  // reload PER PAGE LOAD, which bounds no loop. `sw.js` calls `skipWaiting()`
  // on install and `clients.claim()` on activate, and `claim()` fires
  // `controllerchange` on an already-controlled page — so the cycle closed.
  assert.doesNotMatch(pwa, /let _reloadingForUpdate/,
    'a closure flag dies with the document and cannot bound a reload loop');
  assert.match(pwa, /MAX_SW_RELOADS = \d+/, 'the SW reload must be bounded by a number');
  assert.match(pwa, /reloadWithinBudget\(SW_RELOAD_KEY, SW_RELOAD_PARAM, MAX_SW_RELOADS\)/,
    'the SW reload must go through the shared budget');
  assert.doesNotMatch(pwa, /addEventListener\('controllerchange'[\s\S]{0,200}?window\.location\.reload\(\)/,
    'controllerchange must not reload directly, without reading a budget');
  // Unthrottled, this ran on every single tab switch and fed the cycle above.
  assert.match(pwa, /now - lastUpdate < UPDATE_THROTTLE_MS/,
    'the update check must be throttled, or returning to a tab drives the cycle');
});

test('no file in frontend/src clears a reload guard', () => {
  // THE ASSERTION THAT WOULD HAVE CAUGHT IT. `App.jsx`'s `clearSession()` swept
  // `sessionStorage` wholesale on sign-out, taking every loop bound with it —
  // and `/login` is where that bit, because `AuthScreen` runs `clearSession` on
  // mount for anyone arriving still signed in.
  //
  // Two shapes are banned: removing a named guard key, and a blanket
  // `sessionStorage.clear()` that is not wrapped in `preserveReloadGuards`.
  const KEYS = ['axal:boot-reboot', 'axal:chunk-reload-attempts',
    'axal:chunk-reload-boundary', 'axal:sw-reload-attempts'];
  for (const file of allSources()) {
    const src = codeOnly(readFileSync(file, 'utf8'));
    const rel = file.slice(file.indexOf('frontend/src'));
    for (const key of KEYS) {
      // `RouteErrorBoundary` clears its own guard from its Reload BUTTON, which
      // is a person deciding to try again rather than code deciding for them.
      if (rel.endsWith('RouteErrorBoundary.jsx')) continue;
      assert.ok(!src.includes(`removeItem('${key}')`) && !src.includes(`removeItem("${key}")`),
        `${rel} clears the reload guard ${key}`);
    }
    for (const m of src.matchAll(/sessionStorage\.clear\(\)/g)) {
      const before = src.slice(Math.max(0, m.index - 400), m.index);
      assert.match(before, /preserveReloadGuards\(/,
        `${rel} sweeps sessionStorage without preserving the reload guards`);
    }
  }
});

test('the guard-key list names every guard, so a sweep cannot drop one', () => {
  // The list is the coupling. A guard key that a caller invents and does not
  // add here is one a future `clearSession()` silently erases.
  for (const key of ['axal:boot-reboot', 'axal:chunk-reload-attempts',
    'axal:chunk-reload-boundary', 'axal:sw-reload-attempts']) {
    assert.ok(guard.includes(`'${key}'`), `RELOAD_GUARD_KEYS is missing ${key}`);
  }
  assert.match(app, /preserveReloadGuards\(\(\) => \{/,
    'clearSession must sweep inside the preserving wrapper');
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
