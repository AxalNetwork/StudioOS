/**
 * #2324 — `/network-effects` is removed (the owner's tick on #2297 §3: "its
 * parts belong to Network, Deals and the marketplace").
 *
 * This pins:
 *   - the page and the panel only it used are gone, and the old address is a
 *     redirect to `/network`, counted with #2301's redirects;
 *   - nothing in the app links to it: no sidebar match, palette page, "Also
 *     in", founder tool navigation, help surface or guide;
 *   - the client keeps only the syndicate calls a deal room still makes.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/network_effects_removed_2324.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(jsx?|mjs)$/.test(n) ? [p] : [];
  });
}

test('the page and its only panel are gone, and the old address lands on Network', () => {
  assert.equal(existsSync(resolve(ROOT, 'frontend/src/pages/NetworkEffectsPage.jsx')), false);
  assert.equal(existsSync(resolve(ROOT, 'frontend/src/components/CompanyProfilePanel.jsx')), false);
  const app = read('frontend/src/App.jsx');
  assert.doesNotMatch(app, /NetworkEffectsPage/);
  assert.match(app, /<Route path="\/network-effects" element=\{<Navigate to="\/network" replace \/>\} \/>/);
  assert.ok(REDIRECT_ROUTES.some((r) => r.path === '/network-effects' && !r.keep), 'counted with #2301 and retired with the rest');
});

test('nothing in the app opens /network-effects', () => {
  const offenders = [];
  for (const f of files(resolve(ROOT, 'frontend/src'))) {
    if (f.endsWith('App.jsx')) continue;
    // Comment lines may record the removal; code may not name the address.
    const code = readFileSync(f, 'utf8').split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .map((l) => l.replace(/\s\/\/\s.*$/, ''))
      .join('\n');
    if (/['"`]\/network-effects\b/.test(code) || /['"`]#?network\/effects['"`]/.test(code)) offenders.push(f.slice(ROOT.length + 1));
  }
  assert.deepEqual(offenders, []);
});

test('the client keeps only the syndicate calls a deal room makes', () => {
  const api = read('frontend/src/lib/api.js');
  const kept = [...api.matchAll(/^\s+(networkFx\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(kept, ['networkFxCloseSyndicate', 'networkFxProjectSyndicates', 'networkFxSyndicate']);
  const deals = read('frontend/src/components/deals/DealSyndicates.jsx');
  for (const m of kept) assert.match(deals, new RegExp(`api\\.${m}\\(`), `${m} has a caller`);
});
