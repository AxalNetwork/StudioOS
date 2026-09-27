/**
 * Deals · Closing — canvas **ID4**, `/deals/closing`. The last of the four.
 *
 * WHAT THIS FILE GUARDS. The zone shipped as three hard-coded rows — a tick and
 * two circles reading "Deal reached closing · Recorded", "Signatures and
 * documents · Check deal room", "Wire confirmation · Not recorded here" — which
 * said the same thing on every deal because nothing was read to produce them.
 *
 * THE CHECKLIST HAS ITS OWN STORE NOW (D462, migration 335), and the one thing
 * here most likely to be "fixed" by someone who has not checked is WHICH store
 * it reads. The two tables that look like candidates —
 * `dd_checklist_items` and `diligence_checklists` — belong to DILIGENCE, and
 * joining them here would relabel diligence work as closing work on a document
 * a fund hands to counsel. So the assertions below pin the boundary in both
 * directions: the page must not read either table, and it must say why in its
 * limits block — while drawing the checklist from `deal_closing_checklist_items`.
 *
 * THE OPS ROW IS TESTED AS A CLAIM. `Apply template` said "no closing templates
 * are stored" and `legal_templates` seeds the SAFE, stock-purchase and
 * subscription agreements. The test reads the seed migration rather than
 * matching the corrected sentence, because a sentence can be rewritten without
 * the fact changing — which is the failure this whole series is about.
 *
 * EVERY READ IS SCOPED AT ITS OWN ROUTE. The zone composes five reads — the
 * deals, the paper, the open conditions, the transfers, the per-deal checklist
 * — each scoped at its route, so a second copy of any predicate would be a
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

test('the closing checklist is drawn from its own store, and the diligence tables are not borrowed', () => {
  // The artboard asks for it and migration 335 stores it, so it is drawn —
  // from `deal_closing_checklist_items`, the closing stage's own rows.
  assert.match(id4(), /instTitle:'Closing checklist'/, 'the artboard changed its instrument');
  assert.match(Z, /data-testid="closing-checklists"/, 'the zone no longer draws the checklist');

  // The two tables that predate it are diligence, and neither may be read here.
  assert.match(BASELINE, /CREATE TABLE dd_checklist_items/, 'the diligence store is gone — re-check this guard');
  assert.match(BASELINE, /CREATE TABLE diligence_checklists/);
  const body = fetching();
  for (const table of ['dd_checklist_items', 'diligence_checklists']) {
    assert.ok(!body.includes(table), `the zone reads ${table}, which is a DILIGENCE store`);
    assert.ok(Z.includes(table), `the page stopped naming ${table} as the store it is not showing`);
  }
  // And the distinction is on the page, not only in a comment — a reader
  // looking at the screen has to be able to tell which store the checklist is
  // and why the diligence ones are not borrowed.
  const shown = limits();
  assert.match(shown, /belong to DILIGENCE|belongs to DILIGENCE/i,
    'the rendered limits block no longer says why the diligence checklists are not shown');
  for (const table of ['dd_checklist_items', 'diligence_checklists']) {
    assert.ok(shown.includes(table), `the limits block stopped naming ${table}`);
  }
  // The default item set is the owner's call, and the page names that as the
  // missing decision rather than seeding a list nobody signed off. The source
  // wraps the sentence, so the match is whitespace-tolerant.
  assert.match(shown, /default item set is\s+the owner/i, 'the missing owner decision is no longer named on screen');
});

test('the closing ops are live over the stores migration 335 built', () => {
  // THE SEED, not the sentence. Three of these are the closing paper the
  // artboard names, and an apply that names one must name a seeded row.
  for (const slug of ['safe', 'spa', 'subscription']) {
    assert.match(SEED, new RegExp(`\\('${slug}',`), `legal_templates no longer seeds ${slug}`);
  }
  assert.match(BASELINE, /CREATE TABLE legal_templates[\s\S]{0,400}merge_fields/,
    'legal_templates lost its merge fields — the correction below depends on them');

  const at = ACTIONS.indexOf("'deals/closing': [");
  assert.ok(at >= 0, 'the closing ops row is gone');
  const rowsrc = ACTIONS.slice(at, ACTIONS.indexOf('],', at));
  // All three are page-supplied handlers now (D462): the checklist store is
  // what the templates were waiting on, the packet indexes the executed paper,
  // and deal_transfers records the wire out.
  for (const [label, handler] of [['Apply template', 'applyTemplate'], ['Export packet', 'exportPacket'], ['Record wire', 'recordWire']]) {
    assert.match(
      rowsrc,
      new RegExp(`\\{ label: '${label}', kind: 'handler', handler: '${handler}' \\}`),
      `${label} is not the page-performed op D462 made it`,
    );
  }
  // The wire's gate is the conditions store: an open condition refuses the
  // recording with a 409 whose sentence the form prints.
  const DEALS = read('cloudflare-worker/src/routes/deals.ts');
  assert.match(DEALS, /open_conditions_block_transfer/, 'the transfer write lost its conditions gate');
  assert.match(ZONE, /cause\?\.message/, 'the form stopped printing the route’s refusal');
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

test('every read the zone makes is a scoped one', () => {
  // ID3's finding was that a second copy of a scoped query is how a tenancy
  // hole reopens. ID4 composes three reads, each scoped at its own route: the
  // deals (this fund's), the paper (the envelope scope) and — since D461 —
  // the open conditions (the decision scope, in ic.ts where that predicate
  // lives).
  assert.match(Z, /api\.listDeals\(undefined, 'mine'\)/);
  assert.match(Z, /api\.esignList\(\)/);
  assert.match(Z, /api\.icConditions\('open'\)/);
  // The endpoint behind `esignList` puts the scope in FIRST and unconditionally.
  assert.match(ESIGN, /const scope = esignEnvelopeScope\(user\);\s*\n\s*const where: string\[\] = \[scope\.sql\];/,
    'esign.get(/) stopped opening its WHERE clause with the scope');
  // And the conditions read rides the decision scope rather than a second
  // copy of it — the same rule this zone's own design was written under.
  const IC = read('cloudflare-worker/src/routes/ic.ts');
  const condAt = IC.indexOf("r.get('/conditions'");
  assert.ok(condAt >= 0, 'the conditions list route is gone');
  assert.match(IC.slice(condAt, condAt + 1400), /icDecisionScope\(user\)/,
    'the conditions list stopped riding the decision scope');
  // And the zone touches no store directly — these calls are the whole data
  // layer: the deals, the paper, the open conditions, the transfers, and the
  // per-deal checklist (D462).
  const calls = [...new Set([...Z.matchAll(/api\.([A-Za-z]+)\(/g)].map((m) => m[1]))].sort();
  assert.deepEqual(calls, [
    'dealClosingChecklist', 'dealClosingChecklistAddItem', 'dealClosingChecklistApply',
    'dealClosingChecklistSetItem', 'dealTransferRecord', 'dealsTransfers',
    'esignList', 'icConditions', 'listDeals',
  ], 'the zone gained an API call beyond the scoped reads');
  for (const table of ['esign_envelopes', 'legal_templates']) {
    assert.ok(!fetching().includes(table), `the zone reads ${table} directly, which is the worker's job`);
  }
  // A new /deals route for this zone would be the regression.
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
  for (const phrase of ['IP chain of title', 'term sheet and SAFE', '2 of 2']) {
    assert.ok(!ZONE.includes(phrase), `the zone ships the artboard’s sample text "${phrase}"`);
  }
  assert.match(board, /label:'Funds moved'/, 'the artboard changed its fourth tile');
  // The strip counts five recorded things — `Funds moved` is real now
  // (migration 335), summed over the recorded transfers rather than copied
  // from the artboard's `$0`.
  for (const label of ['At closing', 'Executed', 'Signatures', 'Awaiting', 'Funds moved']) {
    assert.ok(Z.includes(`label="${label}"`), `the strip lost its ${label} tile`);
  }
  assert.match(Z, /dealMoneyExact\(movedCents \/ 100\)/, 'Funds moved must sum the recorded transfers');
  const fixtures = [...CANVAS.matchAll(/\{ it:'([^']+)'/g)].map((m) => m[1]);
  for (const item of fixtures) {
    assert.ok(!ZONE.includes(item), `the zone ships the artboard’s sample checklist item ${item}`);
  }
});

/** One tile's own element, bounded at its closing `/>`. */
function tile(label) {
  const at = Z.indexOf(`label="${label}"`);
  assert.ok(at > 0, `the ${label} tile is gone`);
  const end = Z.indexOf('/>', at);
  assert.ok(end > at, `the ${label} tile is not a self-closing element any more`);
  return Z.slice(at, end);
}

