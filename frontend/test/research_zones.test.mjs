/**
 * Library and Ask — the two zones this pass built, and the honesty rules they
 * carry that no framework enforces.
 *
 * These are on ALL FOUR licences (`RESEARCH_ZONES` lists `ask` and `library`
 * for founder, investor, advisor and partner), which is why they were worth
 * building first: 8 of the 16 unbacked zone slots in the whole product.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { allZoneRoutes } from '../src/workspaces/shellConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const library = read('frontend/src/pages/research/LibraryZone.jsx');
const ask = read('frontend/src/pages/research/AskZone.jsx');
const workspace = read('frontend/src/workspaces/ResearchWorkspace.jsx');
const api = codeOnly(read('frontend/src/lib/api.js'));

test('every licence that lists these zones can open them', () => {
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    const zones = allZoneRoutes(role).filter((r) => r.startsWith('/research/'));
    assert.ok(zones.includes('/research/library'), `${role} has no /research/library`);
    assert.ok(zones.includes('/research/ask'), `${role} has no /research/ask`);
  }
});

test('both zones use the shared four-state body and catch their own failure', () => {
  for (const [name, src] of [['LibraryZone', library], ['AskZone', ask]]) {
    const code = codeOnly(src);
    assert.match(code, /<ZoneBody/, `${name} must use the shared four-state body`);
    assert.match(code, /loading=\{/, `${name}'s ZoneBody must state loading explicitly`);
    assert.match(code, /catch \(e\)|catch \(err\)/, `${name} must catch its own read failure`);
    assert.match(code, /onRetry=\{/, `${name} must offer a retry`);
  }
});

test('the library never renders "indexed into nothing" as a fact', () => {
  const code = codeOnly(library);
  // chunk_count is NULL until a document is actually read. Rendering that as
  // 0 would say Ask looked and found no passages, which is a different claim
  // from "Ask has not read this yet" — and only one of them is true.
  assert.match(code, /chunk_count == null/,
    'the library must distinguish a never-indexed document from an empty one');
  // The BRANCH, not the sentence in it. This used to pin the exact words "No
  // passages indexed", which held the wording still rather than the behaviour:
  // moving the count into a column headed `Passages` made that phrasing say
  // "passages" twice, and a test should not be the reason a page reads worse.
  // What must not change is that the null case goes through `Unrecorded`.
  assert.match(code, /chunk_count == null\s*\?\s*<Unrecorded>/,
    'a never-indexed document must read as unrecorded, not as zero passages');
  assert.doesNotMatch(code, /chunk_count \|\| 0/,
    'coercing chunk_count to 0 turns "not read yet" into "read, found nothing"');
});

test('an upload says it was added, not that it was indexed', () => {
  // Indexing runs on a queue and has not happened when the POST returns.
  // "Uploaded and indexed" would be a claim about a state that does not exist
  // yet, and the state column would contradict it one line below.
  const code = codeOnly(library);
  assert.match(code, /Added\./, 'the upload confirmation must not claim more than happened');
  assert.doesNotMatch(code, /Indexed\.|Ready to ask/,
    'the confirmation claims indexing that has not run yet');
});

test('Ask treats no_source as an answer, and separates it from a broken model', () => {
  const code = codeOnly(ask);
  // THE WHOLE POINT OF THE ZONE. Three outcomes, rendered differently,
  // because the reader's next action differs for each.
  assert.match(code, /result\?\.reason === 'answered'/);
  assert.match(code, /result\?\.reason === 'no_source'/);
  assert.match(code, /result\?\.reason === 'model_unavailable'/,
    'a model failure must not be reported as an empty library — it would send the reader to upload something that would not help');
  // And it must say plainly that it will not fall back to general knowledge.
  assert.match(ask, /will not answer from general knowledge/);
});

/** The JSX a `reason === '<name>'` branch renders, bounded at both ends. */
function branch(code, reason) {
  const start = code.indexOf(`result?.reason === '${reason}'`);
  assert.notEqual(start, -1, `the ${reason} branch is gone`);
  const end = code.indexOf('\n        )}', start);
  assert.ok(end > start, `the ${reason} branch is not a closed JSX block`);
  return code.slice(start, end);
}

