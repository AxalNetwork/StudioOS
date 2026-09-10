/**
 * Deals · Closing — canvas **ID4**, `/deals/closing`. The last of the four.
 *
 * WHAT THIS FILE GUARDS. The zone shipped as three hard-coded rows — a tick and
 * two circles reading "Deal reached closing · Recorded", "Signatures and
 * documents · Check deal room", "Wire confirmation · Not recorded here" — which
 * said the same thing on every deal because nothing was read to produce them.
 *
 * THE INSTRUMENT IS DELIBERATELY NOT THE ARTBOARD'S, and that is the one thing
 * here most likely to be "fixed" by someone who has not checked. ID4 draws a
 * Closing checklist (Item / State / Owner / Note) and NO STORE HOLDS ONE. The
 * two tables that look like candidates — `dd_checklist_items` and
 * `diligence_checklists` — belong to DILIGENCE, and joining them here would
 * relabel diligence work as closing work on a document a fund hands to counsel.
 * So the assertions below pin the absence in both directions: the page must not
 * read either table, and it must say why in its limits block.
 *
 * THE OPS ROW IS TESTED AS A CLAIM. `Apply template` said "no closing templates
 * are stored" and `legal_templates` seeds the SAFE, stock-purchase and
 * subscription agreements. The test reads the seed migration rather than
 * matching the corrected sentence, because a sentence can be rewritten without
 * the fact changing — which is the failure this whole series is about.
 *
 * NO NEW ENDPOINT IS ALSO AN ASSERTION. Everything this zone needs was already
 * served and already scoped, so a new route or a second scoped query would be a
 * regression against ID3's finding rather than a feature.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

import { dealStage } from '../src/lib/dealFlow.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = read('frontend/src/pages/investor/deals/ClosingZone.jsx');
const Z = codeOnly(ZONE);
const RESEARCH = read('cloudflare-worker/src/routes/research.ts');
const ESIGN = read('cloudflare-worker/src/routes/esign.ts');
const SEED = read('cloudflare-worker/sql/migrations/085_seed_legal_templates.sql');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const ROUTES = codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx'));
const WORKSPACE = codeOnly(read('frontend/src/pages/investor/InvestorDealsWorkspace.jsx'));
const ACTIONS = read('frontend/src/workspaces/investorZoneActions.js');
const FILTERS = read('frontend/src/workspaces/investorZoneFilters.js');
const CANVAS = read('design/canvases/integrated/Pages · Investor Deals.dc.html');

/**
 * The zone with its `<StatedLimit>` block removed.
 *
 * A store name is allowed — required, even — inside that block: it is the page
 * telling the reader which table it is NOT showing and why. What must never
 * happen is the same name appearing in the code that fetches. Asserting the
 * absence of the WORD failed on the page's own explanation, which is the same
 * trap ID1 hit with a fixture figure in a docblock and ID3 hit twice.
 */
function fetching() {
  const a = Z.indexOf('<StatedLimit');
  assert.ok(a > 0, 'the limits block is gone');
  const b = Z.indexOf('</StatedLimit>', a);
  assert.ok(b > a, 'the limits block does not close');
  return Z.slice(0, a) + Z.slice(b);
}

/** The rendered `<StatedLimit>` block alone — what a reader actually sees. */
function limits() {
  const a = Z.indexOf('<StatedLimit');
  const b = Z.indexOf('</StatedLimit>', a);
  assert.ok(a > 0 && b > a, 'the limits block is gone or does not close');
  return Z.slice(a, b);
}

/** The ID4 fixture object alone. It is last, so the bound is the array's end. */
function id4() {
  const a = CANVAS.indexOf("id:'id4'");
  assert.ok(a >= 0, 'the ID4 artboard is gone from the canvas');
  const b = CANVAS.indexOf('\n    ];', a);
  assert.ok(b > a, 'the artboard array no longer closes after ID4');
  return CANVAS.slice(a, b);
}

