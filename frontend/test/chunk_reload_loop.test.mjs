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
import { readAttempts, preserveReloadGuards, RELOAD_GUARD_KEYS } from '../src/lib/reloadGuard.js';

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
  // Read with a PARSER, not a pattern: Semgrep flags a regex built from an
  // interpolated value, and a query parameter is what URLSearchParams is for.
  assert.match(guard, /searchParams\.get\(urlParam\)/,
    'the count needs a storage-free carrier read out of the URL');
  assert.doesNotMatch(guard, /new RegExp\(/,
    'a regex assembled from a caller-supplied name is the finding this replaced');
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

/**
 * The two behaviours the source-reading tests above can only describe.
 *
 * `reloadGuard.js` is plain JavaScript with no module-scope side effects, so it
 * loads in Node and can be RUN rather than read — which matters most for the
 * storage-refused path, since that is the browser the bug was reported from and
 * the one no amount of grepping can exercise.
 */
function withBrowser({ search = '', storage }, fn) {
  const priorWindow = globalThis.window;
  const priorStorage = globalThis.sessionStorage;
  globalThis.window = { location: { href: `https://axal.vc/login/${search}`, search } };
  globalThis.sessionStorage = storage;
  try { return fn(); } finally {
    globalThis.window = priorWindow;
    globalThis.sessionStorage = priorStorage;
  }
}

/** A sessionStorage that refuses every operation, as Safari Private Browsing does. */
const REFUSING = {
  getItem() { throw new Error('storage blocked'); },
  setItem() { throw new Error('storage blocked'); },
};

function workingStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    clear: () => map.clear(),
    _map: map,
  };
}

test('the count is readable from the URL when storage refuses every write', () => {
  // THE SAFARI PRIVATE BROWSING PATH, run rather than described. With storage
  // throwing, the URL marker is the only thing standing between a failed
  // recovery and an unbounded loop.
  const n = withBrowser({ search: '?__swreload=1', storage: REFUSING },
    () => readAttempts('axal:sw-reload-attempts', '__swreload'));
  assert.equal(n, 1, 'a refused read must fall through to the URL marker');

  // And a budget of 1 is then spent, so the next controllerchange does nothing.
  assert.ok(n >= 1, 'the recovered count must actually bound the next attempt');
});

test('storage wins when it works, and a missing marker reads as no attempts', () => {
  assert.equal(
    withBrowser({ search: '?__swreload=1', storage: workingStorage({ 'axal:sw-reload-attempts': '2' }) },
      () => readAttempts('axal:sw-reload-attempts', '__swreload')),
    2, 'the stored count is authoritative when it is readable',
  );
  assert.equal(
    withBrowser({ search: '', storage: workingStorage() },
      () => readAttempts('axal:sw-reload-attempts', '__swreload')),
    0, 'a first attempt reads as zero, not as a spent budget',
  );
  // A junk marker must not read as a spent budget — that would silently disable
  // the recovery this whole mechanism exists to allow.
  assert.equal(
    withBrowser({ search: '?__swreload=notanumber', storage: REFUSING },
      () => readAttempts('axal:sw-reload-attempts', '__swreload')),
    0, 'an unparseable marker must not be treated as attempts already spent',
  );
});

test('preserveReloadGuards keeps the guards across a wholesale sweep', () => {
  // The behaviour `clearSession()` depends on, exercised end to end.
  const storage = workingStorage({
    'axal:boot-reboot': '1',
    'axal:chunk-reload-attempts': '2',
    'draft:pitch': 'sensitive in-flight state',
  });
  withBrowser({ storage }, () => {
    preserveReloadGuards(() => storage.clear());
  });
  assert.equal(storage.getItem('axal:boot-reboot'), '1', 'the boot watchdog guard must survive');
  assert.equal(storage.getItem('axal:chunk-reload-attempts'), '2', 'the chunk count must survive');
  assert.equal(storage.getItem('draft:pitch'), null,
    'the sweep must still remove the per-tab state it exists to remove');
});

