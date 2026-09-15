/**
 * The Raise zone's refusals are about the store, not about the page's own code.
 *
 * WHAT THIS FILE IS DEFENDING, and it is a different failure from the one
 * `profile_zone_actions.test.mjs` catches. That suite checks a refusal is
 * well-formed: it justifies itself, it names no path, the counts balance. It
 * cannot check whether the refusal is TRUE. Four of Raise's seven were not:
 *
 *   · `raise/status` → `Timeline` — "the assembled rows carry a state but no
 *     date". True of the row objects, false of the data: `raise_prospects` and
 *     `legal_documents` both carry `created_at` and `updated_at` and both routes
 *     `SELECT *`. The refusal described this page's own mapper.
 *   · `raise/pitch` → `Shares` — "share links are held by the deck builder and
 *     are not returned to this page". `GET /decks/:id/engagement` returns a
 *     `shares` array and this page was already reading it.
 *   · `raise/liquidity` → `Restrictions` and `History` — "no restriction, tender
 *     or liquidity-event ledger is connected". `routes/liquidity.ts` is mounted,
 *     `GET /liquidity/my-portfolio` is `requireAuth` only, and it returns
 *     `my_listings` and `exit_history`.
 *
 * Each was written from a belief about the source rather than from the source,
 * and each stayed wrong through every pass because nothing here could contradict
 * it. So these assertions tie the claim to the thing that makes it true or false.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_zone_contract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const FILTERS = raw('frontend/src/workspaces/founderZoneFilters.js');
const STATUS = read('frontend/src/pages/founder/FounderRaiseStatus.jsx');
const PITCH = read('frontend/src/pages/founder/FounderRaisePitch.jsx');
const LIQUIDITY = read('frontend/src/pages/founder/FounderRaiseLiquidity.jsx');
const API = raw('frontend/src/lib/api.js');
const LIQ_ROUTE = raw('cloudflare-worker/src/routes/liquidity.ts');
const DECKS_ROUTE = raw('cloudflare-worker/src/routes/decks.ts');

/** One zone's chips: `{ key }` for live, `{ canvas }` for refused. */
function chips(zone) {
  const at = FILTERS.indexOf(`'${zone}'`);
  assert.ok(at > 0, `${zone} left the filter table`);
  const block = FILTERS.slice(at, FILTERS.indexOf('\n  ],', at));
  const code = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  return {
    live: [...code.matchAll(/[{,]\s*key: '([a-z0-9]+)'/g)].map((m) => m[1]),
    refused: [...code.matchAll(/canvas: '([^']+)',\s*$|canvas: '([^']+)',[\s\S]{0,80}?unbuilt:/gm)]
      .map((m) => m[1] || m[2]).filter(Boolean),
    code,
  };
}

test('raise/status Timeline is live, and the row it sorts carries a date', () => {
  const { live } = chips('raise/status');
  assert.ok(live.includes('timeline'), 'the Timeline chip went back to being a refusal');
  // The one line the whole refusal turned on. Both sources, not one — a mapper
  // that dated only the documents would sort the prospects to the bottom forever.
  assert.match(STATUS, /at: document\.updated_at \|\| document\.created_at \|\| null/);
  assert.match(STATUS, /at: prospect\.updated_at \|\| prospect\.created_at \|\| null/);
  assert.ok(STATUS.includes("filter === 'timeline'"), 'nothing branches on the timeline view');
  // An unparseable stamp must sort LAST, not as epoch zero — which would put it
  // first under a heading that says most recent.
  assert.match(STATUS, /Number\.isFinite\(t\) \? t : -Infinity/);
});

test('raise/pitch Shares is live, and reads the array the engagement route returns', () => {
  const { live } = chips('raise/pitch');
  assert.ok(live.includes('shares'), 'the Shares chip went back to being a refusal');
  // The claim's other half: the route really does return them. Checked against
  // the route, so this fails if the field is ever dropped there.
  assert.match(DECKS_ROUTE, /shares: tokRows\.map\(/, 'the engagement route stopped returning shares');
  assert.ok(PITCH.includes("view === 'shares'"), 'nothing branches on the shares view');
  assert.match(PITCH, /const links = rawRows\.map\(/, 'the share links are no longer derived');
  assert.ok(PITCH.includes('api.deckEngagement('), 'the page stopped calling the endpoint that carries them');
});

test('raise/liquidity Restrictions and History are live, and the endpoint is founder-reachable', () => {
  const { live } = chips('raise/liquidity');
  for (const key of ['restrictions', 'history']) {
    assert.ok(live.includes(key), `the ${key} chip went back to being a refusal`);
    assert.ok(LIQUIDITY.includes(`view === '${key}'`), `nothing branches on the ${key} view`);
  }
  assert.ok(LIQUIDITY.includes('api.liquidityMyPortfolio('), 'the page stopped calling my-portfolio');
  assert.match(API, /liquidityMyPortfolio: \(\) => request\('\/liquidity\/my-portfolio'\)/);
  // WHY THIS IS THE LOAD-BEARING ASSERTION. `GET /liquidity/events` is gated to
  // admin/partner/investor, so a founder is refused there; `my-portfolio` is
  // `requireAuth` only. If somebody narrows it, these two chips go blank for every
  // founder and the page has no way to say why. The gate is the contract.
  const at = LIQ_ROUTE.indexOf("liquidity.get('/my-portfolio'");
  assert.ok(at > 0, 'the my-portfolio endpoint is gone');
  const body = LIQ_ROUTE.slice(at, LIQ_ROUTE.indexOf('\n});', at));
  assert.ok(!/includes\(user\.role\)/.test(body),
    'my-portfolio grew a role list — a founder can no longer read their own listings, '
    + 'and the Restrictions and History chips are live over nothing again');
  assert.match(body, /my_listings|exit_history/, 'my-portfolio stopped returning the two arrays');
});

test('the shared liquidity reason is gone, not reworded', () => {
  // The D88/D90 pattern: delete the CONSTANT, not just the entries that used it.
  // A shared reason that outlives its truth gets cited again by the next chip —
  // and this one was already covering three different absences, of which two were
  // false. The file's own note about `NO_SESSION_RECORD` had recorded that shape.
  const code = codeOnly(FILTERS);
  assert.ok(!/^const NO_LIQUIDITY_LEDGER/m.test(code), 'NO_LIQUIDITY_LEDGER is back');
  assert.ok(!/unbuilt: NO_LIQUIDITY_LEDGER/.test(code), 'a chip still cites NO_LIQUIDITY_LEDGER');
});

test('the three refusals that survived say something the code agrees with', () => {
  const code = codeOnly(FILTERS);
  // `Tender` — the one of the liquidity three that is real. Its reason must name
  // WHO is buying, because that is the whole distinction: `secondary_listings` is
  // a holder selling, a tender is the company buying back.
  const tender = code.slice(code.indexOf("canvas: 'Tender'"));
  const reason = tender.slice(0, tender.indexOf('},'));
  assert.match(reason, /company offering to buy shares back/);
  assert.doesNotMatch(reason, /no restriction, tender or liquidity-event ledger/,
    'Tender is back on the shared reason that was false for its two siblings');
  assert.doesNotMatch(reason, /ledger is connected/,
    'Tender claims no ledger is connected, which routes/liquidity.ts contradicts');

  // `Variants` — genuinely absent: `pitch_decks` has version, is_current and no
  // variant column anywhere.
  assert.match(code, /canvas: 'Variants',\s*\n?\s*unbuilt: 'a deck stores versions; no narrative variant is a separate record'/);
});

test('no Raise page reads a field its own source does not carry', () => {
  // The `/build/roadmap` failure, checked here before it happens: a page that
  // filters on a name nothing returns draws a control over nothing. These are the
  // three names that bug was made of; none of them is a column on any Raise
  // source, so none of them may be read off a row here.
  for (const [name, src] of [['status', STATUS], ['pitch', PITCH], ['liquidity', LIQUIDITY]]) {
    for (const dead of ['.dependency', '.dependencies', '.holds_up_date', '.restriction_count']) {
      assert.ok(!src.includes(dead), `the raise/${name} page reads ${dead}, which nothing returns`);
    }
  }
});
