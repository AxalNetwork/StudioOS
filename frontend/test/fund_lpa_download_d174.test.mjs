/**
 * D174 — the LP drawer told an LP they were not an LP.
 *
 * WHAT WENT WRONG. `GET /funds/:id/lpa` returned the document and never a
 * `content_url`, under a TODO to port the FastAPI contract-minting flow into
 * the worker. `FundsPage.jsx` branched on `content_url`, so the download
 * `<a>` was unreachable for every user and the next branch fired instead:
 *
 *     Content redacted (you are not an LP of this fund).
 *
 * An LP who had just passed the server's own membership check read that. So
 * did every admin. A false claim about ENTITLEMENT, shown to exactly the two
 * audiences who have it.
 *
 * AND IT WAS BROKEN TWICE OVER, which is why the page half of this file
 * exists: the drawer did `setDoc(r.doc)`, so anything beside `doc` in the
 * payload was discarded before the JSX could read it. Fixing only the server
 * would have changed nothing on screen.
 *
 * AND THE PLANNED FIX COULD NOT HAVE FIRED. Minting a signed download token
 * binds an R2 object key; an LPA has none. `legal_documents` has twelve
 * columns in production and `file_key` is not among them — so the mint's own
 * guard would have been false on every row that exists. The body is
 * `content`, inline text, and it is served by `/:id/lpa/download`.
 *
 * WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT. The four reader
 * states are exercised for real in
 * `cloudflare-worker/test/fund_lpa_reader_states_d174.test.ts` — a route's
 * behaviour is not a thing to read off its source. What is left here is
 * structural: a shape that cannot be observed from one response.
 *
 * There is NO "the TODO is gone" assertion, and that is a decision rather
 * than an omission. The original TODO was an indented whole-line `//`
 * comment, exactly what a comment-stripper removes — so a scan of the
 * stripped source cannot fail on it, and a scan of the raw source is
 * satisfied by the notes that have to quote it. Measured: written the first
 * way, the mutation that restores that TODO verbatim ESCAPED. The properties
 * below can all fail on their own defect.
 *
 * Run with:  node --test frontend/test/fund_lpa_download_d174.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutSafeComments } from '../../scripts/check-unused-imports.mjs';

// Resolved from THIS FILE, not cwd: the drift suite runs from the repo root
// and a bare `node --test` runs from frontend/.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (p) => readFileSync(resolve(root, p), 'utf8');

const FUNDS = 'cloudflare-worker/src/routes/funds.ts';
const PAGE = 'frontend/src/pages/FundsPage.jsx';
const API = 'frontend/src/lib/api.js';

/** A named route's body, bounded so a neighbour cannot satisfy an assertion
 *  about this one. */
function handler(sig) {
  const src = at(FUNDS);
  const from = src.indexOf(sig);
  assert.ok(from > 0, `route ${sig} must exist`);
  const next = src.indexOf('\nfunds.', from + sig.length);
  assert.ok(next > from, `could not find the route after ${sig}`);
  return src.slice(from, next);
}

/** The end of the drawer's three-branch chain.
 *
 *  NOT the first `</>` after it: the first branch wraps a button and its
 *  error line in a fragment of its own, so that bound stops inside branch one
 *  and never reaches the `redacted` arm — which is exactly how this file's
 *  entitlement assertion first passed without reading the thing it names.
 *  The outer fragment closes at ten spaces, the inner at fourteen. */
function endOfBranchChain(src, from) {
  const end = src.indexOf('\n          </>', from);
  assert.ok(end > from, 'the drawer\'s outer fragment moved; this bound is stale');
  return end;
}

test('one definition of who may read the LPA, and both routes ask it', () => {
  // The control. Two copies of an entitlement check is how a download route
  // ends up more permissive than the screen that links to it — and the
  // download is the half that hands over the text.
  const src = at(FUNDS);
  const code = withoutSafeComments(src);
  const declared = code.match(/async function mayReadLpa\b/g) || [];
  assert.equal(declared.length, 1, 'the entitlement predicate is declared more than once');

  for (const sig of ["funds.get('/:id/lpa',", "funds.get('/:id/lpa/download',"]) {
    const body = withoutSafeComments(handler(sig));
    assert.match(body, /mayReadLpa\(c\.env, user, id\)/, `${sig} does not ask the shared predicate`);
    // A second, inline membership query is the drift this exists to stop —
    // it would typecheck, pass every happy path, and diverge on the first
    // edit to either copy.
    assert.doesNotMatch(body, /FROM limited_partners/,
      `${sig} carries its own membership query beside the shared one`);
  }
});