test('a sweep that throws still leaves the guards restored', () => {
  // `sessionStorage.clear()` can throw, and a guard lost to a failed sweep is
  // the same unbounded reload as a guard lost to a successful one.
  //
  // THE SWEEP MUST CLEAR AND THEN THROW. A first version threw without clearing,
  // so "the guard survived" was indistinguishable from "nothing removed it" —
  // and the test duly passed against a `preserveReloadGuards` whose restore was
  // moved out of the `finally`. A test for a restore has to destroy the thing
  // first, or it is testing nothing.
  const storage = workingStorage({ 'axal:boot-reboot': '1' });
  withBrowser({ storage }, () => {
    assert.throws(() => preserveReloadGuards(() => {
      storage.clear();
      throw new Error('clear failed halfway');
    }));
  });
  assert.equal(storage.getItem('axal:boot-reboot'), '1',
    'the guards must be written back even when the sweep throws');
});

test('every guard key the module lists is one a caller actually uses', () => {
  // The list is only useful if it matches reality in both directions: the tests
  // above pin that nothing is missing; this pins that nothing is invented.
  const callers = [main, boundary, pwa, read('frontend/index.html')].join('\n');
  for (const key of RELOAD_GUARD_KEYS) {
    if (key === 'deck_registry_recover') continue; // PitchDeckPage, read separately below
    assert.ok(callers.includes(key), `RELOAD_GUARD_KEYS lists ${key}, which no caller sets`);
  }
  assert.match(codeOnly(read('frontend/src/pages/PitchDeckPage.jsx')), /deck_registry_recover/,
    'the deck recovery guard must still be the key the list names');
});

/**
 * The direction nothing checked: every automatic reload has a bound.
 *
 * The tests above go keys -> callers ("the list names nothing invented") and
 * pin the three reloads that were known when they were written. Neither
 * direction stops a NEW reload arriving with no bound at all — and one had.
 *
 * `frontend/index.html`'s dev service-worker killer reloaded whenever it found
 * a registration to unregister, guarded only by `window.__swKilled`: a property
 * on `window`, which dies with the document, so it bounded one reload per page
 * load. That is the same non-bound `reloadGuard.js`'s own docblock says `pwa.js`
 * shipped, one layer up in HTML the module system cannot reach — which is
 * exactly why the module could not stop it.
 *
 * The rule is scoped to `index.html` on purpose. `frontend/src` is full of
 * `onClick={() => window.location.reload()}` — a person pressing Reload is not
 * a loop and needs no budget. `index.html` has no UI, so every reload in it is
 * automatic, and automatic is what has to be bounded.
 */
/**
 * The inline script bodies of an HTML file, found WITHOUT a regex.
 *
 * CodeQL's "Bad HTML filtering regexp" query flagged three different versions of
 * a `/<script…<\/script>/` pattern on PR #484 — `<SCRIPT>` did not match, then
 * `</script >`, then `</script\t\n bar>`. Every report was correct: a reload
 * inside a block the splitter cannot see escapes the check in SILENCE, which is
 * exactly the failure this file exists to prevent. Patching the pattern a
 * fourth time would be waiting for the fifth report, and the query is right to
 * keep firing — a regex is the wrong tool for finding a tag.
 *
 * Index scanning has no such blind spots: `</script` followed by anything at
 * all up to the next `>` closes the block, whatever its case, whitespace or
 * stray attributes.
 */
function inlineScriptBodies(html) {
  const lower = html.toLowerCase();
  const bodies = [];
  let at = 0;
  for (;;) {
    const open = lower.indexOf('<script', at);
    if (open === -1) break;
    const openEnd = lower.indexOf('>', open);
    if (openEnd === -1) break;
    const close = lower.indexOf('</script', openEnd);
    if (close === -1) break;
    const closeEnd = lower.indexOf('>', close);
    bodies.push(html.slice(openEnd + 1, close));
    at = closeEnd === -1 ? close + '</script'.length : closeEnd + 1;
  }
  return bodies;
}

