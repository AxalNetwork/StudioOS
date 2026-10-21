/**
 * #2354 and #2355 — two pages the owner ticked under Remove on #2297 §13.
 *
 *   - `/legal-capital`, the Legal & Capital Engine, one of four legal surfaces
 *     (#2297 §3). Its address lands on Raise › Legal (`/raise/legal`).
 *   - `/cofounder`, the older co-founder browse page with mutual reveal and an
 *     automatic NDA. #2297 §3 named Co-founder Match
 *     (`/spinout-lab/cofounder-match`) the one matcher; the address lands there.
 *
 * This pins:
 *   - both pages are deleted and each old address is a plain redirect, counted
 *     with #2301's redirects so it retires with the rest (#2319);
 *   - nothing in the app opens either address: no sidebar match, palette page,
 *     persona extra, help surface, Eadwyn target or in-page link, and none of
 *     the links the Worker hands out;
 *   - the founder Team page no longer embeds the removed browse page;
 *   - the client keeps no method that only the removed pages called. The
 *     Worker's routes behind them stay (the PR names the ones left uncalled).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/legal_capital_cofounder_removed_2354_2355.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { PERSONAS } from '../src/lib/personas.js';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(jsx?|mjs|ts)$/.test(n) ? [p] : [];
  });
}
// Comment lines may record the removal; code may not name the address.
const codeOf = (f) => readFileSync(f, 'utf8').split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => l.replace(/\s\/\/\s.*$/, ''))
  .join('\n');

const REMOVED = {
  '/legal-capital': { page: 'LegalCapitalPage', to: '/raise/legal' },
  '/cofounder': { page: 'CofounderPage', to: '/spinout-lab/cofounder-match' },
};

test('both pages are gone, and each old address is a redirect counted with #2301', () => {
  const app = read('frontend/src/App.jsx');
  for (const [path, { page, to }] of Object.entries(REMOVED)) {
    assert.equal(existsSync(resolve(ROOT, `frontend/src/pages/${page}.jsx`)), false, `${page}.jsx is back`);
    // Plain substring checks: the addresses are literals, so no pattern is built from them.
    assert.ok(!app.includes(page), `App.jsx still names ${page}`);
    assert.ok(app.includes(`<Route path="${path}" element={<Navigate to="${to}" replace />} />`), path);
    assert.ok(app.includes(`<Route path="${to}" `), `${to} is not a route`);
    assert.equal(REDIRECT_ROUTES.filter((r) => r.path === path && !r.keep).length, 1, `${path} is not counted once with #2301`);
  }
  const doc = read('documentation/operations/REDIRECT_RETIREMENT.md').replace(/\s+/g, ' ');
  assert.match(doc, /`\/legal-capital` \(#2354\) lands on `\/raise\/legal`/);
  assert.match(doc, /`\/cofounder` \(#2355\) lands on `\/spinout-lab\/cofounder-match`/);
});

test('nothing in the app, or in a link the Worker hands out, opens either address', () => {
  const offenders = [];
  const roots = ['frontend/src', 'cloudflare-worker/src/services/advisor', 'cloudflare-worker/src/routes/assistant.ts',
    'cloudflare-worker/src/services/vectorize.ts', 'cloudflare-worker/src/personas.ts'];
  for (const r of roots) {
    const abs = resolve(ROOT, r);
    for (const f of statSync(abs).isDirectory() ? files(abs) : [abs]) {
      if (f.endsWith('App.jsx')) continue;
      // The API client's request paths are Worker routes (`/cofounder/me`), not app addresses.
      if (/frontend\/src\/lib\/api(\.js|\/)/.test(f)) continue;
      const code = codeOf(f);
      if (/['"`]\/legal-capital\b/.test(code) || /['"`]\/cofounder(?![-\w])/.test(code)) offenders.push(f.slice(ROOT.length + 1));
    }
  }
  assert.deepEqual(offenders, []);
  for (const p of PERSONAS) {
    for (const e of p.nav_extras || []) assert.ok(!(e.to in REMOVED), `${p.id} still links ${e.to}`);
  }
});

test('the founder Team page links to Co-founder Match instead of embedding the removed page', () => {
  const team = codeOf(resolve(ROOT, 'frontend/src/pages/founder/FounderTeamPage.jsx'));
  assert.doesNotMatch(team, /CofounderPage/);
  assert.doesNotMatch(team, /cofounder-embedded/);
  assert.match(team, /const COFOUNDER_MATCH = '\/spinout-lab\/cofounder-match';/);
  assert.match(team, /<Link to=\{COFOUNDER_MATCH\}[^>]*data-testid="open-cofounder-match"/);
});

test('the client keeps no method that only the removed pages called', () => {
  const api = read('frontend/src/lib/api.js');
  for (const m of ['legalGenerate', 'legalDocs', 'legalSign', 'createCapitalCall', 'capitalSend', 'respondCapitalCall',
    'lpPortal', 'diligenceReview', 'diligenceFor', 'subsidiaryFor', 'spinout',
    'cofounderVocab', 'cofounderGetMyNda', 'cofounderSignNda', 'cofounderCloseConnection']) {
    assert.doesNotMatch(api, new RegExp(`^\\s+${m}:`, 'm'), `api.${m} is back with no caller`);
  }
  // The matcher still browses, expresses interest and reads the caller's own
  // profile, and the Team page's panel still unlists and re-lists it.
  for (const m of ['cofounderMe', 'cofounderBrowse', 'cofounderExpressInterest', 'cofounderUpsertMe', 'cofounderUnlistMe']) {
    assert.match(api, new RegExp(`^\\s+${m}:`, 'm'), `api.${m} was removed with a caller left`);
  }
});
