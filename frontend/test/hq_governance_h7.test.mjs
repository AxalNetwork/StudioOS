/**
 * HQ · Security, reconciled with canvas H7 ("Governance, and the 'viewing
 * as' overlay").
 *
 * H7 IS THE ARTBOARD THAT ALREADY HAD A PAGE, which is why this file guards
 * a DIFF rather than a new surface. `/admin/security` renders canvas Y2, and
 * decision A4 folded the Governance row into it; most of H7 is Y2's zones
 * under other names. Three things were genuinely missing, and each has a
 * failure mode worth pinning:
 *
 *   THE FEED WAS A QUARTER OF THE TRAIL. Y2's audit zone read
 *   `admin_audit_log` alone. Three of H7's five filters — impersonations,
 *   licence changes, suspensions — have no rows in that table at all, so a
 *   filter bar over it would have looked like a working control returning
 *   nothing. The feed now unions four stores.
 *
 *   TENANT. H7 draws the column. Only a licence event can fill it, because
 *   it is about a licence; no account carries a licence_id (U1). The trap is
 *   a plausible tenant on every row, or a bare dash the reader has to guess
 *   at (D56/D68).
 *
 *   THE OVERLAY IS NOT BUILT. "Viewing as: Axal VC France · Return to HQ
 *   view" is a tenant-scoped read-only view. Drawing that chrome over the
 *   role switcher or over a support session would claim a scope the product
 *   does not have.
 *
 * AND H7'S RULE FOR ITSELF: "no cards, no summary tiles, no chart — an audit
 * log that has been made attractive is an audit log someone has edited for
 * legibility." That is asserted structurally, not by reading the sentence.
 *
 * Labels and column names are read OFF THE ARTBOARD rather than retyped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/hq/SecurityPage.jsx');
const P = codeOnly(PAGE);
const API = codeOnly(raw('frontend/src/lib/api.js'));
/** Long `*_reason` strings are wrapped across `+`-joined literals. */
const joined = (src) => src.replace(/'\s*\n\s*\+ '/g, '');
const ROUTE = joined(raw('cloudflare-worker/src/routes/admin_security.ts'));
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');

/**
 * H7 alone: its markup section AND its fixture block, both bounded at each
 * end. The markup only loops over fixtures, so the labels the artboard
 * "draws" live in the script — reading one half would find no filter names
 * at all.
 */
function h7() {
  const a = CANVAS.indexOf('H7 · GOVERNANCE');
  assert.ok(a >= 0, 'the H7 artboard could not be found in the canvas');
  const b = CANVAS.indexOf('</x-dc>', a);
  assert.ok(b > a, 'the H7 section is unterminated — this slice would run past the artboard');
  const fa = CANVAS.indexOf('// ── H7 ──', b);
  assert.ok(fa > b, 'the H7 fixture block is gone');
  const fb = CANVAS.indexOf('};', fa);
  assert.ok(fb > fa, 'the H7 fixture block is unterminated');
  return (CANVAS.slice(a, b) + CANVAS.slice(fa, fb)).replaceAll('&amp;', '&');
}

