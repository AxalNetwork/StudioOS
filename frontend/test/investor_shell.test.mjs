import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { routeBlock } from './_routes.mjs';
import { allZoneRoutes } from '../src/workspaces/shellConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const investor = src.slice(src.indexOf('\n  investor: ['), src.indexOf('\n  advisor: ['));
const rows = [...investor.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const targets = rows.map((r) => r.to);
const labels = rows.map((r) => r.label);

test('investor sidebar matches the canvas rows exactly', () => {
  // Two corrections to what this used to assert. The first row has been
  // labelled 'Studio' in the live config all along, not 'Home' — the test was
  // pinning a label that never shipped, and had been failing on it. The second
  // is that the canvas's Firm Settings row is deliberately NOT here:
  // /company-settings is the sidebar's pinned footer for every role, and a row
  // as well would render it twice — which is why the row was removed.
  //
  // Spin-Out Lab stays. The canvas drops it as a top-level row, but removing a
  // licence's door into the Lab is exactly the kind of change this migration
  // is not permitted to make, so it is kept and counted here deliberately.
  assert.deepEqual(labels, [
    'Studio',
    'Spin-Out Lab',
    'Deals',
    'Portfolio',
    'Axal VC Fund',
    'Fund',
    'Network',
    'Research',
    'Trust',
  ]);
  assert.equal(rows.length, 9);
  assert.doesNotMatch(investor, /label:\s*'Workspace'/);
  assert.ok(!labels.includes('Messages'));
});

test('investor rows use the approved destinations', () => {
  // EVERY WORKSPACE ROW POINTS AT ITS ROOT. Deals, Portfolio and Research used
  // to point at `/deals/pipeline`, `/portfolio/health` and `/research/ask` —
  // one level below their own overviews, which is exactly how the founder
  // overviews were lost before #388. `/portfolio` had no route at all, so the
  // row could not have pointed at it; `/research` was founder-gated and bounced
  // every other licence to `/research/ask`.
  assert.deepEqual(targets, [
    '/studio',
    '/spinout-lab',
    '/deals',
    '/portfolio',
    '/spinout-lab/investor-workspace',
    '/funds',
    '/network',
    '/research',
    '/trust',
  ]);

  const app = read('frontend/src/App.jsx');
  const registered = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
  for (const t of targets) {
    assert.ok(registered.has(t), `investor row points at ${t}, which has no route`);
  }

  // Spin-Out Lab and Axal VC Fund keep their own tree — this migration does
  // not rename, re-bucket or retarget either.
  assert.ok(targets.includes('/spinout-lab'), 'the Spin-Out Lab row was dropped');
  assert.ok(targets.includes('/spinout-lab/investor-workspace'),
    'the Axal VC Fund row was retargeted out of the Lab tree');
});

test('Fund remains discoverable but requires the Institutional investor tier', () => {
  assert.match(
    investor,
    /to: '\/funds'[^}]*label: 'Fund'[^}]*requiredInvestorTier: 'institutional'/,
  );
});

test('Axal VC Fund and Spin-Out Lab are separate destinations', () => {
  assert.equal(rows.find((r) => r.label === 'Spin-Out Lab')?.to, '/spinout-lab');
  assert.equal(rows.find((r) => r.label === 'Axal VC Fund')?.to, '/spinout-lab/investor-workspace');
});

test('legacy investor deep links still highlight their owning workspace', () => {
  // Order within a match array carries no meaning — SidebarNav tests
  // membership — so this asserts the paths are present rather than pinning
  // the sequence a formatting change would break.
  const dealsMatch = /label: 'Deals',\s*\n?\s*match: \[([^\]]*)\]/.exec(investor);
  assert.ok(dealsMatch, 'the Deals row has no match array');
  for (const p of ['/pipeline', '/deals', '/raise/data-room']) {
    assert.ok(dealsMatch[1].includes(`'${p}'`),
      `legacy path ${p} no longer highlights the Deals row`);
  }
  // Research absorbed /market-intel, which was its own row's target before.
  const researchMatch = /label: 'Research',\s*\n?\s*match: \[([^\]]*)\]/.exec(investor);
  assert.ok(researchMatch, 'the Research row has no match array');
  assert.ok(researchMatch[1].includes("'/market-intel'"),
    '/market-intel no longer highlights the Research row');
  assert.match(investor, /label: 'Portfolio', match: \['\/portfolio'\]/);
  assert.match(investor, /label: 'Fund', match: \['\/funds', '\/lp-reports'\]/);
  assert.match(investor, /label: 'Network', match: \['\/network', '\/relationships', '\/contacts'\]/);
});