test('the closing checklist is NOT drawn, and the diligence tables are not borrowed', () => {
  // The artboard asks for it; nothing stores it.
  assert.match(id4(), /instTitle:'Closing checklist'/, 'the artboard changed its instrument');
  assert.ok(!/title="Closing checklist"/.test(Z), 'the zone draws a checklist it has no store for');

  // The two tables that exist are diligence, and neither may be read here.
  assert.match(BASELINE, /CREATE TABLE dd_checklist_items/, 'the diligence store is gone — re-check this guard');
  assert.match(BASELINE, /CREATE TABLE diligence_checklists/);
  const body = fetching();
  for (const table of ['dd_checklist_items', 'diligence_checklists']) {
    assert.ok(!body.includes(table), `the zone reads ${table}, which is a DILIGENCE store`);
    assert.ok(Z.includes(table), `the page stopped naming ${table} as the store it is not showing`);
  }
  // And the reason is on the page, not only in a comment — a reader looking at
  // the screen has to be able to tell why the table the design promised is not
  // there.
  const shown = limits();
  assert.match(shown, /No closing checklist is stored/);
  assert.match(shown, /belong to DILIGENCE|belongs to DILIGENCE/i,
    'the rendered limits block no longer says why the diligence checklists are not shown');
  for (const table of ['dd_checklist_items', 'diligence_checklists']) {
    assert.ok(shown.includes(table), `the limits block stopped naming ${table}`);
  }
});

test('templates ARE stored, so the ops row says the narrower true thing', () => {
  // THE SEED, not the sentence. Three of these are the closing paper the
  // artboard names, and the old reason said none of them existed.
  for (const slug of ['safe', 'spa', 'subscription']) {
    assert.match(SEED, new RegExp(`\\('${slug}',`), `legal_templates no longer seeds ${slug}`);
  }
  assert.match(BASELINE, /CREATE TABLE legal_templates[\s\S]{0,400}merge_fields/,
    'legal_templates lost its merge fields — the correction below depends on them');

  const at = ACTIONS.indexOf("'deals/closing': [");
  assert.ok(at >= 0, 'the closing ops row is gone');
  const rowsrc = ACTIONS.slice(at, ACTIONS.indexOf('],', at));
  const reasons = [...rowsrc.matchAll(/unbuilt: '([^']*)'/g)].map((m) => m[1]);
  assert.equal(reasons.length, 3, 'the closing ops row changed shape');
  for (const reason of reasons) {
    assert.doesNotMatch(reason, /no closing templates are stored/, 'the false reason is back');
    // Same rule `profile_zone_actions` holds file-wide: an unbuilt reason is
    // prose nothing verifies, so a path named in one goes stale in silence.
    assert.doesNotMatch(reason, /(^|\s)\/[a-z]/, `an unbuilt reason carries an unchecked path: "${reason}"`);
  }
  assert.match(rowsrc, /what is missing is a closing checklist for one to be applied to/);
  // And the wire reason says WHICH DIRECTION is missing, because the store that
  // looks like a counter-example is real and points the other way.
  assert.match(BASELINE, /CREATE TABLE "capital_calls"[\s\S]{0,400}paid_date/,
    'capital_calls lost paid_date — the wire reason cites it');
  assert.match(rowsrc, /LP paying into the fund, which is the other direction/);
});