test('one failed read is never counted as a zero — this strip is a join', () => {
  // THE FAILURE THIS PINS. `rows` is the envelopes filtered against the closing
  // deals, so it needs BOTH `listDeals` and `esignList`, and it collapses to
  // `[]` when either is missing. A tile gated on one flag therefore printed a
  // number it could not know: with the deal record unreadable, "Executed" read
  // "0 of 0" and "Awaiting" read "0", each under a sentence explaining what the
  // figure meant. `bothFailed` never caught it, because that only fires when
  // BOTH reads fail — the noisy case. One failed read was the quiet one.
  //
  // This zone's own docblock already says "a record that is readable and holds
  // no deal at this stage is a different fact from a record that could not be
  // read". These assertions are that sentence, applied to the strip.
  assert.match(Z, /const joinedReady = dealsReady && envReady;/,
    'the joined-readiness flag is gone, or is retyped per tile rather than derived once');

  // Three of the four figures cross both reads.
  for (const label of ['Executed', 'Signatures', 'Awaiting']) {
    const t = tile(label);
    assert.match(t, /value=\{joinedReady\b/, `${label} counts from a single read`);
    assert.match(t, /note=\{joinedReady\b/, `${label} explains a figure it may not have`);
  }

  // "At closing" is the half-exception, and the autofix that prompted this
  // missed it: its VALUE counts deals, so `dealsReady` is right there — but its
  // NOTE counts documents, which needs the envelopes too.
  const atClosing = tile('At closing');
  assert.match(atClosing, /value=\{dealsReady \? String\(closing\.length\) : null\}/,
    'the closing count stopped standing on the deal read alone');
  assert.match(atClosing, /note=\{joinedReady\b/,
    'the document count still renders under a single read');

  // And the tone follows the same gate — an amber "Awaiting" over a figure
  // that is not there would be an alarm about nothing.
  assert.match(tile('Awaiting'), /tone=\{joinedReady && awaiting\.length/,
    'the awaiting tone is raised from a figure that may not exist');
});

test('an unreadable tile names WHICH read is missing, not just that one is', () => {
  // "unreadable" on its own sends a reader to refresh the wrong thing. Both
  // single-failure branches are distinct sentences and both name their source.
  assert.match(Z, /const missingRead = dealsReady/, 'the per-source reason is gone');
  assert.match(Z, /the signature archive could not be read, so nothing can be counted/,
    'a missing signature archive no longer says so');
  assert.match(Z, /the deal record could not be read, so there is nothing to count envelopes against/,
    'a missing deal record no longer says so');
  // The bare word is not a reason, and was what two of these tiles used to say.
  for (const label of ['Signatures', 'Awaiting']) {
    assert.doesNotMatch(tile(label), /:\s*'unreadable'/,
      `the ${label} tile still falls back to the bare word "unreadable"`);
  }
});

test('a blocking row is an open Commit condition, read from the store the hand-off runs on', () => {
  // The artboard's note makes this explicit: the blocking item "arrived from
  // the Commit vote". D461 built that hand-off — `ic_conditions` (migration
  // 334) — so the chip is live and the rows are the commit room's, never
  // typed locally.
  assert.match(id4(), /arrived from the Commit vote/, 'the artboard changed its premise');
  const at = FILTERS.indexOf("'deals/closing': [");
  assert.ok(at >= 0, 'the closing filter row is gone');
  const rowsrc = FILTERS.slice(at, FILTERS.indexOf('],', at));
  assert.match(rowsrc, /canvas: 'Blocking', key: 'blocking'/, 'Blocking is not the live chip the store now serves');
  // `Wires` went live with D462 (migration 335's deal_transfers) — the
  // transfer out to a company is recorded now.
  assert.match(rowsrc, /canvas: 'Wires', key: 'wires'/, 'Wires is not the live chip the transfer store serves');
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
  // The page reads the open conditions and narrows them to deals at closing.
  assert.match(ZONE, /api\.icConditions\('open'\)/, 'the zone never reads the conditions store');
  assert.match(ZONE, /cond\.deal_id != null && ids\.has\(cond\.deal_id\)/,
    'the blocking rows must narrow to the deals at closing');
  assert.match(ZONE, /Blocking is real, and lives in the commit room/);
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
