/**
 * D289 — the view-as bar stops claiming one branch on pages that do not
 * scope (task 340).
 *
 * THE GUARD: a page that does not read `useViewAsBranch` never renders under
 * H12's claim. The registry (`lib/viewAsScope.js`) is held equal, in both
 * directions, to the files that read the scope: every registered route's
 * page reads it, every page that reads it is registered, and a route that
 * says it NARROWS passes the branch into a read (or the overlay) rather than
 * merely noting it. The bar draws H12's sentence only where the registry
 * says `narrows`, the page's own refusal where it says `declines`, and the
 * out-of-scope sentence everywhere else. D153's decision — the scope
 * survives navigation — is pinned, not undone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VIEW_AS_SCOPE, NARROWS, DECLINES, UNSCOPED, viewAsScopeFor, viewAsSentence,
  NARROWED_CLAIM, declinesSentence, outOfScopeSentence,
} from '../src/lib/viewAsScope.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const APP_CODE = codeOnly(APP);
const BAR = read('frontend/src/components/HqViewingAsBar.jsx');
const BAR_CODE = codeOnly(BAR);
const CTX = read('frontend/src/contexts/ViewAsBranchContext.js');

/** component name → file, from App.jsx's lazy-import table (the reachability guard's shape). */
const FILE_OF = new Map();
for (const m of APP.matchAll(/const (\w+) = lazy\(\(\) => import\('\.\/([^']+)'\)\)/g)) {
  for (const ext of ['', '.jsx', '.js']) {
    const f = `frontend/src/${m[2]}${ext}`;
    if (existsSync(resolve(root, f))) { FILE_OF.set(m[1], f); break; }
  }
}
const routeLine = (path) => APP.split('\n').find((l) => l.includes(`path="${path}"`));
const componentOf = (path) => {
  const line = routeLine(path);
  const m = line && /hqOnly\(<(\w+)/.exec(line);
  return m ? m[1] : null;
};

/** The HQ pages that read the scope, found by scanning, not typed. */
const HQ_DIR = 'frontend/src/pages/hq';
const READERS = readdirSync(resolve(root, HQ_DIR))
  .filter((f) => f.endsWith('.jsx') && codeOnly(read(`${HQ_DIR}/${f}`)).includes('useViewAsBranch('))
  .map((f) => f.replace('.jsx', ''));
// A reader mounted by a routed page rather than routed itself.
const CHILD_READERS = { HqTeamTable: '/admin/accounts' };

/* ------------------------------------------------------------------ *
 * The registry and the files
 * ------------------------------------------------------------------ */

test('every registered route is an hqOnly route whose page reads the scope', () => {
  assert.deepEqual(Object.keys(VIEW_AS_SCOPE), ['/hq', '/admin/accounts', '/admin/analytics', '/admin/platform/topology']);
  for (const [path, entry] of Object.entries(VIEW_AS_SCOPE)) {
    assert.ok([NARROWS, DECLINES].includes(entry.scope), `${path} registers an unknown scope`);
    const comp = componentOf(path);
    assert.ok(comp, `${path} is not a registered hqOnly route`);
    const file = FILE_OF.get(comp);
    assert.ok(file, `${path}'s component ${comp} is not in the lazy-import table`);
    assert.ok(file.endsWith(`/${entry.page}.jsx`), `${path} names ${entry.page}; the route mounts ${file}`);
    assert.ok(codeOnly(read(file)).includes('useViewAsBranch('), `${path}'s page never reads the scope`);
  }
});

test('every page that reads the scope is registered — the converse, scanned rather than typed', () => {
  assert.ok(READERS.length >= 4, `expected the HQ readers, found ${READERS.join(', ')}`);
  const registered = new Set(Object.values(VIEW_AS_SCOPE).map((e) => e.page));
  const unregistered = READERS.filter((r) => !registered.has(r) && !CHILD_READERS[r]);
  assert.deepEqual(unregistered, [], 'these HQ pages read the view-as scope and are not in the registry');
  for (const [child, path] of Object.entries(CHILD_READERS)) {
    assert.ok(READERS.includes(child), `${child} no longer reads the scope — drop it from CHILD_READERS`);
    assert.equal(VIEW_AS_SCOPE[path]?.scope, NARROWS, `${child} is mounted by ${path}, which must narrow`);
    assert.ok(read(`${HQ_DIR}/${VIEW_AS_SCOPE[path].page}.jsx`).includes(`<${child}`), `${VIEW_AS_SCOPE[path].page} no longer mounts ${child}`);
  }
});

test('a route that says it narrows passes the branch into a read or the overlay; one that declines says so in its own words', () => {
  for (const [path, entry] of Object.entries(VIEW_AS_SCOPE)) {
    const code = codeOnly(read(`${HQ_DIR}/${entry.page}.jsx`));
    if (entry.scope === NARROWS) {
      const narrows = /<HqBranchOverlay branch=\{viewAs\}/.test(code)
        || /api\.\w+\([^)]*viewAs \|\| undefined/.test(code)
        || (entry.page === 'AccountsPage' && /<HqTeamTable\b/.test(code));
      assert.ok(narrows, `${path} is registered as narrowing, but ${entry.page} never hands the branch to a read`);
      assert.doesNotMatch(code, /does not narrow this page/, `${path} narrows and also says it does not`);
    } else {
      assert.match(code, /Viewing as \{viewAs\} does not narrow this page/, `${path} declines without saying so in its own words`);
      assert.doesNotMatch(code, /viewAs \|\| undefined|<HqBranchOverlay/, `${path} declines and also narrows`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * The bar
 * ------------------------------------------------------------------ */

test('the bar draws H12\'s claim only where the registry says narrows, and the out-of-scope sentence everywhere else', () => {
  assert.equal(viewAsScopeFor('/hq'), NARROWS);
  assert.equal(viewAsScopeFor('/admin/accounts'), NARROWS);
  assert.equal(viewAsScopeFor('/admin/analytics'), DECLINES);
  assert.equal(viewAsScopeFor('/admin/platform/topology'), DECLINES);
  for (const p of ['/admin/content', '/admin/funds', '/admin/contracts', '/admin/revenue', '/admin/platform', '/admin/platform/switches', '/admin/hq-support', '/admin/security', '/admin', '/admin/accounts/x', '', undefined]) {
    assert.equal(viewAsScopeFor(p), UNSCOPED, `${p} is treated as scoped`);
  }
  assert.equal(viewAsSentence('/hq', 'fr'), NARROWED_CLAIM);
  assert.equal(viewAsSentence('/admin/analytics', 'fr'), declinesSentence('fr'));
  assert.equal(viewAsSentence('/admin/content', 'fr'), outOfScopeSentence('fr'));
  assert.equal(NARROWED_CLAIM, 'Every figure below was read from this branch alone — none of it is a platform total.');
  assert.match(outOfScopeSentence('fr'), /does not read the view-as scope: everything below is HQ’s own, not fr’s/);
  assert.match(outOfScopeSentence('fr'), /kept until you return to HQ view/);
  assert.match(declinesSentence('fr'), /does not narrow to fr, and says so below/);
  // The bar reads the route and the registry; the claim is not a literal in it.
  assert.match(BAR_CODE, /const \{ pathname \} = useLocation\(\);/, 'the bar does not read the route');
  assert.match(BAR_CODE, /\{viewAsSentence\(pathname, branch\)\}/, 'the bar does not draw the route\'s sentence');
  assert.doesNotMatch(BAR_CODE, /Every figure below was read from this branch alone/, 'H12\'s claim is a literal in the bar again, drawn on every route');
  assert.match(BAR_CODE, /data-scope=\{scope\}/);
  assert.match(BAR_CODE, /Read-only/);
  assert.match(BAR_CODE, /Return to HQ view/);
});

test('the scope survives navigation (D153): nothing in the shell resets it on a route change', () => {
  assert.match(APP_CODE, /const \[viewAsBranch, setViewAsBranch\] = useState\(null\)/, 'the shell stopped holding the scope as plain React state');
  assert.doesNotMatch(APP_CODE, /setViewAsBranch\(null\)/, 'the shell clears the scope itself — on navigation, that drops it');
  const effects = [...APP_CODE.matchAll(/useEffect\(\(\) => \{[^}]*setViewAsBranch/g)];
  assert.deepEqual(effects.map((m) => m[0].slice(0, 60)), [], 'an effect in the shell writes the scope');
  assert.doesNotMatch(BAR_CODE, /useEffect/, 'the bar reacts to navigation with an effect');
  // The context's comment NAMES the stores to say it uses none; the code is scanned.
  for (const store of ['localStorage', 'sessionStorage']) {
    assert.ok(!codeOnly(CTX).includes(store) && !BAR_CODE.includes(store), `the scope is stored in ${store}`);
  }
});

test('the context file says what the shell does: no clearSession line, because unmounting the layout is the purge', () => {
  assert.doesNotMatch(CTX, /`clearSession` clears it for the same reason/, 'the context still claims clearSession clears the scope');
  assert.match(CTX, /No `clearSession` line is needed for it,\s*\* and none exists/, 'the context does not say why no clearSession line exists');
  assert.match(CTX, /signing out\s*\* unmounts the layout, which IS the purge/);
  // …and the shell agrees: clearSession has no line for it.
  const clear = APP_CODE.slice(APP_CODE.indexOf('const clearSession'), APP_CODE.indexOf('const clearSession') + 2000);
  assert.doesNotMatch(clear, /viewAsBranch|setViewAsBranch/, 'clearSession now touches the scope — update the context file');
});
