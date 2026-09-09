/**
 * Network · Relationships — the `pn1` artboard, held against the canvas that
 * specifies it and against the store that was built for it.
 *
 * WHAT THIS ZONE WAS. `RelationshipsPage` read `partner_relationships`: a
 * partner-to-partner edge with `partner_a_id`, `partner_b_id`, a
 * `relationship_type` from a fixed five and `strength_score REAL DEFAULT 50`.
 * It drew a card grid, a violet gradient hero, a 0–100 slider a person dragged,
 * and a modal asking for a raw "Partner User ID (e.g. 42)". The artboard is a
 * firm's BOOK of the people it knows at client companies — `Contact ·
 * Organization · Firm owner · Last interaction · Strength`. Different objects.
 *
 * WHY THE SLIDER IS THE POINT. The artboard's fourth tile is `Firm-wide warmth
 * score · Not recorded · no such score exists — strength is per-row and shows
 * its derivation`, and its instNote says "strength is never a warmth number
 * presented as fact". A hand-dragged number defaulting to 50 and rendered as
 * "62/100" is exactly that, so the tests below check that strength is DERIVED
 * from what is logged and that both numbers it came from reach the row.
 *
 * THE CANVAS IS THE FIXTURE. Labels, notes, columns and windows are parsed out
 * of `design/incoming/Pages · Partner Network.dc.html` rather than retyped, so
 * a canvas revision moves this guard rather than silently disagreeing with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Pages · Partner Network.dc.html');
const pageRaw = raw('frontend/src/pages/RelationshipsPage.jsx');
const page = read('frontend/src/pages/RelationshipsPage.jsx');
const worker = raw('cloudflare-worker/src/routes/partnernet.ts');
const migration = raw('cloudflare-worker/sql/migrations/224_partner_book.sql');

/** The `pn1` entry of the canvas's `PAGES` array, as text. */
const PN1 = CANVAS.slice(CANVAS.indexOf("{ id:'pn1'"), CANVAS.indexOf("{ id:'pn2'"));
assert.ok(PN1.length > 500, 'the pn1 artboard could not be found in the canvas');