test('executed means completed, and a ratio is never mistaken for it', () => {
  // The defect this catches is counting `signed_count === recipient_count` as
  // executed: an envelope with ZERO recipients satisfies that trivially, and a
  // counter-signature can land while the envelope is still open.
  assert.match(Z, /rows\.filter\(\(e\) => e\.status === 'completed'\)/,
    'executed is no longer read off the status column');
  assert.ok(!/signed_count\s*===\s*.*recipient_count/.test(Z),
    'executed is inferred from a signature ratio');
  // An envelope with no recipient is excluded from the signature total rather
  // than counted as complete.
  assert.match(Z, /else unrecorded \+= 1;/, 'an envelope with no recipient is folded into the total');
  assert.match(Z, /no recipient, and \$\{sigs\.unrecorded === 1 \? 'is' : 'are'\} not counted/,
    'the note stopped saying the recipient-less envelopes are excluded');
  // And it renders as unrecorded in its own row.
  assert.match(Z, /\{ nr: true, sub: 'no recipient recorded' \}/);
  assert.doesNotMatch(Z, /\|\|\s*0\b(?!\s*[;,)])/, 'an absent figure falls back to 0');
});

test('the zone adds no endpoint, because both reads were already served and scoped', () => {
  // ID3's finding was that a second copy of a scoped query is how a tenancy
  // hole reopens. ID4's answer is to add neither a route nor a query.
  assert.match(Z, /api\.listDeals\(undefined, 'mine'\)/);
  assert.match(Z, /api\.esignList\(\)/);
  // The endpoint behind `esignList` puts the scope in FIRST and unconditionally.
  assert.match(ESIGN, /const scope = esignEnvelopeScope\(user\);\s*\n\s*const where: string\[\] = \[scope\.sql\];/,
    'esign.get(/) stopped opening its WHERE clause with the scope');
  // And the zone touches no store directly — the two calls above are the whole
  // data layer, so a third would be a new dependency this zone does not need.
  const calls = [...new Set([...Z.matchAll(/api\.([A-Za-z]+)\(/g)].map((m) => m[1]))].sort();
  assert.deepEqual(calls, ['esignList', 'listDeals'],
    'the zone gained an API call, so it is no longer composing two existing reads');
  for (const table of ['esign_envelopes', 'legal_templates']) {
    assert.ok(!fetching().includes(table), `the zone reads ${table} directly, which is the worker's job`);
  }
  // A new /deals or /ic route for this zone would be the regression.
  const DEALS = read('cloudflare-worker/src/routes/deals.ts');
  assert.ok(!DEALS.includes("deals.get('/closing'"), 'a closing endpoint was added that nothing needed');
});

test('only deals the shared stage map calls closing are on this page', () => {
  // BEHAVIOUR, not source: `dealStage` is pure and importable, so the boundary
  // is driven rather than regexed. `funded` is the only status that lands here.
  assert.equal(dealStage({ status: 'funded' }), 'closing');
  assert.equal(dealStage({ status: 'active', capital_committed: 5 }), 'commit');
  assert.equal(dealStage({ status: 'rejected' }), null, 'a passed deal has a stage again');
  assert.match(Z, /deals\.filter\(\(d\) => dealStage\(d\) === 'closing'\)/,
    'the zone stopped using the shared stage map');
  // And an envelope only appears if its deal is one of them — an envelope
  // pointing at a deal that is not closing is another stage's paper.
  assert.match(Z, /ids\.has\(e\.deal_id\)/);
});

test('none of the artboard’s fixture rows or figures reaches the page', () => {
  const board = id4();
  // The artboard's own compressed claims, none of which any store supports.
  for (const phrase of ['IP chain of title', 'term sheet and SAFE', '2 of 2', 'Funds moved']) {
    assert.ok(!ZONE.includes(phrase), `the zone ships the artboard’s sample text "${phrase}"`);
  }
  assert.match(board, /label:'Funds moved'/, 'the artboard changed its fourth tile');
  // The strip counts four recorded things instead.
  for (const label of ['At closing', 'Executed', 'Signatures', 'Awaiting']) {
    assert.ok(Z.includes(`label="${label}"`), `the strip lost its ${label} tile`);
  }
  const fixtures = [...CANVAS.matchAll(/\{ it:'([^']+)'/g)].map((m) => m[1]);
  for (const item of fixtures) {
    assert.ok(!ZONE.includes(item), `the zone ships the artboard’s sample checklist item ${item}`);
  }
});

test('no row is drawn as blocking, because the condition it would come from has no store', () => {
  // The artboard's note makes this explicit: the blocking item "arrived from
  // the Commit vote". ID3 established that no condition is stored, so ID4
  // inherits the gap rather than inventing a local one.
  assert.match(id4(), /arrived from the Commit vote/, 'the artboard changed its premise');
  const at = FILTERS.indexOf("'deals/closing': [");
  assert.ok(at >= 0, 'the closing filter row is gone');
  const rowsrc = FILTERS.slice(at, FILTERS.indexOf('],', at));
  assert.match(rowsrc, /canvas: 'Blocking', unbuilt:/, 'Blocking is offered as a live chip');
  assert.match(rowsrc, /canvas: 'Wires', unbuilt:/, 'Wires is offered as a live chip');
  for (const canvas of ['This close', 'Documents']) {
    assert.match(rowsrc, new RegExp(`canvas: '${canvas}', key:`), `${canvas} narrows nothing`);
  }
  // The artboard's four labels, in its order, read off the canvas.
  const fil = /filters: fil\(\[([^\]]*)\]/.exec(id4());
  assert.ok(fil, 'the artboard no longer declares its filter row');
  assert.deepEqual(
    fil[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')),
    [...rowsrc.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]),
    'the closing filter row drifted from the artboard',
  );
  assert.match(ZONE, /Nothing here can be blocking/);
});

test('the AI band is allow-listed and forbidden from inventing the condition', () => {
  assert.match(Z, /surface="deals\/closing"/, 'the zone dropped the artboard’s AI band');
  assert.match(RESEARCH, /'deals\/closing': \{/, 'the surface is not allow-listed, so the band 400s');
  const at = RESEARCH.indexOf("'deals/closing': {");
  const surface = RESEARCH.slice(at, RESEARCH.indexOf('\n  },', at));
  // The three instructions that matter, each pinned to what it prevents.
  assert.match(surface, /Never state a condition, a blocker or anything holding the transfer/);
  assert.match(surface, /records the movement of money and does not move it/);
  assert.match(surface, /NO RECIPIENT RECORDED is not partially signed/);
  // Scoped through the same shared helper the endpoint uses, with the caller's
  // own role — `UNSCOPED_ROLES` is {'admin'}, so a literal there would widen
  // the read to every firm's executed paper.
  assert.match(surface, /esignEnvelopeScope\(\{ id: userId, role \} as any\)/);
  assert.doesNotMatch(surface, /role:\s*'(admin|partner|investor)'/,
    'the gather hard-codes a role, which widens the scope past the caller');
  const gate = surface.indexOf("role !== 'admin'");
  assert.ok(gate > 0 && gate < surface.indexOf('esignEnvelopeScope'),
    'the role check runs after the read rather than before it');
});

test('the zone is mounted, and the workspace now draws no stage section at all', () => {
  assert.match(ROUTES, /closing: lazy\(\(\) => import\('\.\.\/\.\.\/pages\/investor\/deals\/ClosingZone'\)\)/);
  // ALL FOUR are registered — this is the commit that completes the set, so the
  // registry is checked whole rather than one row at a time.
  for (const slug of ['pipeline', 'screening', 'commit', 'closing']) {
    assert.match(ROUTES, new RegExp(`${slug}: lazy\\(`), `${slug} is not in the zone registry`);
  }
  // And the workspace kept none of them.
  for (const slug of ['pipeline', 'screening', 'commit', 'closing']) {
    assert.ok(!WORKSPACE.includes(`investorZoneActions('deals/${slug}'`),
      `the workspace still mounts the ${slug} ops row`);
    assert.ok(!WORKSPACE.includes(`id="deals-${slug}"`),
      `the workspace still draws the ${slug} section`);
  }
  assert.ok(!WORKSPACE.includes('investor-closing-list'),
    'the three hard-coded closing rows are back');
});