test('the feed carries the five columns the artboard draws, in its order', () => {
  const board = h7();
  const columns = ['Time', 'Actor', 'Tenant', 'Action', 'Target and reason'];
  for (const c of columns) {
    assert.ok(board.includes(`>${c}</span>`), `the artboard no longer draws the ${c} column`);
  }
  // The page's own header row, read as a sequence rather than as five
  // independent substrings: the order is part of the artboard.
  const head = PAGE.slice(PAGE.indexOf('data-testid="hq-gov-feed"'));
  const ths = [...head.slice(0, head.indexOf('</thead>')).matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(ths, columns, 'the feed head no longer matches the artboard');
});

test('the five filters are the artboard\'s five, and the server applies them', () => {
  const board = h7();
  const labels = ['All actions', 'Impersonations', 'Licence changes', 'Suspensions', 'Exports'];
  for (const l of labels) assert.ok(board.includes(`'${l}'`), `the artboard no longer offers "${l}"`);
  for (const l of labels) {
    assert.ok(ROUTE.includes(`label: '${l}'`), `the route no longer offers "${l}"`);
    assert.ok(P.includes(`label: '${l}'`), `the page's pre-flight bar no longer offers "${l}"`);
  }
  // Server-side, because the feed is a merged page across four stores: a
  // client-side filter would show whichever few of the sixty matched and
  // read as "that is all there is".
  assert.match(API, /hqGovernance: \(filter\) =>/, 'the api method no longer takes a filter');
  assert.match(API, /governance\?filter=\$\{encodeURIComponent\(filter \|\| 'all'\)\}/,
    'the filter is no longer sent to the server');
  assert.match(P, /api\.hqGovernance\(filter\)/, 'the page no longer asks the server for the filtered feed');
  assert.doesNotMatch(P, /feed\.rows\.filter\(/, 'the page filters the merged page in the browser');
});

test('the feed is a union of four stores, not the one Y2 read', () => {
  // Asserted as the WHOLE SET of tables the file reads, not as four
  // substring checks. Two earlier shapes of this were too weak: plain
  // `includes('FROM activity_logs')` passed a rename to
  // `activity_logs_disabled` on a prefix match, and adding the alias only
  // moved the problem — each store is now read by two statements, so
  // renaming one of the pair still left the other matching. Reading the set
  // means a renamed table shows up as an unexpected NAME, wherever it is.
  const tables = new Set(
    [...ROUTE.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]),
  );
  assert.deepEqual([...tables].sort(), [
    // The feed's four stores…
    'activity_logs', 'admin_audit_log', 'impersonation_sessions', 'licence_events',
    // …the two it joins for names, and the one /overview reads for sessions.
    'territory_licences', 'user_sessions', 'users',
  ], 'the set of tables this route reads changed');
  // And the page shows WHICH stores answered, so a silently-dropped store is
  // visible rather than indistinguishable from a quiet week.
  assert.match(P, /data-testid="hq-gov-sources"/, 'the page no longer says which stores were read');
  assert.match(P, /src\.available \? `\$\{num\(src\.rows\)\} read` : \(src\.reason \|\| 'unreadable'\)/,
    'an unreadable store renders the same as one that answered with nothing');
});

test('no summary tile sits above the feed — H7 forbids exactly that', () => {
  // The artboard's own words, and the structural check that enforces them:
  // between the zone opening and the table there must be no <Stat>.
  assert.ok(h7().includes('No cards, no summary tiles, no chart'), 'the artboard changed its mind');
  const zone = PAGE.slice(PAGE.indexOf('title="Privileged action log"'));
  const head = zone.slice(0, zone.indexOf('</Zone>'));
  assert.ok(head.includes('data-testid="hq-gov-feed"'), 'the feed left its zone');
  assert.doesNotMatch(head, /<Stat\b/, 'a summary tile appeared over the audit log');
  assert.doesNotMatch(head, /<StatGrid\b/, 'a summary grid appeared over the audit log');
});

test('tenant is filled only where a store can fill it, and never with a dash', () => {
  assert.match(ROUTE, /tenant: \(e\.brand_name as string\) \|\| null,/, 'a licence event no longer names its subsidiary');
  assert.equal(
    (ROUTE.match(/tenant: null,/g) || []).length, 3,
    'a row type other than a licence event started claiming a tenant, or one stopped saying it cannot',
  );
  assert.match(ROUTE, /tenant_available: false/);
  assert.match(ROUTE, /tenant_reason:[\s\S]{0,400}U1/, 'the blank column does not name why it is blank');
  // The cell: "Not recorded", never an em-dash and never a plausible name.
  assert.match(P, /\{r\.tenant \|\| <Unrecorded \/>\}/, 'the tenant cell no longer says it is unrecorded');
  assert.match(P, /data-testid="hq-gov-tenant-reason"/, 'the reason never reaches the screen');
  const cells = PAGE.slice(PAGE.indexOf('data-testid="hq-gov-feed"'), PAGE.indexOf('</table>', PAGE.indexOf('data-testid="hq-gov-feed"')));
  assert.doesNotMatch(cells, /—/, 'an em-dash stands in for an absent fact (D56/D68)');
});

test('the "Return to HQ view" overlay is built, and this page describes it rather than drawing it', () => {
  // NINTH INSTANCE OF THE CLASS, and by now it is a rule rather than a
  // surprise: a guard that pins a refusal has to be re-aimed the day the
  // refusal stops being true, or it becomes the thing preventing the fix.
  // This test used to assert the OPPOSITE of everything below — no "Viewing
  // as" chrome anywhere, `tenant_view_available: false`, and no "Return to HQ
  // view" control in App.jsx. Every one of those was correct while the overlay
  // was unbuilt (D150 had already corrected its REASON once, from U1 to "not
  // built"), and every one of them is false now that D153 built it.
  //
  // And the old assertion was never wrong in kind — it was CONDITIONAL, and
  // said so: its failure message was "a 'Return to HQ view' control appeared
  // with NO TENANT SCOPE BEHIND IT". It did not ban the control; it banned a
  // control with nothing behind it. So the re-aim is structural rather than a
  // loosening: the chrome may exist only where the reads are actually scoped.
  assert.ok(h7().includes('Return to HQ view'), 'the artboard no longer draws the overlay');

  // 1 — THE CHROME IS IN THE SHELL, not on a page. The overlay frames every
  // page it covers, so a per-page banner would be one copy per page and would
  // disagree with itself the first time one was missed.
  const bar = codeOnly(raw('frontend/src/components/HqViewingAsBar.jsx'));
  assert.match(bar, /Return to HQ view/, 'the shell bar lost its way out');
  assert.match(bar, /Read-only/, 'the bar stopped saying the view is read-only');
  assert.match(bar, /useViewAsBranch/, 'the bar invented its own state instead of reading the shell\'s');
  const app = codeOnly(raw('frontend/src/App.jsx'));
  assert.match(app, /<SafeMount name="HqViewingAsBar">/, 'the bar is not mounted');
  // ABOVE `PortalSwitcher`, D142's rule one tier up: the ordinary admin chrome
  // must never be the only frame on a view the operator is not in by default.
  // ANCHORED ON THE MOUNT, NOT THE NAME. Reading `indexOf('HqViewingAsBar')`
  // found the IMPORT line at the top of the file, which is before every mount
  // — so the comparison was true whatever the mount order was, and the
  // assertion could not fail. Caught by moving the mount below PortalSwitcher
  // and watching it pass. An assertion that cannot fail is not a guard.
  assert.ok(
    app.indexOf('<SafeMount name="HqViewingAsBar">') < app.indexOf('<PortalSwitcher'),
    'the viewing-as bar mounts below PortalSwitcher, so the admin bar can frame a scoped view alone',
  );

  // 2 — THERE IS A SCOPE BEHIND IT, which is what the old guard demanded. The
  // reads change, not the render: a page that filtered a payload it already
  // had would be exactly the "filter on an HQ table" H12 says this is not.
  const apiSrc = codeOnly(raw('frontend/src/lib/api.js'));
  assert.match(apiSrc, /hqOverview: \(branch\)/, 'hqOverview stopped taking a branch');
  assert.match(apiSrc, /\?branch=\$\{encodeURIComponent\(b\)\}/, 'the scope never reaches the wire');
  const hq = codeOnly(raw('cloudflare-worker/src/routes/admin_hq.ts'));
  assert.match(hq, /branchRead<BranchOverview>\(env, scoped, 'overview'\)/,
    'the scoped route fans out and discards instead of reading one branch');

  // 3 — THE PAYLOAD STOPPED REFUSING. `false` here is the refusal this test
  // spent two decisions pinning; it is the assertion that fails if anyone
  // restores it.
  assert.match(ROUTE, /tenant_view_available: true/);
  assert.doesNotMatch(ROUTE, /tenant_view_available: false/,
    'the governance payload went back to refusing a view the product has');
  assert.doesNotMatch(ROUTE, /tenant_view_reason:[\s\S]{0,600}has not been built/,
    'the reason still says the overlay is unbuilt');
  assert.doesNotMatch(ROUTE, /tenant_view_reason:[\s\S]{0,600}which is U1/);
  assert.match(P, /\{feed\.tenant_view_reason\}/, 'the page hardcodes the explanation instead of reading it');
});


test('guardrail hits are counted — but never the artboard\'s per-category rows', () => {
  // D152 RE-AIMED THIS, AND IT IS THE SEVENTH TIME A GUARD PINNING A REFUSAL
  // HAD TO MOVE THE DAY THE REFUSAL STOPPED BEING TRUE. The title said the
  // artboard's rows "have no store" and the body asserted
  // `guardrails: absent(NO_AI_SAFETY_STORE)`. The store existed: `safety_score`
  // is written on every router call and `advisor_turn_audit` carries the block
  // and the flag — both already rolled up, and already drawn on `AiUsageTab`.
  //
  // What survives is SHARPER than what it replaced, because the artboard draws
  // `{ what, meta, n }` — a COUNT PER CATEGORY — and the category is precisely
  // the field `writeTurnAudit` throws away. So the panel's totals are real and
  // its rows are not, and those are two different facts about one artboard.
  const board = h7();
  assert.ok(board.includes('Guardrail hits'), 'the artboard no longer draws the panel');
  assert.ok(board.includes('Advisor-AI outputs the screen caught'), 'the artboard changed the panel\'s subtitle');
  // The page carries the artboard's phrase on the zone that owns the figures
  // rather than opening a second zone for the same store.
  assert.match(P, /sub="guardrail hits · Advisor-AI outputs the screen caught"/);

  // The counters are REAL and come from the one rollup, not from a literal.
  assert.match(ROUTE, /ai_safety: await aiSafetyBlock\(env\)/,
    '/overview stopped serving the guardrail counters');
  assert.match(P, /<AiSafety block=\{ready \? data\.ai_safety : null\}/,
    'the AI-safety zone stopped rendering the counters it is served');

  // D158 — THE CATEGORY ROW IS GONE, BECAUSE THE ABSENCE IT DESCRIBED IS.
  // This assertion used to REQUIRE the row `what: 'Which guardrail rule fired'`,
  // and its own comment gave the reason: a per-category count would be
  // "invented for a column no table has". Migration 270 gave
  // `advisor_turn_audit` that column, so the premise is what changed. Twelfth
  // refusal re-aimed the day it stopped being true — and the first the codebase
  // had filed against itself.
  //
  // What is pinned now is the stronger property the row was standing in for:
  // the panel may claim a per-rule breakdown ONLY where one is actually served.
  assert.doesNotMatch(ROUTE, /what: 'Which guardrail rule fired'/,
    'the panel is refusing a breakdown it now serves');
  assert.match(ROUTE, /enforcement: counters\.enforcement/,
    'the block stopped passing enforcement through, so the breakdown reaches nobody');
  // The rows that ARE still unbuilt keep their reasons, and still carry no
  // invented count — the half of the old assertion that is still true.
  for (const what of ['Token anomalies', 'Guardrail counters by branch']) {
    const at = ROUTE.indexOf(`what: '${what}'`);
    assert.ok(at > 0, `${what} lost its row without the absence being closed`);
    assert.doesNotMatch(ROUTE.slice(at, ROUTE.indexOf('},', at)), /\bn:\s/,
      `the ${what} row acquired a count, which nothing measures`);
  }

  // None of the artboard's sample counts leaked onto the page.
  for (const n of ['Outbound investor message', 'Founder-facing draft', 'LP correspondence']) {
    assert.ok(!PAGE.includes(n), `the artboard's fixture "${n}" was rendered as though it were data`);
  }
});

test('data access is one zone in two halves, and neither can hide the other', () => {
  const board = h7();
  assert.ok(board.includes('Data access'), 'the artboard no longer draws the zone');
  assert.ok(board.includes('Impersonations and exports'), 'the artboard changed the zone\'s subtitle');
  assert.match(P, /<Zone title="Data access" sub="impersonations and exports">/);
  assert.match(P, /data-testid="hq-data-access"/);
  // Two independently-available blocks: one unreadable store must not make
  // the other half read as the whole answer.
  assert.match(ROUTE, /impersonations: accessImpersonations,/);
  assert.match(ROUTE, /exports: accessExports,/);
  assert.match(P, /access\.impersonations\.available \?/);
  assert.match(P, /access\.exports\.available \?/);
});

test('a session open past its limit reads "not closed", not "0m left"', () => {
  // The token expires at thirty minutes; closing the row is best-effort on
  // the way out. An open row past the limit means the RECORD was not closed.
  assert.match(ROUTE, /dur = 'not closed';/);
  assert.match(ROUTE, /elapsed >= IMPERSONATION_EXPIRY_MINUTES/);
  assert.match(ROUTE, /dur = `\$\{IMPERSONATION_EXPIRY_MINUTES - elapsed\}m left`;/);
  assert.ok(PAGE.includes('not closed'), 'the page never explains what the state means');
  assert.ok(PAGE.includes('&ldquo;0m left&rdquo; would say somebody is still inside'),
    'the page no longer says why the state is not a countdown');
});

test('nothing absent on this page falls back to a number', () => {
  assert.doesNotMatch(P, /\|\|\s*0\b/, 'an absent figure falls back to 0');
  assert.doesNotMatch(P, /\?\?\s*0\b/, 'an absent figure falls back to 0');
  // An unreadable feed is distinguished from an empty one, in both directions.
  assert.ok(P.includes('claim="This is not a claim that nobody did anything."'),
    'an unreadable feed does not say what it is not');
  assert.match(P, /data-testid="hq-gov-empty"/, 'an empty feed renders as nothing at all');
  assert.match(ROUTE, /const readAudit = filter === 'all' \|\| filter === 'exports';/);
});

test('the AI-safety zone renders counters, and each half shows its own state', () => {
  // D152. The zone was `<Absent block={data.ai_safety} …>` — one line of
  // refusal where four figures belong. What must hold now is not that the
  // tiles exist but that NEITHER PAIR CAN RENDER A NUMBER IT WAS NOT GIVEN:
  // the verdict pair reads `verdicts.available`, the enforcement pair reads
  // `enforcement.available`, and they are separate because they come from
  // separate tables that fail separately.
  const at = P.indexOf('function AiSafety(');
  assert.ok(at > 0, 'the AI-safety zone lost its component');
  const body = P.slice(at, P.indexOf('function Stat(', at));

  for (const [label, flag] of [
    ['Guard verdicts', 'v?.available'],
    ['Judged unsafe', 'v?.available'],
    ['Turns blocked', 'e?.available'],
    ['Outputs flagged', 'e?.available'],
  ]) {
    const cell = body.indexOf(`label="${label}"`);
    assert.ok(cell > 0, `the "${label}" tile is gone`);
    // Bounded to this tile, so a neighbour's gate cannot satisfy the
    // assertion — the mistake a whole-file scan makes every time.
    const tile = body.slice(cell, body.indexOf('/>', cell));
    assert.ok(
      tile.includes(`value={${flag}`),
      `"${label}" must render its figure under \`${flag}\` — the store it actually came from`,
    );
    // AND THE ABSENT ARM IS `null`, NOT A NUMBER — asserted here because the
    // page's own `|| 0` / `?? 0` ban cannot see it. A mutation to
    // `value={v?.available ? num(v.evaluated) : 0}` walked through every
    // other assertion in this PR: it is not the banned idiom, and the gate it
    // checks is still there. A tile that renders 0 for a counter it could not
    // read is the exact defect on the exact surface where it is worst.
    assert.match(
      tile, /:\s*null\}/,
      `"${label}" falls back to a number when its store could not be read — absent is not zero`,
    );
  }

  // A rate over an empty denominator is not 0%, and the page says which.
  assert.match(body, /safe_rate !== null/,
    'the safe rate stopped distinguishing "nothing was evaluated" from "0% safe"');
  assert.match(body, /the guard did not run in this window/);

  // The narrowed absences are rendered WITHOUT a count, because the artboard's
  // per-category rows are the one thing no table can supply.
  assert.match(body, /data-testid="hq-ai-safety-not-counted"/);
  assert.match(body, /\{n\.reason\}/, 'the not-counted rows dropped their reasons');
});