test('the four tiles are the artboard’s, label and note', () => {
  // Parsed out of `adds:[…]`, which is where the canvas declares the strip. The
  // notes matter as much as the labels: `read-only to the firm` is the whole of
  // what `Platform-sourced` means, and a tile carrying the label without it is
  // a number with no reading.
  const adds = PN1.slice(PN1.indexOf('adds:['), PN1.indexOf('instTitle:'));
  const labels = [...adds.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  const notes = [...adds.matchAll(/note:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels,
    ['Contacts', 'Unassigned', 'Platform-sourced', 'Firm-wide warmth score'],
    'the canvas strip has changed shape; re-read it before moving this guard');

  // SCOPED TO THE STRIP, NOT THE PAGE. `read-only to the firm` is also the
  // legend's words for the cyan mark — deliberately, they are the same fact
  // said in two places — so a page-wide `includes` for the tile's note passes
  // on the legend's copy and reports a tile that is no longer there. This is
  // that mutation, caught.
  const strip = page.slice(page.indexOf('<Tile label="Contacts"'), page.indexOf('<SourceLegend'));
  assert.ok(strip.length > 100 && strip.includes('Firm-wide warmth score'), 'the strip could not be located');
  for (const label of labels) {
    assert.ok(strip.includes(`label="${label}"`), `the strip has lost the ${label} tile`);
  }
  // `Contacts`' note is built from a live count on both sides, so only its
  // fixed halves are comparable; the other three are literals end to end.
  assert.ok(strip.includes('across ') && strip.includes(' organization'),
    'the Contacts tile no longer says how many organizations it spans');
  for (const note of notes.slice(1)) {
    assert.ok(strip.includes(note), `a tile note left the artboard: "${note}"`);
  }
});

test('the warmth-score tile is drawn, and drawn as Not recorded', () => {
  // D68 IS WHY THIS TILE EXISTS WHERE D56 WOULD HAVE DROPPED IT. D56 refuses a
  // tile whose absence is the PRODUCT's gap — design commentary on a customer's
  // screen. This absence is the opposite claim and the page's own finding: the
  // firm has no such score because no such score is a thing that can be had
  // honestly, which is the sentence the artboard wants a reader to leave with.
  const strip = page.slice(page.indexOf('<Tile label="Contacts"'), page.indexOf('</div>', page.indexOf('Firm-wide warmth score')));
  assert.match(strip, /label="Firm-wide warmth score"\s*\n\s*nr\b/,
    'the warmth-score tile is drawing a number');
  assert.ok(!/warmth[^\n]*value=/.test(strip), 'the warmth-score tile has been given a value');
});

test('the instrument draws the artboard’s columns, in its order and at its widths', () => {
  const head = JSON.parse(PN1.match(/head:\[([^\]]+)\]/)[1].replace(/'/g, '"').replace(/^/, '[').replace(/$/, ']'));
  const cols = PN1.match(/cols:'([^']+)'/)[1];
  assert.deepEqual(head, ['Contact', 'Organization', 'Firm owner', 'Last interaction', 'Strength']);
  assert.ok(page.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s five columns in its order');
  assert.ok(page.includes(`cols="${cols}"`), 'the instrument no longer uses the artboard’s column widths');
  assert.ok(page.includes(PN1.match(/instMeta:'([^']+)'/)[1]),
    'the instrument’s meta line has left the artboard');
});

test('strength is derived from what is logged, at the artboard’s own thresholds', () => {
  // The canvas's `strength(c)`: Strong at 20 interactions within 30 days,
  // Working at 8 within 60, Thin otherwise. Read out of the canvas so the two
  // cannot part company.
  const fn = CANVAS.slice(CANVAS.indexOf('const strength = (c) => {'), CANVAS.indexOf('const bookRows'));
  assert.match(fn, /c\.n >= 20 && c\.days <= 30/, 'the canvas’s Strong threshold has moved');
  assert.match(fn, /c\.n >= 8 && c\.days <= 60/, 'the canvas’s Working threshold has moved');

  const derived = page.slice(page.indexOf('export function strengthOf('), page.indexOf('/** The four chips'));
  assert.match(derived, /if \(count >= 20 && days <= 30\) return 'Strong';/,
    'the Strong threshold is no longer the artboard’s');
  assert.match(derived, /if \(count >= 8 && days <= COLD_AT\) return 'Working';/,
    'the Working threshold is no longer the artboard’s');
  assert.match(derived, /return 'Thin';/, 'the Thin fallback is gone');

  // AND THE ROW SHOWS ITS WORKING. A label with no derivation under it is the
  // slider again with a word instead of a number.
  assert.match(page, /recorded interaction\$\{[^}]*\} · last \$\{r\.days\} d ago/,
    'a strength label no longer states the count and recency it came from');
});

test('nothing on this page stores or reads a warmth number', () => {
  // `strength_score REAL DEFAULT 50` is still a column on `partner_relationships`
  // — that table keeps its own page-less life — but nothing here may read it,
  // and migration 224 may not grow one of its own.
  assert.ok(!page.includes('strength_score'), 'the page is reading a stored strength score');
  assert.ok(!/strength/i.test(migration.split('CREATE TABLE')[1] || ''),
    'the book table has grown a strength column');
  // The calls the old page was built on, and the modal that asked for a raw
  // account id. `partnerSummary` went with them: it counts edges in the partner
  // graph, which is not what this book is.
  //
  // BANNED IN THE CODE, REQUIRED IN THE DOCBLOCK. `codeOnly` strips the
  // top-of-file comment, which is where the page records what it replaced —
  // "asking for a raw Partner User ID (e.g. 42)". Reading the raw source for a
  // ban would fail on the explanation, which is the one copy of those words
  // that should survive.
  for (const gone of ['api.partnerRelationships', 'api.createRelationship',
    'api.updateRelationship', 'api.partnerSummary', 'Partner User ID']) {
    assert.ok(!page.includes(gone), `the page still reaches for ${gone}`);
  }
  assert.ok(pageRaw.includes('Partner User ID'),
    'the docblock no longer records the modal this page replaced');
  assert.ok(pageRaw.length > page.length, 'codeOnly stripped nothing, so the bans above prove nothing');
});

test('an undated contact is not called cold, and is not called thin either', () => {
  // TWO TOUCHES AND NO DATES IS NOT ENOUGH TO CALL ANYTHING — the artboard's
  // Yusuf Demir row. `Going cold` is a claim about elapsed time and there is
  // none to measure, so the row is excluded from the chip rather than swept in
  // as maximally cold; and `strengthOf` returns null rather than falling
  // through to `Thin`, which would be a verdict built on the half that is
  // present and the half that is missing.
  assert.match(page, /if \(days === null\) return null;/,
    'a contact with no dated interaction is being given a strength');
  assert.match(page, /cold: \(r\) => r\.days !== null && r\.days > COLD_AT,/,
    'the Going cold chip no longer requires a date to call something cold');
  assert.match(page, /export const COLD_AT = 60;/, 'the cold window has left the artboard');
  // Sixty is the artboard's number and ninety is `MarketZone`'s, about a
  // different object. One transcribed onto the other is how two windows become
  // one, so the canvas is asked for its own.
  assert.match(CANVAS, /c\.days !== null && c\.days > 60/, 'the canvas’s cold window has moved');
});

test('the tiles count the whole book, never the rows a chip left showing', () => {
  const tiles = page.slice(page.indexOf('const orphans = rows.filter('), page.indexOf('const setOwner ='));
  assert.ok(tiles.length > 0, 'the tile counts are gone');
  assert.ok(!/\bvisible\b/.test(tiles), 'a tile count is reading the chip-narrowed list');
  assert.match(tiles, /const orphans = rows\.filter\(\(r\) => !r\.firm_owner\);/,
    'the Unassigned tile no longer counts the contacts nobody owns');
  assert.match(tiles, /const platform = rows\.filter\(\(r\) => r\.source === 'platform'\);/,
    'the Platform-sourced tile no longer counts what arrived through the product');
});

test('unassigned sorts first, then coldest, and an undated row sorts as coldest', () => {
  // The artboard's own comparator, and the reason the page is a table rather
  // than an alphabetical grid: "the failure mode this page exists to surface is
  // an owned relationship with no owner".
  assert.match(page, /\(a\.firm_owner \? 1 : 0\) - \(b\.firm_owner \? 1 : 0\)/,
    'the book no longer sorts unassigned rows to the top');
  assert.match(page, /\(b\.days \?\? Number\.MAX_SAFE_INTEGER\) - \(a\.days \?\? Number\.MAX_SAFE_INTEGER\)/,
    'an undated contact no longer sorts as maximally cold');
  assert.match(CANVAS, /\(a\.owner \? 1 : 0\) - \(b\.owner \? 1 : 0\) \|\| \(b\.days \|\| 999\) - \(a\.days \|\| 999\)/,
    'the canvas’s ordering has changed; re-read it before moving this guard');
});

test('a contact arrives unowned, because a default would hide every orphan', () => {
  const insert = worker.slice(worker.indexOf("partnernet.post('/book'"), worker.indexOf("partnernet.get('/book/owners'"));
  assert.ok(insert.includes('INSERT INTO partner_book_contacts'), 'the add-a-contact route is gone');
  assert.ok(!insert.includes('firm_owner_user_id'),
    'the insert is setting a firm owner, so a new contact would never read as unassigned');
  // And the column allows it — a NOT NULL here would make the artboard's
  // central case unrepresentable.
  assert.match(migration, /firm_owner_user_id\s+INTEGER REFERENCES users\(id\) ON DELETE SET NULL,/,
    'the firm owner column is no longer nullable');
});

test('an interaction is dated when it happened, never when it was typed', () => {
  // A call last month recorded today is a month-old touch. `created_at` would
  // call it fresh, and `Going cold` would then report on data entry rather than
  // on the relationship.
  assert.match(migration, /happened_at\s+TEXT NOT NULL,/, 'the interaction date is no longer required');
  const route = worker.slice(worker.indexOf("partnernet.post('/book/:uid/interactions'"));
  assert.match(route, /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(happenedAt\)/,
    'the interaction route no longer requires a date it can read');
  assert.match(page, /When the interaction happened/,
    'the log form no longer says which date it is asking for');
  // The read derives recency from `happened_at`, so a row edited today does not
  // become a fresh touch.
  assert.match(worker, /MAX\(i\.happened_at\) FROM partner_book_interactions/,
    'last-interaction is no longer read off the date the touch happened');
});

test('the book is the caller’s, and an owner must be someone at their firm', () => {
  const book = worker.slice(worker.indexOf('// The firm relationship book (migration 224)'),
    worker.indexOf("partnernet.get('/summary'"));
  assert.ok(book.length > 500, 'the book routes could not be located');
  // Every statement in this block that touches a book table carries the owner
  // predicate. A read that did not would be one firm reading another's.
  for (const stmt of book.split('c.env.DB.prepare(').slice(1)) {
    const sql = stmt.slice(0, stmt.indexOf('`', stmt.indexOf('`') + 1));
    if (!/partner_book_/.test(sql)) continue;
    assert.match(sql, /owner_user_id = \?|INSERT INTO partner_book_/,
      `a book statement is not scoped to its owner: ${sql.slice(0, 120)}`);
  }
  // AND THE OWNER WRITE IS VALIDATED AGAINST THE SAME LIST THE PICKER READS.
  // Without this `firm_owner_id` is any integer, so a partner could stamp an
  // unrelated account's NAME onto their row and the page would render it as the
  // person responsible — a fact about a real user invented by a stranger.
  const patch = worker.slice(worker.indexOf("partnernet.patch('/book/:uid/owner'"));
  assert.match(patch, /const candidates = await firmOwnerCandidates\(c\.env, user\.id\);/,
    'the owner write no longer checks who may own a row');
  assert.match(patch, /return c\.json\(\{ error: 'not_a_firm_member' \}, 403\);/,
    'the owner write no longer refuses an id outside the caller’s firm');
  assert.match(worker, /partnernet\.get\('\/book\/owners'/, 'the roster the picker reads is gone');
});

test('clearing an owner is allowed, because that is how a row becomes an orphan', () => {
  // An owner who leaves the firm is the case that produces orphans in the first
  // place. Refusing `null` would make the page's own finding unreachable once
  // anyone had ever claimed a row.
  const patch = worker.slice(worker.indexOf("partnernet.patch('/book/:uid/owner'"));
  assert.match(patch, /let ownerId: number \| null = null;/, 'the owner write no longer accepts a clear');
  assert.match(page, /— Unassigned —/, 'the assign board offers no way to release a contact');
});

/**
 * THE ONE THAT IS NOT ABOUT THIS ZONE.
 *
 * `kind: 'handler'` means the PAGE performs the op, so the page's functions
 * have to reach the builder. `makeZoneActions` drops an entry whose handler is
 * missing — deliberately, because the alternative is a dead button — which
 * makes a binder that forgets to pass `handlers` completely silent: the op is
 * declared, the guard that counts declarations passes, and the control is
 * simply not on the page. Two shipped that way (`research/library`'s `Add
 * document` and `Re-index`, `research/client-prep`'s `Attach to proposal`) and
 * nothing failed. This is the assertion that would have failed.
 */
test('every page-supplied op reaches a binder that actually passes handlers', () => {
  const TABLES = ['founder', 'investor', 'partner', 'advisor']
    .map((r) => `frontend/src/workspaces/${r}ZoneActions.js`);
  const zones = new Set();
  for (const file of TABLES) {
    const src = codeOnly(raw(file));
    for (const m of src.matchAll(/'([a-z-]+\/[a-z-]+)':\s*\[([\s\S]*?)\n {2}\],/g)) {
      if (/kind: 'handler'/.test(m[2])) zones.add(m[1]);
    }
  }
  assert.ok(zones.size >= 8, `expected the handler kind to be in use; found ${zones.size} zones`);

  // Every module that binds a zone action table, read as code so a call in a
  // comment cannot satisfy the rule.
  const BINDERS = [
    'frontend/src/workspaces/ResearchWorkspace.jsx',
    'frontend/src/workspaces/NetworkWorkspace.jsx',
    'frontend/src/workspaces/founder/FounderValidateWorkspace.jsx',
  ].map((p) => codeOnly(raw(p))).join('\n');

  /** The options object of a call, brace-balanced from the first `{` after the key. */
  const optsAfter = (src, at) => {
    const open = src.indexOf('{', at);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
    }
    return '';
  };

  for (const zone of [...zones].sort()) {
    const key = `'${zone}'`;
    let found = false;
    let threaded = false;
    let at = -1;
    while ((at = BINDERS.indexOf(key, at + 1)) !== -1) {
      // Only a call that goes on to build the row — `zoneActionsFor(role, key,
      // {…})` or `<licence>ZoneActions(key, {…})`. A `zoneFiltersFor` call
      // names the same key and is not this.
      const before = BINDERS.slice(Math.max(0, at - 60), at);
      // `zoneActionsFor(role, key, …)` and `founderZoneActions(key, …)` — the
      // leading character differs because one is the shared dispatcher and the
      // other a table bound directly, so the class is spelled out rather than
      // assumed.
      if (!/[Zz]oneActions(?:For)?\(\s*(?:role,\s*)?$/.test(before)) continue;
      found = true;
      if (/(^|[{,\s])handlers\s*[,:}]/.test(optsAfter(BINDERS, at + key.length))) threaded = true;
    }
    assert.ok(found, `${zone} declares a page-supplied op but no workspace binds its action row`);
    assert.ok(threaded,
      `${zone} declares a page-supplied op, and every binder for it drops handlers — `
      + 'the op is declared and renders nowhere');
  }
});
