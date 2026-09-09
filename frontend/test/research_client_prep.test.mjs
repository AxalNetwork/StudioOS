/**
 * A client brief has two sides now, and only one of them is the firm's to settle.
 *
 * WHY THIS FILE EXISTS. Every row this zone produced used to be the founder's,
 * so its artboard's `Ours only` chip matched nothing and `Founder-sourced`
 * matched everything — a filter that selects all or none is prose, not a chip
 * (D51/D53), and the page shipped one of them live for a while, answering
 * "nothing matches this filter" over a full brief. Migration 222 is the second
 * source. What has to stay true once there are two:
 *
 *   1. A note is scoped by a LIVE grant, not by the reader alone. A firm that
 *      never held one has no business keeping a file on that founder in this
 *      product, and a revoke is the founder taking that back.
 *   2. `open` is a flag on the firm's own rows only. Ticking off a fact the
 *      CLIENT recorded is editing someone else's record, and the artboard's
 *      legend describes exactly that asymmetry from the other end.
 *   3. Nothing is inferred. The zone's oldest rule, and the one a second
 *      writable source makes easiest to break.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_client_prep.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const WORKER = read('cloudflare-worker/src/routes/research.ts');
const MIGRATION = read('cloudflare-worker/sql/migrations/222_research_brief_notes.sql');
const PAGE = codeOnly(read('frontend/src/pages/research/ClientPrepZone.jsx'));
const PARTNER_FILTERS = codeOnly(read('frontend/src/workspaces/partnerZoneFilters.js'));
const ADVISOR_FILTERS = codeOnly(read('frontend/src/workspaces/advisorZoneFilters.js'));

test('a note can only be written against a client who has a live grant open', () => {
  // NOT FOUND RATHER THAN FORBIDDEN, deliberately: whether a given founder
  // exists is not something a firm without a grant may learn by probing.
  assert.match(WORKER, /async function grantedProjectId\(/, 'the grant check is gone');
  const fn = WORKER.slice(WORKER.indexOf('async function grantedProjectId('), WORKER.indexOf("research.get('/brief-notes'"));
  assert.match(fn, /g\.advisor_user_id = \? AND g\.status = 'active'/,
    'a revoked grant can still be written against, or the check crosses accounts');

  // BOTH THE READ AND THE WRITE GO THROUGH IT. A write-only check would let a
  // firm keep reading notes about a client who revoked.
  for (const route of ["research.get('/brief-notes'", "research.post('/brief-notes'"]) {
    const at = WORKER.indexOf(route);
    assert.notEqual(at, -1, `${route} is gone`);
    const handler = WORKER.slice(at, at + 1200);
    assert.match(handler, /await grantedProjectId\(c, user\.id, projectUid\)/,
      `${route} no longer checks the grant`);
    assert.match(handler, /if \(!projectId\) return c\.json\(\{ detail: 'not_found' \}, 404\);/,
      `${route} reports something other than not-found to a caller with no grant`);
  }
});

test('every note read and write is the caller’s own', () => {
  for (const q of [
    'FROM research_brief_notes WHERE owner_user_id = ? AND project_id = ?',
    'UPDATE research_brief_notes SET open = ?, updated_at =',
    'DELETE FROM research_brief_notes WHERE uid = ? AND owner_user_id = ?',
  ]) {
    assert.ok(WORKER.includes(q), `a brief-note statement lost its owner scope: ${q}`);
  }
  const patch = WORKER.slice(WORKER.indexOf("research.patch('/brief-notes/:uid'"), WORKER.indexOf("research.delete('/brief-notes/:uid'"));
  assert.match(patch, /WHERE uid = \? AND owner_user_id = \?/,
    'the settle toggle can be aimed at another firm’s note');
});

test('open is a flag on the firm’s own rows and on nothing else', () => {
  // THE SCHEMA SAYS SO FIRST. `open` lives on `research_brief_notes` and there
  // is no counterpart on anything the founder wrote, because there could not be:
  // those rows are assembled from the grant, not stored.
  assert.match(MIGRATION, /open\s+INTEGER NOT NULL DEFAULT 1/,
    'the open flag is gone, or has become nullable — "never said" and "settled" would blur');
  assert.doesNotMatch(MIGRATION, /source\s+TEXT/,
    'a source column is back; the source is which table the row came from, not a field');

  // AND THE PAGE AGREES. `Open items` is `Ours only` narrowed, not a third
  // axis — a founder-sourced row can never be open, so a predicate that only
  // tested `r.open` would let one through the moment the payload grew a field
  // of that name.
  assert.match(PAGE, /open: \(r\) => r\.source === 'ours' && r\.open,/,
    'the Open items chip no longer restricts itself to the firm’s own rows');
  const card = PAGE.slice(PAGE.indexOf('testid="client-brief"'));
  assert.match(card, /node: r\.source === 'ours' \? \(/,
    'the settle control is drawn on rows the reader does not own');
});

test('the four chips are four predicates over two sources', () => {
  for (const [name, src, ours, open] of [
    ['partner', PARTNER_FILTERS, 'Ours only', 'Open items'],
    ['advisor', ADVISOR_FILTERS, 'Mine only', 'Open questions'],
  ]) {
    const at = src.indexOf("'research/client-prep': [");
    assert.notEqual(at, -1, `${name} has no client-prep filter row`);
    const row = src.slice(at, src.indexOf('\n  ],', at));
    assert.match(row, /\{ canvas: 'Full brief', key: 'all' \}/, `${name}: Full brief is not live`);
    assert.match(row, new RegExp(`\\{ canvas: '${ours}', key: 'ours' \\}`), `${name}: ${ours} is not live`);
    assert.match(row, /\{ canvas: 'Founder-sourced', key: 'client' \}/, `${name}: Founder-sourced is not live`);
    assert.match(row, new RegExp(`\\{ canvas: '${open}', key: 'open' \\}`), `${name}: ${open} is not live`);
    assert.doesNotMatch(row, /unbuilt:/, `${name}: a client-prep chip has gone back to prose`);
  }
  // The constant that explained the prose is gone from both files with it. A
  // reason kept past the gap it describes reads as current.
  for (const [name, src] of [['partner', PARTNER_FILTERS], ['advisor', ADVISOR_FILTERS]]) {
    assert.doesNotMatch(src, /const ONE_SOURCE_ONLY =/,
      `${name} still declares the constant that denied a second source`);
  }
});

test('the two sources are marked apart on every row, and the page says which is which', () => {
  const card = PAGE.slice(PAGE.indexOf('testid="client-brief"'));
  assert.match(card, /seam: r\.source === 'client' \? 'Founder-sourced' : null,/,
    'a founder-sourced row no longer carries the seam mark');
  assert.match(card, /ours: r\.source === 'ours' \? 'Ours' : null,/,
    'a firm-written row no longer carries the ours mark');
  // The legend is what makes the two colours mean anything, and it is drawn
  // only where the table can carry both — which it always can here, since the
  // form that writes the second source is on this page.
  assert.match(PAGE, /<SourceLegend/, 'the legend that names the two sources is gone');
  assert.match(PAGE, /read-only — came from the client’s own record/,
    'the legend no longer says what founder-sourced means');
});

test('the brief still refuses to infer, and says so in the reader’s own terms', () => {
  // The zone's oldest rule, and the one a second writable source makes easiest
  // to break: a firm's note about a client is not the client's statement, and
  // a table that renders them alike is how an assumption gets quoted back.
  assert.match(PAGE, /never derives a figure\s+they did not state/,
    'the stated limit no longer refuses to infer');
  assert.match(PAGE, /label="Their budget" nr/,
    'the budget tile prints a figure instead of saying it was never shared');
  // And the tile's note has to say WHOSE absence it is — D68's whole point.
  assert.match(PAGE, /not in anything they have shared/,
    'the budget tile no longer says the absence is the client’s, not the product’s');
});

test('attaching a brief to a proposal is the caller’s own proposal', () => {
  const post = WORKER.slice(WORKER.indexOf("research.post('/attachments'"), WORKER.indexOf("research.delete('/attachments/:uid'"));
  assert.ok(post.length > 0, 'the attach route is gone');
  // ATTACHING TO SOMEONE ELSE'S QUOTE would put the firm's reasoning behind a
  // number they did not quote, and tell them a figure exists they cannot see.
  assert.match(post, /FROM quotes WHERE id = \? AND provider_user_id = \?/,
    'a brief or reading can be attached to a proposal the caller does not own');
  assert.match(post, /INSERT OR IGNORE INTO research_attachments/,
    'attaching the same thing twice now fails, which reads as the first attach having failed');
  assert.match(MIGRATION, /UNIQUE \(owner_user_id, kind, ref_key, quote_id\)/,
    'the same attachment can be recorded twice');
});
