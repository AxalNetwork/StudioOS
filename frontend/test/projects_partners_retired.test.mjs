/**
 * `/projects` and `/partners` are retired, and the capability moved first.
 *
 * Task #101 asked for both pages to be removed. `/partners` could just go —
 * browsing is `/directory`, and getting a partner in is `/admin/partners` or
 * `/partners/onboard`, both of which run the onboarding its four-field
 * `createPartner` skipped. `/projects` could not: it held the ONLY
 * `api.createProject` caller in the SPA, so deleting it would have deleted the
 * only way to create a startup.
 *
 * NOTHING IN CI WOULD HAVE SAID SO. `check-api-drift.mjs` reads api.js -> worker
 * and never the reverse, so an api.js method whose last caller disappears is
 * invisible to it. That is the hole this file covers: not "does the route
 * resolve", which a redirect always satisfies, but "can a startup still be
 * made". It is the same bar the `/office-hours` retirement set — move the
 * unique capability, then retire — and `network_consolidated.test.mjs` is the
 * precedent for pinning a retirement so the deleted page cannot quietly return.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = codeOnly(read('frontend/src/App.jsx'));

function allSources(dir = resolve(process.cwd(), 'frontend/src'), out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) allSources(full, out);
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('both pages are gone and cannot come back unnoticed', () => {
  assert.ok(!existsSync(resolve(process.cwd(), 'frontend/src/pages/ProjectsPage.jsx')),
    'ProjectsPage.jsx is retired — its create form lives in components/CreateStartupForm.jsx');
  assert.ok(!existsSync(resolve(process.cwd(), 'frontend/src/pages/PartnersPage.jsx')),
    'PartnersPage.jsx is retired — /directory and /admin/partners inherited it');
});

test('both routes redirect rather than 404, so every bookmark survives', () => {
  assert.match(app, /path="\/projects"\s+element=\{<Navigate to="\/build" replace \/>\}/);
  assert.match(app, /path="\/partners"\s+element=\{<Navigate to="\/directory" replace \/>\}/);
});

test('the routes that were NOT retired are still mounted', () => {
  // Deleting these would be the easy over-reach: `/partners/:slug` is a public
  // profile, and ProjectDetail is deep-linked from six surfaces.
  for (const path of ['/projects/:id', '/partners/:slug', '/partners/onboard', '/partners/portal']) {
    assert.ok(app.includes(`path="${path}"`), `${path} must survive the retirement`);
  }
});

test('the static /partners redirect still precedes /partners/:slug', () => {
  // React Router v6 ranks the static segment above the param either way, but
  // App.jsx carries a comment asserting this ordering, and a reader who moved
  // the redirect below the public profile would be trusting a stale note.
  assert.ok(app.indexOf('path="/partners"') < app.indexOf('path="/partners/:slug"'),
    'the retired static route must stay above the public profile route');
});

test('creating a startup is still possible — the point of the whole exercise', () => {
  const callers = allSources()
    .filter((f) => !/lib\/api\.js$/.test(f))
    .filter((f) => /\bapi\.createProject\s*\(/.test(codeOnly(readFileSync(f, 'utf8'))));
  assert.ok(callers.length > 0,
    'api.createProject has no caller: the only way to create a startup is gone.\n'
    + 'check-api-drift cannot see this — it reads api.js -> worker, never back.');
  assert.ok(callers.some((f) => f.endsWith('CreateStartupForm.jsx')),
    'the create form is components/CreateStartupForm.jsx');
});

test('the moved form keeps the three behaviours that were learned from bugs', () => {
  const form = codeOnly(read('frontend/src/components/CreateStartupForm.jsx'));
  // Without the forced refresh the founder cannot see edit/delete on the
  // startup they just made, for up to the 5-minute /auth/me throttle.
  assert.match(form, /refresh\(\{\s*force:\s*true\s*\}\)/,
    'the post-create auth refresh must survive the move');
  assert.match(form, /markMilestone\([^)]*'project_created'\)/,
    "the Spin-out Lab milestone must survive the move");
  assert.match(form, /role === 'admin' \|\| .*role === 'partner'/,
    'the founder name/email inputs stay admin/partner-only — the worker forces '
    + 'founder_id from the JWT for anyone else');
});

test('the desk that inherited the form honours ?new=1', () => {
  // A <Navigate> redirect cannot carry a query string, so the Command Palette's
  // "Create startup" entry had to be repointed AND the destination had to learn
  // to read the flag. Either half alone is a button that does nothing.
  const desk = codeOnly(read('frontend/src/pages/founder/FounderBuildDesk.jsx'));
  assert.match(desk, /searchParams\.get\('new'\) === '1'/,
    'FounderBuildDesk must open the form from ?new=1');
  assert.match(desk, /<CreateStartupForm/, 'and must actually mount it');
  assert.match(codeOnly(read('frontend/src/components/CommandPalette.jsx')), /nav\('\/build\?new=1'\)/,
    'the Command Palette entry must address the new home');
});

test('the lab-state prefixes still cover both the survivor and the new home', () => {
  const hook = codeOnly(read('frontend/src/hooks/useSpinoutLabState.js'));
  // `/projects` stays for `/projects/:id`; `/build` had to be ADDED, because
  // the five `/build/*` entries did not include the bucket root where the form
  // now lives — so `project_created` would have been marked and the week never
  // refreshed.
  assert.match(hook, /^\s*'\/projects',$/m, '/projects/:id still needs its prefix');
  assert.match(hook, /^\s*'\/build',$/m, 'the Build desk needs one too');
});

test('no live link still points at a retired route', () => {
  const offenders = [];
  for (const file of allSources()) {
    const src = codeOnly(readFileSync(file, 'utf8'));
    // `to="/projects/…"` and the api.js request path are not links to the
    // retired page; the redirect declaration in App.jsx is the retirement.
    if (/\bto="\/projects"|\bto="\/partners"/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    'these still link to a retired route — repoint them at /build (or /build?new=1 '
    + 'where the label promises creation) and /directory');
});
