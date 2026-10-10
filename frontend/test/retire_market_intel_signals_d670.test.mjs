/**
 * D670 — /market-intel and /signals are retired, with the market-intel sector
 * digest email (the owner's call, #1533).
 *
 * A retirement a later change could quietly undo gets a test that it stays
 * retired, the way `research_market_funds_retired` and the founder desks' guard
 * do. This one holds the four parts of it:
 *
 *   1. both URLs redirect to /research (never a 404), and nothing links them;
 *   2. the pages, and the components only they drew, are gone;
 *   3. the sector digest is not sent, and its unsubscribe link only says so;
 *   4. the endpoints only those pages read are gone, front and back, while the
 *      reads Research still makes stay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = process.cwd();
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const app = codeOnly(read('frontend/src/App.jsx'));
const api = codeOnly(read('frontend/src/lib/api.js'));
const index = codeOnly(read('cloudflare-worker/src/index.ts'));
const mi = codeOnly(read('cloudflare-worker/src/routes/market_intel.ts'));
const signals = codeOnly(read('cloudflare-worker/src/routes/signals.ts'));
const publicMi = read('cloudflare-worker/src/routes/market_intel_public.ts');

function sourceFiles(dir) {
  return readdirSync(resolve(root, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(resolve(root, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(jsx?|tsx?)$/.test(name) ? [rel] : [];
  });
}

test('both URLs redirect to /research, and no page links them', () => {
  assert.match(app, /<Route path="\/market-intel" element=\{<Navigate to="\/research" replace \/>\} \/>/);
  assert.match(app, /<Route path="\/signals" element=\{<Navigate to=\{`\/research\$\{location\.search\}`\} replace \/>\} \/>/);
  const linked = sourceFiles('frontend/src').filter((rel) => {
    const code = codeOnly(read(rel));
    return /(?:to|href)=\{?["'`]\/(?:market-intel|signals)(?:[?"'`/#])/.test(code)
      || /to: ['"`]\/(?:market-intel|signals)(?:[?"'`/#])/.test(code);
  });
  assert.deepEqual(linked, [], 'these files link a retired page again');
  const assistant = codeOnly(read('cloudflare-worker/src/routes/assistant.ts'));
  assert.doesNotMatch(assistant, /url: '\/market-intel/, 'the assistant offers the retired page again');
});

test('the pages, and the components only they drew, are gone', () => {
  for (const p of [
    'frontend/src/pages/MarketIntelPage.jsx',
    'frontend/src/pages/SignalsPage.jsx',
    'frontend/src/components/signals',
    'frontend/src/lib/signalsMeta.js',
    'cloudflare-worker/src/services/market_intel/digest.ts',
  ]) assert.equal(existsSync(resolve(root, p)), false, `${p} is back`);
  assert.doesNotMatch(app, /MarketIntelPage|SignalsPage|set="research"/);
});

test('the sector digest is not sent, and its unsubscribe link only says so', () => {
  assert.doesNotMatch(index, /sendMarketIntelDigests|market_intel\/digest/, 'the digest cron is back');
  assert.match(publicMi, /marketIntelPublic\.get\('\/unsubscribe', \(c\) => c\.html\(DIGEST_STOPPED\)\);/);
  assert.match(publicMi, /marketIntelPublic\.post\('\/unsubscribe', \(c\) => c\.html\(DIGEST_STOPPED\)\);/);
  assert.match(publicMi, /Axal no longer sends sector digests/);
  // It changes nothing, so it writes nothing.
  assert.doesNotMatch(codeOnly(publicMi), /market_intel_watchlist|mi_digest_paused_until|verifyUnsubscribeToken/);
  // The publications the same router serves are untouched.
  assert.match(publicMi, /marketIntelPublic\.get\('\/publications\/:slug'/);
});

test('the endpoints only those pages read are gone, and Research keeps its reads', () => {
  const GONE = ['/macro', '/competitive-intelligence', '/export', '/investor-lens', '/geography',
    '/geography-lens', '/watchlist', '/sentiment', '/talc', '/demand-supply', '/sector-heat',
    '/sentiment-geo', '/capital-velocity', '/partner-pulse', '/fit/investor/me',
    '/platform-personas', '/investor-signals'];
  // Plain substring checks, no constructed RegExp: the path itself, quoted,
  // and any sub-path under it (`/watchlist/:id`, `/platform-personas/export`).
  const VERBS = ['get', 'post', 'delete', 'use', 'route'];
  for (const path of GONE) {
    const mounted = VERBS.some((verb) => mi.includes(`marketIntel.${verb}('${path}'`) || mi.includes(`marketIntel.${verb}('${path}/`));
    assert.ok(!mounted, `/api/market-intel${path} is back`);
    assert.ok(!api.includes(`'/market-intel${path}`) && !api.includes(`\`/market-intel${path}`),
      `api.js calls /market-intel${path} again`);
  }
  for (const path of ['/market-pulse', '/private-rounds', '/studio-benchmarks', '/sector-compass',
    '/founder-lens', '/citations', '/sources', '/fit/founder/:project_id', '/contribution-optout']) {
    assert.ok(mi.includes(`marketIntel.get('${path}'`), `/api/market-intel${path} is read by Research and must stay`);
  }
  assert.doesNotMatch(index, /\/api\/investor-signals|aggregateInvestorSignals|\/api\/market-intel\/export/);
  assert.match(index, /app\.route\('\/api\/investor-profile', investorProfile\);/);
  // /api/signals keeps the two reads Research makes and nothing else.
  assert.deepEqual([...signals.matchAll(/r\.(get|post)\('([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`),
    ['get /', 'get /sources']);
  assert.match(api, /signals: \{\s*list:[\s\S]*?sources: \(\) => request\('\/signals\/sources'\),\s*\}/);
  // The nightly signals refresh and the market-intel ingestion keep running.
  assert.match(index, /services\/signals\/engine/);
  assert.match(index, /runSourcesByCadence/);
});