test('investors keep the global Company Settings footer', () => {
  const nav = read('frontend/src/ui/SidebarNav.jsx');
  assert.match(nav, /<div className="flex-none border-t border-gray-200 dark:border-gray-700">[\s\S]*Company Settings/);
});
/* ────────────────────────────────────────────────────────────────────────────
 * The five defect classes the investor shell shipped, one check each.
 *
 * Every one of these is the investor half of a check `founder_shell.test.mjs`
 * already makes, and every one is here because the same defect was reported
 * twice — once per licence, in the same words. The founder suite could not see
 * the investor half: it walks `frontend/src/pages/founder` by name.
 * ──────────────────────────────────────────────────────────────────────────── */

// label → [root, the component the root must render for an investor]
const WORKSPACES = {
  Deals: ['/deals', 'InvestorDealsWorkspace'],
  Portfolio: ['/portfolio', 'InvestorPortfolioCanvas'],
  Fund: ['/funds', 'InvestorFundLanding'],
  Network: ['/network', 'InvestorNetworkWorkspace'],
  Research: ['/research', 'InvestorResearchWorkspace'],
};

// The five overview files, and the bucket prefix each one's zone row belongs to.
const OVERVIEWS = {
  InvestorDealsWorkspace: '/deals',
  InvestorPortfolioCanvas: '/portfolio',
  InvestorFundLanding: '/funds',
  InvestorNetworkWorkspace: '/network',
  InvestorResearchWorkspace: '/research',
};

const app = read('frontend/src/App.jsx');
const investorDir = 'frontend/src/pages/investor';

test('every investor row lands on its own workspace overview', () => {
  for (const [label, [root]] of Object.entries(WORKSPACES)) {
    const row = rows.find((r) => r.label === label);
    assert.ok(row, `the ${label} row is gone from the investor sidebar`);
    assert.equal(row.to, root,
      `the ${label} row points at ${row.to}, one level below its overview — `
      + 'that is exactly how the founder overviews were lost the first time');
    const block = routeBlock(app, root);
    assert.ok(block, `${root} has no route — /portfolio had none at all, so the row could not point at it`);
    // The route may still redirect OTHER licences to a zone — /research sends
    // advisors and operators to /research/ask, and must. What it may not do is
    // send an investor there, so the investor arm has to name the overview.
    const [, component] = WORKSPACES[label];
    assert.ok(block.includes(`<${component} `) || block.includes(`<${component}/>`)
      || block.includes(`investorWorkspace('${root.slice(1)}'`)
      || block.includes('<PortfolioWorkspace'),
      `${root} does not render ${component} for an investor — it redirects past its own overview`);
  }
  // Deals reaches its overview through InvestorWorkspacePage's short-circuit
  // rather than directly, so pin that link in the chain too.
  assert.match(read(`${investorDir}/InvestorWorkspacePage.jsx`), /pathname === '\/deals'/,
    'the /deals short-circuit that renders the overview is gone');
});