test('the entitled reader is offered the body, and nothing mints a link to R2', () => {
  const body = handler("funds.get('/:id/lpa',");
  const code = withoutSafeComments(body);
  assert.match(code, /content_available: hasBody/,
    'the entitled path no longer reports whether a body exists');
  // The mint that could never fire. Its guard would have been `!file_key`,
  // and `legal_documents` has no such column in production or in any DDL.
  assert.doesNotMatch(code, /mintDownloadToken\(/, 'a signed-download mint is back on this route');
  assert.doesNotMatch(code, /file_key/,
    'the handler references file_key — a column legal_documents does not have');
  // `content` is destructured off before any branch, so no path below can
  // put it back on the response.
  assert.match(code, /const \{ content, \.\.\.rest \} = doc;/,
    'the inline body is no longer stripped for everyone before the branches');
});

test('the non-LP branch withholds a column that exists, and says it redacted', () => {
  const code = withoutSafeComments(handler("funds.get('/:id/lpa',"));
  assert.match(code, /const \{ file_url, \.\.\.meta \} = safeDoc;/,
    'the non-LP branch stopped withholding file_url — the one column here that points at a body');
  assert.match(code, /redacted: true/, 'the non-LP branch stopped flagging itself as redacted');
});

test('the download answers its two refusals differently, and cannot be tricked by a filename', () => {
  const code = withoutSafeComments(handler("funds.get('/:id/lpa/download',"));
  assert.match(code, /code: 'lpa_not_entitled'/, 'the refusal for a non-LP lost its name');
  assert.match(code, /code: 'lpa_no_body'/, 'the refusal for an empty record lost its name');
  assert.match(code, /'Content-Disposition': `attachment; filename="\$\{filename\}"`/,
    'the body is no longer served as an attachment');
  // The filename is interpolated into a response header, so it must be built
  // from integers and never from anything the database stores.
  assert.match(code, /const filename = `lpa-fund-\$\{id\}-v\$\{Number\(row\?\.version\) \|\| 1\}\.txt`;/,
    'the filename is no longer built from two integers — stored text in a header can rewrite it');
});

test('the download is fetched with the session, not linked to', () => {
  // `downloadDataRoom`'s shape, and its own comment gives the reason: a plain
  // `<a>` click cannot set the Authorization header. A link here would 401
  // for every bearer-only session.
  const src = at(API);
  const from = src.indexOf('downloadFundLpa:');
  assert.ok(from > 0, 'the download method is gone');
  const method = src.slice(from, src.indexOf('\n  },', from));
  assert.match(method, /Authorization: `Bearer \$\{token\}`/, 'the download no longer carries the session');
  assert.match(method, /\/funds\/\$\{id\}\/lpa\/download/, 'the download points somewhere else');
  assert.match(method, /createObjectURL/, 'the response is no longer clicked client-side');
  // The server distinguishes 403 from 404 and the drawer says which, so the
  // reason must survive the transport. Since D258 it survives through the one
  // definition every raw-fetch helper shares — `refusalError`, which carries
  // the sentence, the code and the status. This used to match the two-field
  // chain the helper built by hand; the behaviour is now driven end to end in
  // api_refusal_d258.test.mjs ("the LPA download keeps the server's two
  // refusals apart").
  assert.match(method, /if \(!res\.ok\) throw await refusalError\(res, 'Download failed'\);/,
    'the server\'s own reason is thrown away — the refusal no longer goes through refusalError');
});

test('the page keeps the envelope instead of throwing it away', () => {
  // The second defect, and on its own enough to keep the button dead.
  // `content_available` is a sibling of `doc`, so `setDoc(r.doc)` dropped it.
  // Code only: the drawer's own note quotes `setDoc(r.doc)` to say what it
  // replaced, and a raw scan would be satisfied by the explanation.
  const src = at(PAGE);
  assert.doesNotMatch(withoutSafeComments(src), /setDoc\(r\.doc\)/,
    'the drawer discards the response envelope again — content_available never reaches the JSX');
  assert.match(src, /setRes\(r\)/, 'the drawer no longer keeps what the server sent');
  assert.match(src, /const doc = res\?\.doc;/, 'the document is no longer derived from the kept response');
});

test('the entitlement sentence is reachable only when the server says so', () => {
  // The whole defect in one assertion: "you are not an LP" must sit behind
  // `redacted`, which only the server's own non-LP branch sets.
  const src = at(PAGE);
  const from = src.indexOf('{res.content_available ? (');
  assert.ok(from > 0, 'the download branch moved or was renamed');
  const block = src.slice(from, endOfBranchChain(src, from));

  const claimAt = block.indexOf('you are not an LP of this fund');
  assert.ok(claimAt > 0, 'the redacted sentence is gone — a non-LP must still be told why');
  const gateAt = block.indexOf('res.redacted');
  assert.ok(gateAt > 0, 'the entitlement claim is no longer gated on the server\'s redacted flag');
  assert.ok(gateAt < claimAt,
    'the "you are not an LP" sentence sits outside the redacted gate — it can be shown to an LP again');

  // A record with no stored body is a third state, so it cannot borrow the
  // entitlement claim.
  assert.match(block, /No LPA body is stored against this record/, 'the no-body state has no copy of its own');
});

test('a download that failed says so', () => {
  // Clearing the spinner is teardown, not an outcome. Three actions shipped
  // that way before D116 and each looked like a success.
  const src = at(PAGE);
  const from = src.indexOf('{res.content_available ? (');
  const block = src.slice(from, endOfBranchChain(src, from));
  assert.match(block, /\{dlErr && /, 'a failed download renders nothing — it looks like a success');
  assert.match(block, /disabled=\{busy\}/, 'the button does not disable while the fetch is in flight');
  const code = withoutSafeComments(src);
  assert.match(code, /setDlErr\(e\?\.message/, 'the failure reason is dropped rather than shown');
});

test('the drawer comment describes what actually ships', () => {
  // It claimed "Backend returns a short-lived signed URL (~5 min)" while the
  // backend returned no URL at all — the stale-claim class this repo keeps
  // correcting. It must not now describe a mint either.
  const src = at(PAGE);
  const from = src.indexOf('Security #8');
  assert.ok(from > 0, 'the Security #8 note is gone');
  const note = src.slice(from, from + 900);
  assert.match(note, /never embedded in this JSON/, 'the note stopped saying the body is not inlined');
  assert.match(note, /re-checks\s+LP\s*\n?\s*(\/\/)?\s*membership/,
    'the note no longer says the download re-checks membership on its own hit');
  assert.doesNotMatch(note, /signed URL|mints/, 'the note describes a mint this route does not do');
});
