/**
 * A client's document is listed, is not copied, and is not answerable.
 *
 * WHY THIS FILE EXISTS. `research_zones.test.mjs` holds the SHAPE of Library —
 * which tiles each licence draws, which columns the table has. This holds the
 * three claims underneath the `From clients` tile and the seam chips, because
 * each of them is the kind that looks fine on screen while being wrong:
 *
 *   1. The list really does include what clients opened, and only while the
 *      grant is live. A revoked share that keeps appearing is a document the
 *      client believes they took back.
 *   2. Nothing is copied. The moment a share materialises a row in the reader's
 *      library, D37's isolation is a copy-propagation problem rather than a
 *      predicate, and a revoke stops being able to reach the copy.
 *   3. Ask cannot cite it. This is the one a reader will assume the other way
 *      round: it is in my library, so Ask can read it. It cannot — the document
 *      is indexed in the client's namespace and `searchSemantic` only ever
 *      searches the caller's own — and the page has to say so.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_library_shares.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const WORKER = read('cloudflare-worker/src/routes/research.ts');
const LIBRARY = codeOnly(read('frontend/src/pages/research/LibraryZone.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));

/** The `GET /documents` handler, bounded at the next route declaration. */
function listHandler() {
  const start = WORKER.indexOf("research.get('/documents', async (c) => {");
  assert.notEqual(start, -1, 'the documents list handler is gone');
  const after = WORKER.slice(start + 10);
  const next = after.search(/\nresearch\.(get|post|patch|delete)\(/);
  assert.ok(next > 0, 'the list handler is not followed by another route');
  return WORKER.slice(start, start + 10 + next);
}

test('the list reads both sets, and only shares that are still live', () => {
  const h = listHandler();
  assert.equal((h.match(/DB\.prepare\(/g) || []).length, 2,
    'the list no longer reads exactly two sets — the reader’s own and what clients opened');
  assert.match(h, /FROM research_documents WHERE owner_user_id = \?/,
    'the own-documents read lost its owner scope');
  assert.match(h, /FROM advisor_client_document_shares s/,
    'the shared-documents read is gone');

  // A REVOKE IS A STATE, NOT A DELETE — migration 218 says so in as many words
  // — so a listing that ignores it shows a client a document they believe they
  // took back. Both halves of the predicate are pinned: whose shares, and live.
  assert.match(h, /WHERE s\.advisor_user_id = \? AND s\.status = 'active'/,
    'the shared read either crosses accounts or ignores a revoke');
});

test('nothing is copied, and the seam label comes from the grant', () => {
  const h = listHandler();
  // No INSERT anywhere in a read. A share that materialised a row would make
  // D37's isolation a copy-propagation problem instead of a predicate, and a
  // revoke could no longer reach the copy.
  assert.doesNotMatch(h, /INSERT INTO/, 'the list is writing rows while reading');

  // A CORRELATED SUBQUERY, NOT A JOIN, for the label. A reader can hold grants
  // over several projects, and joining returns the same document once per
  // grant — a duplicate row in a list whose whole job is to say what you hold.
  const label = h.slice(h.indexOf('SELECT d.*, ('), h.indexOf('FROM advisor_client_document_shares'));
  assert.match(label, /FROM advisor_client_grants g/, 'the label no longer comes from the grant');
  assert.match(label, /ORDER BY g\.id DESC LIMIT 1/,
    'the label subquery can return more than one row, which would multiply the document');
  assert.match(label, /g\.status = 'active'/, 'a revoked grant can still label a document');
});

test('“in Ask” is computed by the worker, and a shared document is never in it', () => {
  // COMPUTED ONCE, SERVER-SIDE. The page could derive this from `source` and
  // `index_state`, and that second copy of the rule is exactly where the two
  // would disagree — a client's document is `indexed`, in their namespace, and
  // a client-side `index_state === 'indexed'` would call it answerable.
  assert.match(WORKER, /in_ask: source === 'own' && r\.index_state === 'indexed',/,
    'the reach is no longer computed from BOTH the provenance and the index state');
  assert.match(WORKER, /read_only: source === 'client',/,
    'the read-only flag is gone from the payload');
  assert.match(LIBRARY, /d\.in_ask/, 'the page no longer reads the computed reach');
  assert.doesNotMatch(LIBRARY, /d\.index_state === 'indexed'/,
    'the page re-derives answerability from the index state and will call a shared document citable');
});

test('a client’s document draws no control that could not act on it', () => {
  // Remove and Re-index both go through `ownDoc`, which is
  // `WHERE owner_user_id = ?`, so a client's document 404s on each. Drawing
  // either would be the dead control this repo refuses everywhere else — and
  // here it would also read as an offer to delete someone else's file.
  const card = LIBRARY.slice(LIBRARY.indexOf('title="Library"'));
  assert.match(card, /d\.source !== 'client' && \(/,
    'the row controls are no longer gated on provenance');
  const gated = card.slice(card.indexOf("d.source !== 'client' && ("));
  assert.match(gated, /Re-index/, 'Re-index is drawn outside the ownership gate');
  assert.match(gated, /Remove/, 'Remove is drawn outside the ownership gate');
  // Open is NOT gated: reading is the whole reason the document is there.
  const beforeGate = card.slice(0, card.indexOf("d.source !== 'client' && ("));
  assert.match(beforeGate, /Open/, 'Open has been gated too, leaving a listed file unreadable');
});

test('re-index re-queues the same job the upload path uses', () => {
  const start = WORKER.indexOf("research.post('/documents/:uid/reindex'");
  assert.notEqual(start, -1, 'the re-index route is gone');
  const h = WORKER.slice(start, start + 1400);
  assert.match(h, /await ownDoc\(c\.env, user\.id, c\.req\.param\('uid'\)\)/,
    'the re-index route no longer scopes to the caller’s own documents');
  // ONE INDEXER, NOT TWO. A second enqueue shape for the same work is how the
  // re-run and the first run drift into indexing differently, and the second
  // one is the one nobody tests.
  assert.match(h, /Jobs\.enqueue\(c\.env, 'embed_entity', \{ type: 'research_doc', id: doc\.id \}\)/,
    'the re-index enqueues something other than the upload path’s own job');
  assert.match(h, /if \(doc\.index_state === 'pending'\) return c\.json\(\{ detail: 'already_queued' \}, 409\);/,
    'a document already in the queue can be queued again');
  assert.match(API, /reindex: \(uid\) => request\(`\/research\/documents\/\$\{encodeURIComponent\(uid\)\}\/reindex`/,
    'the client method for re-index is gone');
});

test('the ops row’s Re-index acts on what Ask cannot read, and says so when there is nothing', () => {
  // The op is on a page listing the whole library, so it acts on every own
  // document Ask cannot currently see rather than on a selection the page has
  // no way to express. It is disabled with a reason rather than hidden: a
  // control that vanishes leaves a reader wondering whether it ever existed.
  assert.match(LIBRARY, /const stale = items\.filter\(\(d\) => d\.source !== 'client' && d\.index_state !== 'indexed'\);/,
    'the re-index op no longer selects the documents Ask cannot read');
  // Bounded at the block's own close, not at the next `return (` — there is an
  // earlier one in this file and the slice came back empty, which passes a
  // `doesNotMatch` and fails a `match` for a reason that has nothing to do with
  // the code under test.
  const at = LIBRARY.indexOf('const handlers = {');
  assert.notEqual(at, -1, 'the handlers object is gone');
  const handlers = LIBRARY.slice(at, LIBRARY.indexOf('\n  };', at));
  assert.match(handlers, /disabled: busy \|\| stale\.length === 0,/,
    'the op stays live over an empty set');
  assert.match(handlers, /every document you own is already indexed/,
    'a disabled op no longer says why it is disabled');
});