test('the rail stopped saying nothing aggregates guardrail verdicts', () => {
  // THE SIXTH TIME A RAIL ROW HAD TO BE RE-AIMED THE DAY ITS REFUSAL STOPPED
  // BEING TRUE (D129, D131, D140, D147, D150's three, D151's three). This row
  // was the sharpest of them: it denied a rollup the platform was rendering on
  // another page of the same admin console.
  //
  // RAW, NOT `codeOnly`: the correction is recorded in a comment that quotes
  // the sentence, and a scan of the stripped source is what proves the CLAIM
  // is gone from the rendered rows rather than from the file.
  assert.ok(PAGE.includes('Nothing aggregates guardrail verdicts'),
    'the page stopped recording which claim D152 corrected');
  assert.doesNotMatch(P, /Nothing aggregates guardrail verdicts/,
    'the false rail row came back — the verdicts are aggregated, and drawn on AiUsageTab');

  // And the rows that replaced it are the SERVER's, not retyped — so the zone
  // and the rail cannot come to disagree about what is missing.
  assert.match(P, /data\.ai_safety\?\.not_counted \|\| \[\]/,
    'the rail hand-types its AI-safety absences instead of reading the payload');
  assert.match(ROUTE, /what: 'Token anomalies'/,
    'the one clause of the old sentence that was TRUE lost its row');
});