test('an investor pill navigates — it is not an anchor onto the page', () => {
  // The user's words, twice: "the buttons don't work and aren't attached to
  // LPs Calls Accounting Reporting". Four overviews shipped their zone row as
  // `href="#lps"`, `href="#deals-pipeline"`, `href="#relationship-book"` and
  // `href="#research-ask"` — anchors that scrolled the page while the routes
  // they named were reachable from no control in the product.
  //
  // ZoneNav is stronger than a `doesNotMatch(/href="#/)`: every target is
  // composed from shellConfig, so a label cannot drift from its route, and
  // `workspace_shell_routes.test.mjs` already asserts every zone route in that
  // config is registered in App.jsx. Both are checked.
  for (const [name, prefix] of Object.entries(OVERVIEWS)) {
    const page = codeOnly(read(`${investorDir}/${name}.jsx`));
    assert.match(page, /<ZoneNav /, `${name} must render the shared zone row`);
    assert.ok(page.includes(`bucketForPath('investor', '${prefix}')`),
      `${name} must take its zone row's targets from the shell config`);
    for (const nav of page.matchAll(/<nav[^>]*>[\s\S]*?<\/nav>/g)) {
      assert.doesNotMatch(nav[0], /href=\{?[`'"]#/,
        `${name} still has an in-page anchor row`);
    }
  }
});

test('an investor never gets two headings, two pill rows or two rails on one page', () => {
  // /deals/pipeline and /network/relationships wrap the WHOLE overview in a
  // WorkspaceShell that draws its own title, ZoneNav and rail — so the page
  // drew a second of each inside them. `embedded` is how a page says the shell
  // above it already owns the chrome.
  for (const name of ['InvestorDealsWorkspace', 'InvestorNetworkWorkspace']) {
    const page = codeOnly(read(`${investorDir}/${name}.jsx`));
    assert.match(page, /export default function \w+\(\{ embedded = false \}\)/,
      `${name} must accept an embedded flag`);
    assert.match(page, /\{!embedded && <header/, `${name} must not draw its header when embedded`);
    assert.match(page, /\{!embedded && \(\s*<WorkerRail/, `${name} must not draw a rail when embedded`);
  }
  assert.match(codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx')),
    /<InvestorDealsWorkspace embedded \/>/, 'the Deals shell must pass embedded');
  assert.match(codeOnly(read('frontend/src/workspaces/NetworkWorkspace.jsx')),
    /<InvestorNetworkWorkspace embedded \/>/, 'the Network shell must pass embedded');
  // And the fund zone pages own their own composition, so the generic investor
  // chrome must not be stacked on top of them either.
  assert.match(codeOnly(read(`${investorDir}/InvestorWorkspacePage.jsx`)),
    /key === 'fund' && fundUnlocked && children\) return children/,
    'the four Fund zone pages get the generic header stacked above their own');
});

test('the Worker AI rail is one component, and every investor workspace has it', () => {
  // Twelve bespoke rails lived under frontend/src/pages/investor, under four
  // different headings — one said "Deals AI", not "Worker AI" — and not one of
  // them imported useAiSpend, so none had a meter, a cap or a spend figure.
  // Four of them claimed "Mode and model are set on the workspace" while the
  // workspace set neither. That is "it does show anything, it looks blank".
  const own = [];
  for (const f of readdirSync(resolve(process.cwd(), investorDir))) {
    if (!f.endsWith('.jsx')) continue;
    if (/<aside[^>]*className="[^"]*rail/.test(codeOnly(read(`${investorDir}/${f}`)))) own.push(f);
  }
  assert.deepEqual(own, [], 'these pages hand-build a rail again instead of using the shared one');

  // Every surface the investor shell config declares a bucket for renders one.
  for (const [name] of Object.entries(OVERVIEWS)) {
    assert.match(codeOnly(read(`${investorDir}/${name}.jsx`)),
      /<WorkerRail[\s\S]*?role="investor"/, `${name} must mount the shared rail`);
  }
  for (const zonePage of [
    'InvestorPortfolioPositions', 'InvestorPortfolioUpdates', 'InvestorPortfolioValueAdd',
    'InvestorFundLPs', 'InvestorFundCalls', 'InvestorFundAccounting', 'InvestorFundReporting',
  ]) {
    assert.match(codeOnly(read(`${investorDir}/${zonePage}.jsx`)),
      /<WorkerRail[\s\S]*?role="investor"/, `${zonePage} has no Worker AI rail`);
  }
  assert.match(codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx')),
    /rail=\{\(\s*<WorkerRail/, 'the four /deals/* zone routes get no rail from their shell');

  // The accent is the LICENCE's. Canvas I1: "Indigo, not violet: side by side
  // with the founder product these read as two licenses." A rail that took the
  // founder violet onto an investor page would say the wrong thing quietly.
  const rail = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
  assert.match(rail, /ACCENT\[role\] \|\| ACCENT\.founder/,
    'the rail must take its accent from the shell config, not a fourth copy of the hexes');
  const shell = codeOnly(read('frontend/src/workspaces/shellConfig.js'));
  for (const key of ['deepDark', 'tintDark']) {
    assert.ok(new RegExp(`investor:[^}]*${key}:`).test(shell),
      `ACCENT.investor has no ${key}; the rail would show its light accent on a dark ground`);
  }
  // Still no model and no per-run price, for every licence. ASSIST_SURFACES
  // keys a surface to an aiRouter task class and decides the model from it; no
  // investor surface is registered, and the three investor canvases each name
  // a DIFFERENT model. Naming one here would put a model on a page that never
  // calls one.
  assert.doesNotMatch(rail, /ASSIST_SURFACES|priceForTask/,
    'no workspace surface runs an aiRouter task, so the rail must quote no model or price');
});

test('the investor full-bleed list covers every investor root and zone route', () => {
  // `fullWidthSurface` and `flushSurface` held the investor expression written
  // out TWICE, identically — a `/portfolio/` prefix plus eight literal paths —
  // so the four /funds/* zone pages were in neither, even though each of their
  // shells declares min-height:100vh. That is the /grow/focus omission, four
  // times over.
  const sidebar = codeOnly(read('frontend/src/sidebarConfig.js'));
  const listed = new Set(
    [...(/export const INVESTOR_FULL_BLEED = \[([\s\S]*?)\];/.exec(sidebar)?.[1] || '')
      .matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );
  assert.ok(listed.size >= 25, 'INVESTOR_FULL_BLEED could not be parsed');

  // Required = the five bucket roots + every zone route the shell config
  // advertises. Imported rather than parsed: two of the five buckets take their
  // zones from shared consts (NETWORK_ZONES, RESEARCH_ZONES.investor) declared
  // elsewhere in the file, so a text scan of the investor block finds eleven of
  // nineteen and silently passes on the rest.
  //
  // ONE CARVE-OUT, with its reason, rather than a silent gap. Full-bleed is a
  // statement about the BODY: does the page draw its own canvas edge to edge?
  // `/research/*` renders WorkspaceShell around a plain card — `NoStoreYet` on
  // four of the five zones, the signals feed on the fifth — so it wants the
  // shell's centred column, which is why `/research/*` is absent from
  // FOUNDER_FULL_BLEED too. `/network/*` is the opposite case and is in both:
  // its zone bodies ARE canvases.
  const CENTRED = new Set(allZoneRoutes('investor').filter((p) => p.startsWith('/research/')));
  assert.equal(CENTRED.size, 5, 'the Research bucket no longer declares five zones');
  const required = [...Object.values(OVERVIEWS), ...allZoneRoutes('investor')]
    .filter((p) => !CENTRED.has(p));
  assert.equal(required.length, 19, 'the investor shell no longer declares 5 roots and 19 zones');
  assert.deepEqual(required.filter((p) => !listed.has(p)), [],
    'these investor surfaces draw their own full-bleed canvas but sit in the shell’s centred column');

  // Both flags read the one list, and the hand-typed expression cannot return.
  assert.match(app, /activeRole === 'investor' && INVESTOR_FULL_BLEED\.includes\(location\.pathname\)/);
  assert.match(app, /const flushSurface = fullBleedSurface;/);
  assert.doesNotMatch(app, /activeRole === 'investor' && \(\s*\n?\s*location\.pathname\.startsWith/,
    'the hand-typed investor path expression is back');
});

test('a failed read is never rendered as an empty one', () => {
  // The screenshot showed "Loading propositions" and "Introduction propositions
  // are unavailable right now." at the same time, permanently: `null` meant
  // both "not fetched" and "fetch failed", and setIntroductions was called only
  // on a fulfilled result.
  const network = codeOnly(read(`${investorDir}/InvestorNetworkWorkspace.jsx`));
  assert.match(network, /const detailFor = \(error, value, describe\)/,
    'the three section headings must read the error before the null');
  for (const source of ['errors.relationships', 'errors.introductions', 'errors.organizations']) {
    assert.ok(network.includes(`detailFor(${source}`), `${source} is not consulted by its heading`);
  }
  assert.ok(!/'Loading propositions'|'Loading relationship records'|'Loading attributed context'/.test(network),
    'a heading still hard-codes a loading string a failed fetch can never leave');
  // And a fund with no LP count reads as absent, not as zero.
  const fund = codeOnly(read(`${investorDir}/InvestorFundLanding.jsx`));
  assert.ok(!fund.includes('{fund.lp_count || 0}'), 'an absent LP count renders as 0 again');
  assert.match(fund, /const UNAVAILABLE = Symbol\('unavailable'\)/,
    'the three detail sources must distinguish unreadable from empty');
  // EVERY SOURCE THAT CAN CARRY THE SENTINEL MUST READ IT. Storing it and not
  // reading it is worse than the bug it replaced: a Symbol is truthy and has
  // no `.length`, so `detail.lps || []` handed it straight to `.slice()` and a
  // failed LP read went from a misleading "no records exist" to a thrown
  // TypeError. CodeQL is what catches the general class — it reported `unread`
  // as written and never read — so these three pin the specific call sites.
  for (const source of ['detail.lps', 'detail.calls', 'detail.periods']) {
    assert.ok(fund.includes(`unread(${source})`),
      `${source} can be the unavailable sentinel and nothing checks for it`);
  }
  assert.match(fund, /const lpRows = Array\.isArray\(detail\.lps\)/,
    'lpRows must reject the sentinel by shape, not by truthiness');
});
