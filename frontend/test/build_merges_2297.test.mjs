// #2297's five Build merges (#2335, #2336, #2339, #2340, #2343): each retired
// page's address forwards to the page that stays, query and hash kept, the
// survivor is routed, the address is in #2301's redirect inventory (for #2319),
// and no link in the SPA still targets the old address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { codeOnlyJsx } from './_codeOnly.mjs';

const root = process.cwd();
const APP = readFileSync(resolve(root, 'frontend/src/App.jsx'), 'utf8');

const MERGES = [
  ['/build/discovery', '/validate/customer-research', '/validate/:slug', 'DiscoveryPage'],
  ['/build/metrics', '/build/kpi', '/build/kpi', 'MetricsPage'],
  ['/build/financials', '/raise/capital/model', '/raise/capital/model', null],
  ['/build/captable', '/raise/capital/cap-table', '/raise/capital/cap-table', null],
  ['/grow/brand', '/build/brand', '/build/brand', 'founder/FounderGrowBrand'],
];

const routeLine = (path) => APP.split('\n').find((l) => l.includes(`<Route path="${path}" element=`)) || '';

test('each retired address forwards to its survivor, query and hash kept', () => {
  for (const [from, to, survivorRoute] of MERGES) {
    assert.equal(routeLine(from).trim(),
      `<Route path="${from}" element={<Navigate replace to={{ pathname: '${to}', search: location.search, hash: location.hash }} />} />`,
      `${from} no longer forwards to ${to} with its query and hash`);
    assert.match(routeLine(survivorRoute), /element=\{guard\(/, `${to}'s route is gone`);
  }
});

test('each retired address is in the redirect inventory, and its page file is gone', () => {
  const listed = new Set(REDIRECT_ROUTES.map((r) => r.path));
  for (const [from, , , page] of MERGES) {
    assert.ok(listed.has(from), `${from} left the redirect inventory`);
    if (page) assert.ok(!existsSync(resolve(root, `frontend/src/pages/${page}.jsx`)), `${page} is back`);
  }
});

test('no SPA source links a retired address', () => {
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|ts)$/.test(f)) files.push(p); } };
  walk(resolve(root, 'frontend/src'));
  for (const [from] of MERGES) {
    // A link is the address quoted as a whole value: '/x', "/x" or `/x, ending
    // at its close quote, a query (?) or a template interpolation ($). A shell
    // zone's `legacy:` names its old address for the router (shellConfig.js),
    // which is the forward itself, not a link, so it is left out.
    const linked = (src) => ["'", '"', '`'].some((q) => ["'", '"', '`', '?', '$'].some((end) => src.includes(q + from + end)));
    const hits = files.filter((p) => !p.endsWith('App.jsx') && linked(codeOnlyJsx(readFileSync(p, 'utf8')).split("legacy: '").map((part, i) => (i ? part.slice(part.indexOf("'") + 1) : part)).join('')));
    assert.deepEqual(hits.map((p) => p.slice(root.length + 1)), [], `still linked: ${from}`);
  }
});