test('every automatic reload in index.html is bounded by a listed guard key', () => {
  const html = read('frontend/index.html');
  const blocks = inlineScriptBodies(html);
  assert.ok(blocks.length >= 3, `expected the inline boot scripts, saw ${blocks.length}`);

  const RELOAD = /\blocation\.(reload\(\)|replace\()/g;
  // HTML comments stripped as well as JS ones. `codeOnly` knows `//` and
  // `/* */`; `<!-- … -->` is neither, and a reload quoted inside one is prose,
  // not code. Failing the build on a comment is how a guard earns a reputation
  // for crying wolf and then gets deleted.
  const executable = (src) => codeOnly(src.replace(/<!--[\s\S]*?-->/g, ' '));
  const inFile = (executable(html).match(RELOAD) || []).length;
  const inBlocks = blocks.reduce((n, b) => n + (executable(b).match(RELOAD) || []).length, 0);
  // BELT AND BRACES, kept even though the scanner above has no blind spots: if a
  // reload is ever found in the file that no block accounts for, it is either
  // parsing that has failed or a reload that escaped into markup. Both must
  // fail rather than be skipped.
  assert.equal(inBlocks, inFile,
    `${inFile - inBlocks} reload call(s) in index.html sit outside every inline script `
    + 'block. Either the scan missed one — in which case the reload inside it is '
    + 'unchecked — or a reload escaped into markup. Both must fail.');

  const reloading = blocks
    .map((b) => codeOnly(b))
    .filter((b) => /\blocation\.(reload\(\)|replace\()/.test(b));
  // If this drops to zero the rule has stopped reading anything, which is the
  // silent way for it to pass forever.
  assert.ok(reloading.length >= 2,
    `expected the watchdog and the service-worker killer, saw ${reloading.length}`);

  for (const block of reloading) {
    const bounded = RELOAD_GUARD_KEYS.some((key) => block.includes(key));
    assert.ok(bounded,
      'an inline script block in index.html reloads without naming a key from RELOAD_GUARD_KEYS.\n'
      + 'Give it a sessionStorage bound AND a URL marker (storage throws in the\n'
      + 'browsers this bug is reported from), and add the key to the list so\n'
      + "clearSession's sweep cannot drop it. Block:\n" + block.slice(0, 400));

    // Both halves, or the bound is missing in exactly the browser that reports
    // this bug: `sessionStorage.setItem` THROWS in Safari Private Browsing and
    // wherever site data is blocked, and a swallowed write followed by a reload
    // is the original defect. The marker rides in the URL, which no storage
    // policy can refuse.
    assert.match(block, /searchParams\.set\(/,
      'a bounded reload must carry its count in the URL too — storage can throw');
    assert.match(block, /\[\?&\][_a-z]+=/,
      'and must read that marker back before reloading again');
  }
});

test('dev is detected once, and never from the host or the port', () => {
  const html = codeOnly(read('frontend/index.html'));

  // Two scripts branch on this in OPPOSITE directions — the killer runs when
  // dev, the watchdog returns when dev — so two copies that drift put both on
  // the wrong side at once.
  assert.equal((html.match(/window\.__axalIsDev\s*=/g) || []).length, 1,
    'there must be exactly one definition of __axalIsDev');

  // The clauses that armed a dev-only reload on a deployed build: `.replit`
  // maps localPort 5000 to externalPort 80 and run-deploy.sh serves the BUILT
  // SPA there, so a production bundle answered "yes, dev".
  assert.doesNotMatch(html, /replit\\?\.(dev|app)|repl\\?\.co/,
    'dev detection must not sniff the hostname — a hosted production build matches');
  assert.doesNotMatch(html, /location\.port\s*===/,
    'dev detection must not sniff the port — the built SPA is served on 5000');

  // What is left is the signal that actually means dev: Vite injects this tag
  // into the HTML it serves, and a built bundle never has it.
  assert.match(html, /querySelector\('script\[src="\/@vite\/client"\]'\)/,
    'dev detection must be the /@vite/client tag Vite injects');
});
