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
  // The trailing space matters: `FROM activity_logs` is a prefix of
  // `FROM activity_logs_disabled`, and a substring check let exactly that
  // rename through. Each read is `FROM <table> <alias>`.
  for (const [store, alias] of [['admin_audit_log', 'a'], ['activity_logs', 'l'],
                                ['impersonation_sessions', 'i'], ['licence_events', 'e']]) {
    assert.ok(ROUTE.includes(`FROM ${store} ${alias}`), `the feed no longer reads ${store}`);
  }
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

test('the "Return to HQ view" overlay is not drawn, and the page says why', () => {
  assert.ok(h7().includes('Return to HQ view'), 'the artboard no longer draws the overlay');
  // THE ABSENCE OF A CONTROL, NOT OF A PHRASE. Matching the words caught the
  // page's own sentence explaining that the overlay is deliberately not
  // built — the opposite of the defect, and the same trap the Platform page
  // guard hit with "Reveal". So: the phrase may appear in prose, and must
  // not appear inside anything clickable.
  const controls = [...PAGE.matchAll(/<(button|a)\b[\s\S]*?<\/\1>/g)].map((m) => m[0]);
  assert.ok(controls.length > 0, 'the page has no controls at all — this assertion stopped checking anything');
  for (const c of controls) {
    assert.doesNotMatch(c, /Return to HQ|Viewing as/,
      'the overlay\'s chrome appeared as a control with no tenant scope behind it');
  }
  assert.ok(!P.includes('Viewing as'), 'the page drew a tenant-scoped banner it cannot back');
  assert.match(P, /No &ldquo;Return to HQ view&rdquo;/, 'the page stopped naming the overlay it does not draw');
  assert.ok(!codeOnly(raw('frontend/src/App.jsx')).includes('Return to HQ view'),
    'a "Return to HQ view" control appeared with no tenant scope behind it');
  // But the absence is explained, from the payload rather than from a copy.
  assert.match(ROUTE, /tenant_view_available: false/);
  assert.match(ROUTE, /tenant_view_reason:[\s\S]{0,500}U1/);
  assert.match(P, /\{feed\.tenant_view_reason\}/, 'the page hardcodes the explanation instead of reading it');
});

test('guardrail hits stay unrecorded — the artboard\'s three rows have no store', () => {
  const board = h7();
  assert.ok(board.includes('Guardrail hits'), 'the artboard no longer draws the panel');
  assert.ok(board.includes('Advisor-AI outputs the screen caught'), 'the artboard changed the panel\'s subtitle');
  // The page carries the artboard's phrase on the zone that owns the absence
  // rather than opening a second zone for the same missing store.
  assert.match(P, /sub="guardrail hits · Advisor-AI outputs the screen caught"/);
  assert.match(ROUTE, /guardrails: absent\(NO_AI_SAFETY_STORE\)/);
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
