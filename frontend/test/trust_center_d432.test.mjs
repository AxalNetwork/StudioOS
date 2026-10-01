/**
 * D432 — Trust Center: the other party has a name, a failed read says so,
 * one list of role NDAs, and the company card is a component, not a render.
 *
 * FOUR THINGS, EACH PINNED TO THE PROPERTY RATHER THAN THE LITERAL.
 *
 * 1. PAIRWISE ROWS NAME BOTH PARTIES. The canvas titles a row "Novacraft
 *    Labs, Inc. ↔ Marisol Vega" for an admin and "Dev Raman · Latitude Seed"
 *    for a member; the page used to print the document type and an email.
 *    `partyLabel` reads the name the worker now serves, falls back to the
 *    email it always served, and says "removed" for an account the join could
 *    not find. `pairwiseTitle` orients a member's row around the OTHER party.
 *    Both are pure, so they are run here, not only grepped.
 *
 * 2. THE COMPANY-KYB CARD SAYS "UNREADABLE". It used to catch the error into
 *    `loaded`, which drew what "no companies" draws: nothing. The worker now
 *    refuses (cloudflare-worker/test/trust_center_d432.test.ts) and the card
 *    has a third state that draws `<Unreadable>` with a retry.
 *
 * 3. ONE LIST OF ROLE NDAS. The Template NDAs card drew the same obligations
 *    the Role agreements section drew above it, and only that copy offered
 *    "Open to sign". The button now sits on the Role agreements rows, fed by
 *    the same GET /trust/nda/required.
 *
 * 4. THE CARD IS DECLARED ONCE, AT MODULE LEVEL. Declared inside the page's
 *    body, it was a new component type on every render, so React remounted it
 *    and its effect re-fetched on every keystroke elsewhere on the page.
 *
 * And the two routes nothing called are gone, with the client methods that
 * fronted them (D304): GET /trust/summary and POST /trust/kyb/start.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/TrustCenterPage.jsx');
const CODE = codeOnly(PAGE);
const API = codeOnly(read('frontend/src/lib/api.js'));
const WORKER = codeOnly(read('cloudflare-worker/src/routes/trust.ts'));
const ROUTE_MAP = read('documentation/architecture/ROUTE_MAP.md');

function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `could not slice ${from} → ${to}`);
  return src.slice(a, b);
}

// The two helpers are pure functions of a row; lift them out of the module
// and run them. A regex on their source would pin the spelling, not the
// orientation.
function helpers() {
  const src = slice(CODE, 'function partyLabel', 'function AgreementsTab');
  return new Function(`${src}; return { partyLabel, pairwiseTitle };`)();
}

// ---------------------------------------------------------------------------
// 1. Names.
// ---------------------------------------------------------------------------

test('a party is labelled by name, then by email, then as a removed account', () => {
  const { partyLabel } = helpers();
  const row = {
    party_a_user_id: 1, party_a_name: 'Marisol Vega', party_a_email: 'marisol@example.com',
    party_b_user_id: 2, party_b_name: null, party_b_email: 'dev@example.com',
  };
  assert.equal(partyLabel(row, 'a'), 'Marisol Vega');
  assert.equal(partyLabel(row, 'b'), 'dev@example.com', 'no name → the email the worker always served');
  assert.equal(partyLabel({ party_b_user_id: 77, party_b_name: null, party_b_email: null }, 'b'),
    'account #77 · removed', 'neither → say the account is gone, never print "null"');
  assert.equal(partyLabel({ party_a_user_id: 5, party_a_name: '', party_a_email: 'x@example.com' }, 'a'),
    'x@example.com', 'an empty name is no name');
});

test('an admin reads A ↔ B; a member reads the OTHER party, whichever side they are', () => {
  const { pairwiseTitle } = helpers();
  const row = {
    party_a_user_id: 1, party_a_name: 'Marisol Vega', party_a_email: 'marisol@example.com',
    party_b_user_id: 2, party_b_name: 'Dev Raman', party_b_email: 'dev@example.com',
  };
  assert.equal(pairwiseTitle(row, 9, true), 'Marisol Vega ↔ Dev Raman');
  assert.equal(pairwiseTitle(row, 1, false), 'Mutual NDA · Dev Raman', 'party A sees B');
  assert.equal(pairwiseTitle(row, 2, false), 'Mutual NDA · Marisol Vega', 'party B sees A');
  // The id arrives from localStorage as a string and from the API as a number:
  // party A as the string '1' must still be oriented to B. (Asked with A's id,
  // because B's would read right by accident under a strict comparison.)
  assert.equal(pairwiseTitle(row, '1', false), 'Mutual NDA · Dev Raman');
});

test('the row draws that title, from the signed-in user id, and nothing else titles it', () => {
  assert.match(CODE, /data-testid="pairwise-title"/);
  assert.match(CODE, /\{pairwiseTitle\(a, meId, isAdmin\)\}/);
  assert.match(CODE, /const meId = safeReadJSON\('user', \{\}\)\?\.id;/);
  // The old title — a document type with an email in brackets — is gone.
  assert.doesNotMatch(CODE, /party_b_email\}\)/);
  assert.equal((CODE.match(/data-testid="pairwise-title"/g) || []).length, 1);
});

test('the worker serves the names the label reads, on both caller branches', () => {
  const route = slice(WORKER, "trust.get('/pairwise-ndas'", "trust.post('/pairwise-ndas/:id/resend'");
  assert.equal((route.match(/ua\.name AS party_a_name, ub\.name AS party_b_name/g) || []).length, 2);
});

// ---------------------------------------------------------------------------
// 2. Unreadable.
// ---------------------------------------------------------------------------

test('the company card has a failed state and draws Unreadable with a retry', () => {
  const card = slice(CODE, 'function CompanyKybCard()', 'function SanctionsTab()');
  assert.match(card, /phase: 'failed'/, 'a third state, distinct from empty');
  assert.match(card, /\.catch\(\(e\) => \{[^}]*phase: 'failed'/, 'the catch sets it, instead of pretending the list loaded');
  assert.match(card, /data-testid="company-kyb-unreadable"/);
  assert.match(card, /<Unreadable what="Your companies’ entity records"[^>]*onRetry=/);
  assert.match(card, /onRetry=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\}/, 'retry re-runs the effect');
  assert.match(card, /\}, \[attempt\]\);/, 'the effect depends on the attempt counter');
  assert.match(PAGE, /import \{ Unreadable \} from '\.\.\/ui';/);
  // The empty list still draws nothing: no companies is not a failure.
  assert.match(card, /if \(!state\.items\.length\) return null;/);
  // And the old shape — a bare `loaded` flag that could not tell the two apart — is gone.
  assert.doesNotMatch(card, /setLoaded\(true\)/);
});

test('the worker refuses the read with a code the page could branch on', () => {
  const route = slice(WORKER, "trust.get('/companies/kyb'", "trust.post('/companies/kyb'");
  assert.match(route, /return refuse\(c, 503, \{\s*code: 'company_kyb_unreadable'/);
  assert.doesNotMatch(route, /catch \{ rows = \{ results: \[\] \}; \}/, 'the swallow is back');
});

// ---------------------------------------------------------------------------
// 3. One list of role NDAs.
// ---------------------------------------------------------------------------

test('the Role agreements rows carry Open to sign, fed by /nda/required', () => {
  assert.match(CODE, /<AgreementsTab[^>]*requiredNdas=\{requiredNdas\}/);
  assert.match(CODE, /function ObligationList\(\{ obligations, emptyText, onStart, rowAction = null \}\)/);
  assert.match(CODE, /\{rowAction \? rowAction\(o\) : null\}/);
  const tab = slice(CODE, 'function AgreementsTab(', 'function CompanyKybCard()');
  assert.match(tab, /const ndaByKey = new Map\(\(requiredNdas \|\| \[\]\)\.map\(\(it\) => \[it\.obligation_key, it\]\)\);/);
  assert.match(tab, /if \(!it \|\| !it\.open\) return null;/, 'a satisfied NDA gets no button');
  assert.match(tab, /if \(it\.evidence_envelope_uuid\) return <OpenToSignButton item=\{it\} onChanged=\{onChanged\} \/>;/);
  assert.match(tab, /Not issued yet/, 'open with no envelope says so instead of a button that cannot work');
  assert.match(tab, /<ObligationList obligations=\{ndaObligations\}[^>]*rowAction=\{roleNdaAction\}/);
  // No second list.
  assert.doesNotMatch(PAGE, /function NdaCard|Template NDAs/);
  assert.equal((CODE.match(/<OpenToSignButton /g) || []).length, 1, 'one place draws the button');
});

// ---------------------------------------------------------------------------
// 4. Declared once, at module level.
// ---------------------------------------------------------------------------

test('CompanyKybCard is one module-level component, not a render-time one', () => {
  const decls = CODE.match(/^[ \t]*function CompanyKybCard\(\)/gm) || [];
  assert.equal(decls.length, 1, 'exactly one declaration');
  assert.match(decls[0], /^function CompanyKybCard\(\)/, 'at column 0 — outside every other function');
  const page = slice(CODE, 'export default function TrustCenterPage', '\n}\n');
  assert.doesNotMatch(page, /function CompanyKybCard/);
  assert.match(page, /<CompanyKybCard \/>/, 'and the page still draws it');
});

// ---------------------------------------------------------------------------
// Retired (D304): the route, the method, the row in the map.
// ---------------------------------------------------------------------------

test('GET /trust/summary and POST /trust/kyb/start are gone with their client methods', () => {
  assert.doesNotMatch(WORKER, /trust\.get\('\/summary'/);
  assert.doesNotMatch(WORKER, /trust\.post\('\/kyb\/start'/);
  assert.doesNotMatch(API, /getTrustSummary:/);
  assert.doesNotMatch(API, /startKyb:/);
  assert.doesNotMatch(API, /'\/trust\/summary'|'\/trust\/kyb\/start'/);
  assert.doesNotMatch(CODE, /api\.getTrustSummary|api\.startKyb/);
});

test('ROUTE_MAP no longer claims the provenance and history have no store', () => {
  const row = ROUTE_MAP.split('\n').find((l) => l.startsWith('| Trust Center v2 |'));
  assert.ok(row, 'the Trust Center v2 row exists');
  assert.doesNotMatch(row, /\*\*No store:\*\*/);
  assert.match(row, /correcting an earlier "no store" here \(D432\)/);
  assert.match(row, /`GET \/trust\/summary` and `POST \/trust\/kyb\/start` are retired/);
});
