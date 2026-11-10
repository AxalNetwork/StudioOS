/**
 * #4579 (D4579) — Grow keeps its destination through sign-in and account setup, the sign-in page says where it leads
 * and what account it needs, a direct /login stays generic, and an account without the Founder licence is told why
 * Grow is closed to it instead of being sent home without a word. Rendered and executed where the property is
 * behaviour; read as source only where it IS the source (App.jsx's routes and gates).
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_signin_destination_4579.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

// A Map-backed localStorage, so the kept-destination helpers run as they do in a browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const {
  RETURN_AFTER_LOGIN_PREFIXES, loginRedirectFor, destinationArea, destinationNeedsSetup,
  keepThroughSetup, destinationAfterSetup, clearDestinationAfterSetup, signInContextFor,
} = await import('../src/lib/pendingNext.js');
const { default: GrowBoundary, GROW_BOUNDARY, GROW_BOUNDARY_ROLES } = await import('../src/pages/founder/GrowBoundary.jsx');

const app = codeOnly(readFileSync(path.resolve(import.meta.dirname, '../src/App.jsx'), 'utf8'));
const login = codeOnly(readFileSync(path.resolve(import.meta.dirname, '../src/pages/LoginPage.jsx'), 'utf8'));
const register = codeOnly(readFileSync(path.resolve(import.meta.dirname, '../src/pages/RegisterPage.jsx'), 'utf8'));
const render = (C, props = {}) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));

test('a signed-out visitor to Grow is sent to sign-in with Grow kept, and nothing unsafe is carried', () => {
  assert.ok(RETURN_AFTER_LOGIN_PREFIXES.includes('/grow'));
  assert.equal(loginRedirectFor({ pathname: '/grow', search: '' }), `/login?next=${encodeURIComponent('/grow')}`);
  assert.equal(loginRedirectFor({ pathname: '/grow/talent', search: '?tab=open', hash: '#roles' }), `/login?next=${encodeURIComponent('/grow/talent?tab=open#roles')}`);
  assert.equal(loginRedirectFor({ pathname: '/growth', search: '' }), '/login', 'a prefix is a path segment, not a string');
  assert.equal(loginRedirectFor({ pathname: '//evil.example/grow', search: '' }), '/login');
  assert.equal(loginRedirectFor({ pathname: '/studio', search: '' }), '/login', 'an area that does not keep its destination changed');
  // And /grow itself goes through the guard when signed out, so `next` is /grow rather than the page it forwards to.
  assert.match(app, /<Route path="\/grow" element=\{founderGrowLanding \|\| !user\s*\? guard\(\['admin', 'founder'\], <CycleRoute cycle="grow" \/>\)/);
});

test('the destination names its area, what it is and who it is for; anything else names nothing', () => {
  const grow = destinationArea('/grow');
  assert.equal(grow.name, 'Grow');
  assert.match(grow.what, /founder workspace/);
  assert.equal(grow.who, 'You need a founder account.');
  assert.equal(destinationArea('/grow/reporting').who, 'You need a founder, advisor or operating partner account.', 'the reporting desk an advisor can read was called founder-only');
  assert.equal(destinationArea('/grow/reporting/12/edit').who, 'You need a founder account.');
  assert.equal(destinationArea('/studio'), null);
  assert.equal(destinationArea('/growth'), null);
  assert.equal(destinationArea('https://evil.example/grow'), null);
  assert.equal(destinationArea('/\\evil.example/grow'), null);
  assert.equal(destinationArea(null), null);
});

test('the sign-in page says where it leads for Grow, keeps Grow on its sign-up link, and stays generic otherwise', () => {
  const grow = signInContextFor('/grow');
  assert.equal(grow.area.name, 'Grow');
  assert.equal(grow.registerHref, '/register?next=%2Fgrow');
  assert.equal(signInContextFor('/grow/talent?tab=open').registerHref, `/register?next=${encodeURIComponent('/grow/talent?tab=open')}`);
  assert.equal(signInContextFor(null), null, 'a direct visit was given a context');
  assert.equal(signInContextFor('/studio'), null);
  assert.equal(signInContextFor('//evil.example/grow'), null, 'an unsafe next named an area');
  // The page draws it: the heading, the line, and the sign-up link; the generic page when there is none.
  assert.match(login, /const \[context\] = useState\(signInContext\);/);
  assert.match(login, /\{context \? `Sign in to continue to \$\{context\.area\.name\}` : 'Sign in'\}/);
  assert.match(login, /\{context\.area\.what\} \{context\.area\.who\}/);
  assert.match(login, /applyHref=\{context\?\.registerHref \|\| '\/register'\}/);
  assert.match(login, /return signInContextFor\(safeNextPath\(\)\);/, 'the page reads next some other way than its validated one');
});

test('sign-up says it continues to Grow and keeps it on the sign-in link', () => {
  assert.match(register, /const destination = destinationArea\(nextPath\);/);
  assert.match(register, /Create an account to continue to \$\{destination\.name\}/);
  assert.match(register, /<Link to=\{nextPath \? `\/login\?next=\$\{encodeURIComponent\(nextPath\)\}` : '\/login'\}/);
});

test('a Grow destination is kept through setup: valid, safe, Grow only, 24 hours, once', () => {
  store.clear();
  assert.equal(destinationNeedsSetup('/grow/focus'), true);
  assert.equal(destinationNeedsSetup('/learning/courses/a'), false, 'an area that never needed setup was held back');
  keepThroughSetup('/grow/focus?tab=1');
  assert.equal(destinationAfterSetup(), '/grow/focus?tab=1');
  clearDestinationAfterSetup();
  assert.equal(destinationAfterSetup(), null);
  keepThroughSetup('/studio');
  keepThroughSetup('//evil.example/grow');
  assert.equal(store.has('gvpn:after-setup'), false, 'a destination outside Grow, or unsafe, was written');
  assert.equal(destinationAfterSetup(), null, 'a destination outside Grow, or unsafe, was kept');
  // A stored value is re-checked when read, and an old one is dropped.
  store.set('gvpn:after-setup', JSON.stringify({ path: '//evil.example/grow', ts: Date.now() }));
  assert.equal(destinationAfterSetup(), null);
  store.set('gvpn:after-setup', JSON.stringify({ path: '/grow', ts: Date.now() - 25 * 3600 * 1000 }));
  assert.equal(destinationAfterSetup(), null);
  assert.equal(store.has('gvpn:after-setup'), false, 'a stale destination was left behind');
});

test('RequireAuth sends a Grow visitor through setup first, keeps Grow, and returns there once setup is done', () => {
  // An invitation's pending target still skips the setup gates; a Grow target does not.
  assert.match(app, /const deferPendingToSetup = !!\(pendingNext && destinationNeedsSetup\(pendingNext\)\);/);
  assert.match(app, /const exemptFromSetup = atPendingNext && !deferPendingToSetup;/);
  assert.doesNotMatch(app, /!atPendingNext &&\s*chatGateRole/, 'a gate still exempts every pending target');
  // Every setup gate keeps the address it redirects from.
  for (const nav of ['<Navigate to="/onboarding/chat" replace />', '<Navigate to="/onboarding" replace />', '<Navigate to={myWizard} replace />']) {
    assert.ok(app.includes(`keepForAfterSetup();\n    return ${nav};`), `${nav} no longer keeps the destination`);
  }
  assert.match(app, /const keepForAfterSetup = \(\) => keepThroughSetup\(`\$\{location\.pathname\}\$\{location\.search\}\$\{location\.hash\}`\);/);
  // Setup done: back to Grow, once (cleared after commit).
  assert.match(app, /const afterSetup = user && onboardingLoaded && onboardingComplete \? destinationAfterSetup\(\) : null;/);
  assert.match(app, /if \(afterSetup\) clearDestinationAfterSetup\(\);/);
  assert.match(app, /if \(afterSetupDue\) \{\s*return <Navigate to=\{afterSetup\} replace \/>;/);
  const wizard = app.indexOf('return <Navigate to={myWizard} replace />;');
  assert.ok(app.indexOf('if (afterSetupDue)') > wizard, 'the return to Grow runs before setup is done');
});

test('an account without the Founder licence reads why Grow is closed, and how to open it', () => {
  const t = renderedText(render(GrowBoundary, { home: '/portfolio' }));
  assert.match(t, new RegExp(GROW_BOUNDARY.title));
  assert.ok(t.includes(GROW_BOUNDARY.line));
  const out = render(GrowBoundary, { home: '/portfolio' });
  assert.match(out, /href="\/account\/licences#add-licence"[^>]*>Add the Founder licence</);
  assert.match(out, /href="\/portfolio"[^>]*>Go to your home</);
  const support = render(GrowBoundary, { home: '/studio', impersonating: true });
  assert.doesNotMatch(support, /account\/licences/, 'a support session was offered a licence for someone else');
  assert.ok(renderedText(support).includes(GROW_BOUNDARY.support));
  // Drawn by RoleGuard where it would have redirected, for the same roles in both places.
  assert.match(app, /\{ under: \/\^\\\/grow\(\\\/\|\$\)\/, roles: GROW_BOUNDARY_ROLES, Panel: GrowBoundary \}/);
  const inApp = app.match(/const GROW_BOUNDARY_ROLES = new Set\(\[([^\]]*)\]\);/)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(new Set(inApp), GROW_BOUNDARY_ROLES);
  assert.ok(!GROW_BOUNDARY_ROLES.has('founder') && !GROW_BOUNDARY_ROLES.has('admin'));
});