test('Ask shows what the closest passage scored rather than only refusing', () => {
  // A bare "no source" leaves a reader unable to tell whether to rephrase the
  // question or add a document. The number is the fact; whether it is close
  // enough is the floor's job, and both are shown.
  //
  // SCOPED TO THE BRANCH THAT RENDERS IT, because a whole-file match passes on
  // dead code: wrapping the score in `{false && …}` left the identifier in the
  // source and the first version of this test went green (mutation A3).
  const noSource = branch(codeOnly(ask), 'no_source');
  assert.match(noSource, /\{result\.best_score != null/,
    'the closest score is not rendered in the no-source branch');
  assert.match(noSource, /result\.score_floor/,
    'the floor the score fell under is not shown beside it');
  assert.doesNotMatch(noSource, /false &&/, 'the score is rendered behind a dead guard');
});

test('every citation names its passage, in both branches that list one', () => {
  const code = codeOnly(ask);
  assert.match(code, /citations/, 'an answer with no citations is the failure D12 withdrew a tab for');
  // BOTH branches, counted rather than matched once. The first version
  // asserted a single occurrence, and there are two — so removing the one on
  // the answer itself still passed on the one under model_unavailable
  // (mutation A4). A citation that names only the document sends a reader to
  // re-read the whole file.
  const answered = branch(code, 'answered');
  assert.match(answered, /passage \{ct\.chunk \+ 1\}/,
    'an answer’s citation does not name the passage it used');
  const unavailable = branch(code, 'model_unavailable');
  assert.match(unavailable, /passage \{ct\.chunk \+ 1\}/,
    'the passages found before the model failed are listed without their position');
});

test('both zones state that nobody can share a document with you', () => {
  // The absent half of the feature, said out loud. Without it an empty library
  // reads as "nobody sent me anything" rather than "I have not added anything",
  // and those imply completely different next actions.
  assert.match(library, /Nobody can send you a document yet/);
  assert.match(ask, /answers only from documents you have added/i);
  assert.match(workspace, /Documents shared with you/,
    'the rail must list sharing among what is unavailable');
});

test('the api methods exist and none of them takes a whose-library argument', () => {
  for (const m of ['upload:', 'documents:', 'downloadUrl:', 'remove:', 'ask:']) {
    assert.ok(api.includes(m), `api.research.${m} is missing`);
  }
  const start = api.indexOf('research: {');
  const block = api.slice(start, api.indexOf('\n  },', start));
  assert.ok(block.length > 0 && block.length < 2000, 'the research api slice must not run away');
  // Every read is scoped to the signed-in user by the worker. A user_id or
  // owner parameter here would be the beginning of a cross-account read.
  for (const banned of ['user_id', 'userId', 'owner', 'advisor_id']) {
    assert.ok(!block.includes(banned),
      `api.research takes a ${banned} — these routes are scoped to the caller and must stay that way`);
  }
});

test('the library carries the canvas stat strip, and a tile with no source says so', () => {
  // C9. `Pages · {Founder,Investor} Research` gives the Library zone a
  // four-stat strip: `Documents`, `Primary sources`, `Questions asked` and a
  // cost per question. `research_documents` holds title, kind, size, index
  // state, passage count and dates — so exactly one of those four has a
  // source, and the other three must SAY they have none rather than being
  // dropped or filled with a plausible figure.
  const code = codeOnly(library);
  assert.match(code, /<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">/,
    'the four-stat strip the canvas draws is gone');

  // EACH TILE BOUNDED AT ITS OWN `/>`, not read through a fixed window. A
  // 260-character window was the first version and it spilled into the tile
  // BELOW: replacing `Questions asked`'s value with a modelled
  // `items.length * 3` still passed, because the window reached the next
  // tile's `value="Not recorded"` and matched that instead. Same mistake, and
  // the same fix, as the capped `<ZoneToolbar` regex in the filters guard.
  // `/<Stat\s/` and not `'<Stat'`: `<StatedLimit` further down the file starts
  // with the same five characters, and splitting on the bare string picked it
  // up as a fifth, label-less tile.
  const tiles = Object.fromEntries(code.split(/<Stat\s/).slice(1).map((segment) => {
    const tile = segment.slice(0, segment.indexOf('/>'));
    return [tile.match(/label="([^"]+)"/)?.[1], tile];
  }));
  assert.deepEqual(
    Object.keys(tiles),
    ['Documents', 'Primary sources', 'Questions asked', 'Cost per question'],
    'the strip is no longer the canvas\'s four tiles, in the canvas\'s order',
  );
  // The three with no store, each pinned to its own tile.
  for (const label of ['Primary sources', 'Questions asked', 'Cost per question']) {
    assert.match(tiles[label], /value="Not recorded"/,
      `${label} has no source and must say "Not recorded", not print a figure`);
    assert.doesNotMatch(tiles[label], /value=\{/,
      `${label} has no source, so any expression in its value is a modelled figure`);
  }
  // And the one that does have a source must read the real list, never a
  // constant — the whole strip is worthless if the true tile is decorative.
  assert.match(tiles.Documents, /value=\{payload \? items\.length : undefined\}/,
    'the Documents tile no longer counts the documents actually loaded');
});

test('the library lists documents as the canvas’s named columns', () => {
  // A row of chips is fine to read one at a time and impossible to scan down.
  // `Year` is deliberately absent: the canvas means the SOURCE's own year,
  // which nothing records, and `created_at` is when the file was added here —
  // a different fact, so the column says `Added`. `Questions` is absent for
  // the same reason the tile above says "Not recorded"; a whole column of it
  // would say the same thing once per row.
  const code = codeOnly(library);
  for (const head of ['Document', 'Kind', 'Added', 'Passages', 'State']) {
    assert.ok(code.includes(`'${head}'`), `the documents table lost its "${head}" column`);
  }
  assert.doesNotMatch(code, /'Year'/, 'a source year column would have nothing to fill it');
  assert.match(code, /<div className="overflow-x-auto">/,
    'the table must scroll inside its own container, never the page');
});

/**
 * Ask's canvas structure, and the one judgement in C9 that reverses a recorded
 * one.
 *
 * `77f53bf28` — the commit that gave Library this treatment — argued in writing
 * that Ask should NOT get it: "Four empty tiles and an empty table would
 * restate one absence five more times." That reasoning was right about the
 * licences it was looking at and wrong about the other two, and the split is
 * what these tests hold still.
 *
 * On FOUNDER and INVESTOR it stands. All four of their canvas tiles —
 * `Questions asked`, `Answers kept`, and two per-question costs — and their
 * whole `Session history` table are downstream of one missing thing: a stored
 * session. `research.post('/ask')` searches, answers and returns; the only
 * per-call row in the product is `ai_usage_logs`, holding token counts with no
 * question text. So those two licences state the absence once, in a sentence,
 * and draw neither strip nor table.
 *
 * On ADVISOR and PARTNER it does not stand, because their artboards open with a
 * different first tile. `Indexed documents` and the whole `What Ask can reach`
 * table are fields `api.research.documents()` already returns and this page has
 * already fetched for its empty state. A real strip with three stated gaps is
 * the Library treatment exactly; refusing to draw it would hide a table that
 * answers the zone's own question — which of my documents can Ask actually
 * see — behind an argument about tiles that are not on this artboard.
 */
test('the ask strip and table are drawn only where their first tile is real', () => {
  const code = codeOnly(ask);
  // THE SET, NOT A ROLE TEST INLINE. One named constant gates both surfaces,
  // so the strip and the table can never disagree about which licence they are
  // for — which is the drift a second `role === 'advisor'` further down the
  // file would introduce silently.
  assert.match(code, /const ASK_STRIP_LICENCES = new Set\(\['advisor', 'partner'\]\)/,
    'the licence set that gates Ask’s canvas structure is gone or has changed shape');
  assert.equal((code.match(/ASK_STRIP_LICENCES\.has\(role\)/g) || []).length, 2,
    'exactly two surfaces are gated: the stat strip and the instrument card');
  // Founder and investor must reach neither, and must not do so by accident:
  // the only role comparisons in this file are the set above.
  assert.doesNotMatch(code, /role === '(founder|investor|advisor|partner)'/,
    'a bare role comparison would let one surface drift from the other');
});

test('ask draws the advisor/partner strip, and three of its four tiles say they have no source', () => {
  // `Pages · {Advisor,Partner} Research`'s Ask artboard: `Indexed documents`,
  // `Answered`, `No source`, `Session spend`, in that order.
  const code = codeOnly(ask);
  assert.match(code, /<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">/,
    'the four-stat strip the advisor and partner canvases draw is gone');

  // Bounded at each tile's own `/>`, and split on `/<Stat\s/` — both for the
  // reasons the library block above pays for in full. `<StatedLimit` twice in
  // this file is exactly the trap the `\s` avoids.
  const tiles = Object.fromEntries(code.split(/<Stat\s/).slice(1).map((segment) => {
    const tile = segment.slice(0, segment.indexOf('/>'));
    return [tile.match(/label="([^"]+)"/)?.[1], tile];
  }));
  assert.deepEqual(
    Object.keys(tiles),
    ['Indexed documents', 'Answered', 'No source', 'Session spend'],
    'the strip is no longer the advisor/partner canvas’s four tiles, in its order',
  );
  for (const label of ['Answered', 'No source', 'Session spend']) {
    assert.match(tiles[label], /value="Not recorded"/,
      `${label} counts across a session that is not stored and must say "Not recorded"`);
    assert.doesNotMatch(tiles[label], /value=\{/,
      `${label} has no source, so any expression in its value is a modelled figure`);
  }
  // And the true tile reads the payload actually loaded — a strip whose one
  // real figure is decorative is worse than no strip.
  assert.match(tiles['Indexed documents'], /value=\{payload \? indexed : undefined\}/,
    'the Indexed documents tile no longer reads the library payload');
});

test('founder and investor get the absence once, naming all four tiles they lose', () => {
  // The four labels, said in the sentence rather than drawn as four tiles that
  // would each read "Not recorded". If a session store ever lands, this
  // sentence is what has to change — so it names what it is standing in for.
  const code = codeOnly(ask);
  const limit = code.slice(code.indexOf('<StatedLimit>'), code.indexOf('</StatedLimit>'));
  assert.ok(limit.length > 0 && limit.length < 1200, 'the stated-limit slice must not run away');
  for (const label of ['Questions asked', 'Answers kept', 'First-pass cost', 'Follow-up cost']) {
    assert.ok(limit.includes(label),
      `the sentence must name "${label}" — it is standing in for that tile`);
  }
  assert.match(limit, /session/i,
    'the sentence must name the one missing thing all four tiles are downstream of');
  // The founder/investor `Session history` table is NOT drawn. A table whose
  // every row would be "Not recorded" is what the library rule already forbids.
  //
  // BANNING THE PHRASE IS THE WRONG PROBE, and this assertion failed as one
  // first. `codeOnly` deliberately keeps indented `{/* */}` comments — its own
  // docblock explains why a naive stripper is worse — and the comment above the
  // instrument card names `Session history` precisely to say it is not drawn.
  // So the probe is the rendered thing: one `<table>` in the whole file, which
  // the test above has already pinned to the licence-gated card, and none of
  // the session table's own column headings anywhere.
  assert.equal((code.match(/<table/g) || []).length, 1,
    'a second table in this file is the session history the sentence above says is not kept');
  for (const head of ['Drew on', 'What you did with it']) {
    assert.ok(!code.includes(`>${head}<`),
      `"${head}" is a session-history column and nothing writes a row for it`);
  }
});

test('the ask instrument card lists documents as its canvas’s named columns', () => {
  // `What Ask can reach` — `Document / Kind / Added / Index state / In Ask`.
  // `Added` is the same deliberate relabel the library made: the canvas's slot
  // means the source's own date, `created_at` is when the file arrived here.
  const code = codeOnly(ask);
  // SLICED FROM THE RENDERED HEADING, not the first mention of it. The comment
  // above the card names the title and all five columns while explaining where
  // they come from, so `indexOf('What Ask can reach')` lands in prose and every
  // column below would then be checked against the sentence describing them.
  assert.match(code, /<h3 className="[^"]*">What Ask can reach<\/h3>/,
    'the advisor/partner instrument card is gone');
  const card = code.slice(code.indexOf('What Ask can reach</h3>'));
  for (const head of ['Document', 'Kind', 'Added', 'Index state', 'In Ask']) {
    assert.ok(card.includes(`>${head}<`), `the instrument card lost its "${head}" column`);
  }
  assert.equal((code.match(/<div className="mt-3 overflow-x-auto">/g) || []).length, 1,
    'the table must scroll inside its own container, never the page');
});

test('“In Ask” is derived from the index state, never from a stale passage count', () => {
  // The zone's own question, per row. `chunk_count` is the tempting source and
  // the wrong one: a document that indexed once and later failed a re-index
  // keeps its old count, because the failure path writes the state and leaves
  // the number alone. Reading the count would call that document answerable
  // when Ask cannot see it.
  const code = codeOnly(ask);
  // From the rendered heading, for the reason the test above gives: the comment
  // that names `chunk_count` to rule it out sits ABOVE the card.
  const card = code.slice(code.indexOf('What Ask can reach</h3>'));
  assert.match(card, /d\.index_state === 'indexed'\s*\?\s*'Answerable'/,
    'the In Ask column must read the index state');
  assert.match(card, /<Unrecorded>Not answerable<\/Unrecorded>/,
    'a document Ask cannot see must read as unrecorded, not as a blank cell');
  // `d.chunk_count`, not the bare token. The comment ruling the field out sits
  // INSIDE this card — it is the comment worth keeping — and the field is only
  // reachable off the row object, so the property access is the code form and
  // the backticked name in prose is not. Banning the bare token here would ban
  // the explanation rather than the behaviour.
  assert.doesNotMatch(card, /d\.chunk_count/,
    'chunk_count survives a failed re-index and would call an unreachable document answerable');
});
