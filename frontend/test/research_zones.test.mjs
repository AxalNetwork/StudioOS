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
  // THE BRANCH, NOT THE SENTENCE IN IT, and not the component either. This
  // pinned `chunk_count == null ? <Unrecorded>`, which held the RENDERING
  // still rather than the behaviour — twice now. It first pinned the words "No
  // passages indexed" and had to move when the count became a column; it then
  // pinned `<Unrecorded>` and had to move again when the count became the
  // `sub` line under the index-state cell, where the artboard puts it. What
  // must not change is that the null case produces nothing at all rather than
  // a number.
  assert.match(code, /chunk_count == null \? null :/,
    'a never-indexed document must render no passage count, not a zero');
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
  //
  // READ OFF THE ROW, NOT OFF ONE ANSWER IN STATE. These matched
  // `result?.reason === '…'` — the single answer this page held before
  // migration 221 gave it a session store. The three outcomes are unchanged and
  // so is the rule; what changed is that every one of them is now a stored row
  // in a thread, which is why the probe is `t.reason`.
  assert.match(code, /t\.reason === 'answered' \? t\.answer/,
    'an answered row must print its answer');
  assert.match(code, /t\.reason === 'model_unavailable'/,
    'a model failure must not be reported as an empty library — it would send the reader to upload something that would not help');
  assert.match(code, /t\.reason === 'no_source'/,
    'a question the library could not answer must render as its own outcome');

  // THE THREE MUST NOT COLLAPSE INTO TWO. The failure worth guarding is not a
  // missing branch but two branches saying the same thing: a `model_unavailable`
  // row that reads "nothing in your library was close enough" is precisely the
  // sentence that sends someone off to upload a document that would not have
  // helped. So the copy is checked, not only the comparison.
  assert.match(code, /Your library does have relevant passages/,
    'the model-failure copy no longer says the library was fine');
  assert.match(code, /Adding documents will not help/,
    'the model-failure copy no longer tells the reader what NOT to do about it');
  assert.match(code, /Nothing in your library was close enough/,
    'the no-source copy no longer names the library as the gap');

  // And it must say plainly that it will not fall back to general knowledge.
  assert.match(ask, /will not answer from general knowledge/);
});

/**
 * One thread card's JSX, bounded at both ends.
 *
 * The old helper sliced a `result?.reason === '<name>'` block per outcome.
 * There is one card now and the outcomes are branches inside it, so the slice
 * is the card — from the row's key to the close of the map. Bounded rather than
 * read to end-of-file for the reason the old one was: a whole-file match passes
 * on dead code.
 */
function threadCard(code) {
  const start = code.indexOf('{visible.map((t) => (');
  assert.notEqual(start, -1, 'the thread is no longer rendered as a map over the visible rows');
  // BALANCED, NOT THE FIRST `))}`. The naive end marker landed on the CITATION
  // map's own close, a dozen lines above the no-source note — so the slice
  // stopped short and the note read as missing. A card that renders a nested
  // map is exactly the case a first-delimiter search cannot bound, and this
  // file has made the same mistake twice before with fixed-width windows.
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  assert.fail('the thread map is not a closed block');
  return '';
}

test('Ask shows what the closest passage scored rather than only refusing', () => {
  // A bare "no source" leaves a reader unable to tell whether to rephrase the
  // question or add a document. The number is the fact; whether it is close
  // enough is the floor's job, and both are shown.
  //
  // SCOPED TO THE BLOCK THAT RENDERS IT, because a whole-file match passes on
  // dead code: wrapping the score in `{false && …}` left the identifier in the
  // source and the first version of this test went green (mutation A3).
  const card = threadCard(codeOnly(ask));
  const noSource = card.slice(card.indexOf("t.reason === 'no_source' ? ("));
  assert.ok(noSource.length > 0, 'the no-source note is gone from the thread card');
  assert.match(noSource, /t\.best_score != null/,
    'the closest score is not rendered in the no-source note');
  assert.match(noSource, /t\.score_floor/,
    'the floor the score fell under is not shown beside it');
  assert.doesNotMatch(noSource, /false &&/, 'the score is rendered behind a dead guard');
  // A ROW THAT NEVER REACHED A MODEL COSTS NOTHING, AND THE NOTE SAYS SO. It is
  // the artboard's own argument for keeping the unanswered question on screen
  // rather than dropping it, and it is checkable against the worker: the
  // `no_source` path in `research.ts` writes the row before any model runs.
  assert.match(noSource, /Nothing is charged for a question the library cannot answer/,
    'the no-source note no longer says the question was free');
});

test('every citation names its passage, and one list serves both branches', () => {
  const code = codeOnly(ask);
  assert.match(code, /citations/, 'an answer with no citations is the failure D12 withdrew a tab for');
  const card = threadCard(code);
  assert.match(card, /passage \$\{ct\.chunk \+ 1\}/,
    'a citation does not name the passage it used');

  // ONE LIST, NOT TWO, AND THAT IS THE FIX RATHER THAN THE RISK. This used to
  // count the same assertion across two branches, because `answered` and
  // `model_unavailable` each rendered their own citation list and deleting one
  // still passed on the other (mutation A4). The thread renders `t.citations`
  // once for every row, so the two cannot disagree — but only while the list
  // stays outside an outcome test, which is what this holds.
  const cites = card.slice(card.indexOf('(t.citations || []).map('));
  assert.ok(cites.length > 0, 'the citation list is gone from the thread card');
  const before = card.slice(0, card.indexOf('(t.citations || []).map('));
  assert.doesNotMatch(before.slice(before.lastIndexOf('<div')), /t\.reason === 'answered' &&/,
    'the citation list has been put behind an answered-only guard, so a model failure would list nothing');
});

test('a shared document is listed, and the page says why Ask still cannot cite it', () => {
  // REVERSED, AND THE REVERSAL IS THE POINT. This required the library, Ask and
  // the rail all to say "Nobody can send you a document yet". That was true
  // when it was written and stopped being true: `advisor_client_grants`
  // (migration 218) is the grant it said existed "for investors and for nobody
  // else", `advisor_client_document_shares` carries a file inside one, and
  // `GET /documents` now lists what has arrived that way.
  //
  // What has NOT changed is the reach, and that is what the three surfaces have
  // to agree on now: a shared document is indexed in the client's namespace,
  // `searchSemantic` only ever searches the caller's own, so Ask cannot cite it.
  // Listed and unreachable is not a contradiction, and a reader who is told
  // only the first half will assume the second.
  // THROUGH A COMMENT STRIP, and for the reason `_codeOnly.mjs` exists at all:
  // both files explain the reversal by quoting the sentence they replaced, and
  // banning the string outright bans the explanation rather than the behaviour.
  // `codeOnly` deliberately keeps indented `{/* */}` blocks, so those go too.
  const rendered = (src) => codeOnly(src).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const libRendered = rendered(library);
  const railRendered = rendered(workspace);
  assert.ok(libRendered.length > 0 && libRendered.length < library.length,
    'the strip removed nothing, so the bans below are not reading the page');
  assert.doesNotMatch(libRendered, /Nobody can send you a document yet/,
    'the library denies a share path that migration 218 built and this page reads');
  assert.doesNotMatch(railRendered, /Nobody can send you a document yet/,
    'the rail denies a share path the library reads');

  assert.match(library, /indexed in their library, not yours/i,
    'the library no longer says why a shared document is unreachable');
  assert.match(library, /not yours to change or remove/,
    'the library no longer states the read-only asymmetry');
  assert.match(ask, /answers only from documents you have added/i);
  assert.match(workspace, /Ask over a document a client shared/,
    'the rail must report the reach that is still unavailable');

  // AND THE PAGE MUST NOT OVERCORRECT. An empty library still means two things
  // — nothing uploaded AND nothing opened to you — and saying only the first
  // is the failure this test has guarded from the beginning.
  assert.match(library, /no client has opened a file to you/,
    'an empty library reads as "I have not uploaded anything" and hides the other half');
});

test('the api methods exist and none of them takes a whose-library argument', () => {
  for (const m of ['upload:', 'documents:', 'downloadUrl:', 'remove:', 'ask:']) {
    assert.ok(api.includes(m), `api.research.${m} is missing`);
  }
  const start = api.indexOf('research: {');
  const block = api.slice(start, api.indexOf('\n  },', start));
  // BOUNDED STRUCTURALLY, NOT BY A LENGTH. This read `block.length < 2000`,
  // which is a proxy for "the delimiter found the end of the object" and stops
  // being one the moment the object legitimately grows — migration 221 added
  // seven methods here and the guard failed on the size rather than on
  // anything being wrong. What it is actually for is that the slice covers the
  // research block and nothing after it, so that is what it asserts: the
  // block's own last method is inside, and the next top-level key is not.
  assert.ok(block.startsWith('research: {'), 'the research block did not start where it was found');
  assert.ok(block.includes('diligence:'), 'the slice stops short of the end of the research block');
  assert.ok(!block.includes('export const dd'), 'the slice ran past the end of the research block');
  // Every read is scoped to the signed-in user by the worker. A user_id or
  // owner parameter here would be the beginning of a cross-account read.
  for (const banned of ['user_id', 'userId', 'owner', 'advisor_id']) {
    assert.ok(!block.includes(banned),
      `api.research takes a ${banned} — these routes are scoped to the caller and must stay that way`);
  }
});

test('each licence draws its own Library artboard’s tiles', () => {
  // THE BUG THIS REPLACES. This test required ONE strip — `Documents`,
  // `Primary sources`, `Questions asked`, `Cost per question` — for every
  // licence, and the page drew exactly that. Those are the FOUNDER and INVESTOR
  // artboards' tiles. `Pages · {Advisor,Partner} Research` open Library with
  // `Documents`, `Indexed`, `Not indexed`, `From clients`, so a partner's page
  // has been showing a founder's artboard, with three tiles reading "Not
  // recorded" where their own asks for three figures the store can produce.
  //
  // AND TWO OF THOSE THREE WERE ALREADY FALSE by the time this ran: migration
  // 221 stores the question history that `Questions asked` and `Cost per
  // question` both denied. This test REQUIRED that denial — `value="Not
  // recorded"` on each — which is how a stale gap claim survives a green suite.
  const code = codeOnly(library);
  assert.match(code, /const LIBRARY_STRIP = \{/, 'the per-licence strip table is gone');
  const table = code.slice(code.indexOf('const LIBRARY_STRIP = {'));
  const decl = table.slice(0, table.indexOf('\n};'));
  const labels = (key) => {
    const at = decl.indexOf(`  ${key}: [`);
    assert.notEqual(at, -1, `the ${key} strip is gone`);
    const block = decl.slice(at, decl.indexOf('\n  ],', at));
    return [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  };
  assert.deepEqual(labels('advisor'),
    ['Documents', 'Indexed', 'Not indexed', 'From clients'],
    'the advisor/partner strip is no longer its artboard’s four tiles, in the artboard’s order');
  assert.deepEqual(labels('founder'),
    ['Documents', 'Primary sources', 'Questions asked', 'Cost per question'],
    'the founder/investor strip is no longer its artboard’s four tiles, in the artboard’s order');

  // Aliased, not copied — the same rule `ASK_STRIP` follows one file over.
  assert.match(code, /LIBRARY_STRIP\.partner = LIBRARY_STRIP\.advisor;/,
    'partner has its own copy of the advisor strip and can now drift from it');
  assert.match(code, /LIBRARY_STRIP\.investor = LIBRARY_STRIP\.founder;/,
    'investor has its own copy of the founder strip and can now drift from it');

  // D56 IS UNCHANGED AND IS NOW ENFORCED AT THE TILE. A `value` returning null
  // is dropped; nothing prints its own absence into the slot where a figure
  // belongs. `Primary sources` is the one tile that still has no store —
  // nothing on a document records whether it is own research or a bought
  // report — and it is the only `value` allowed to be a bare null.
  assert.match(code, /if \(v === null\) return null;/,
    'a tile whose value is unavailable is drawn anyway');
  assert.doesNotMatch(code, /value="Not recorded"/,
    'a tile states its own absence again instead of not being drawn');
  const nulls = [...decl.matchAll(/label: '([^']+)', value: \(\) => null/g)].map((m) => m[1]);
  assert.deepEqual(nulls, ['Primary sources'],
    'a second tile has been given up on, or the one with no store has been filled');

  // Every other tile reads the page. `x.` is the tell: a tile that never reads
  // the context is reporting something it did not measure.
  const values = [...decl.matchAll(/value: \(x\) => ([^\n]+)/g)].map((m) => m[1]);
  assert.equal(values.length, 7, 'the two strips no longer declare seven sourced tiles between them');
  for (const v of values) assert.match(v, /\bx\./, `a tile value reads nothing from the page: ${v}`);

  // COUNTED OVER THE WHOLE LIBRARY, NEVER OVER THE CHIP-NARROWED LIST. A tile
  // that changes because you clicked a chip is not reporting what it claims to.
  const ctx = code.slice(code.indexOf('const ctx = {'), code.indexOf('const reindex ='));
  assert.ok(ctx.length > 0, 'the strip context is gone');
  assert.doesNotMatch(ctx, /\bvisible\b/, 'the tiles count the chip-narrowed list');
});

test('the library lists documents as its artboard’s named columns', () => {
  // `Document / Kind / Added / Index state / In Ask`. `Added` is a deliberate
  // relabel: the artboard's slot means the SOURCE's own year — the thing that
  // makes a 2023 report stale — and nothing records it, so the column carries
  // the date it actually has, which is when the file arrived here.
  //
  // `Passages` IS NO LONGER A COLUMN and that is the artboard's own layout: the
  // count is the `sub` line under the index state, because it is a detail of
  // that state rather than a fact of its own. The guard above holds the null
  // case.
  const code = codeOnly(library);
  assert.match(code, /title="Library"/, 'the instrument card is gone');
  const card = code.slice(code.indexOf('title="Library"'));
  const head = card.match(/head=\{\[([^\]]*)\]\}/);
  assert.ok(head, 'the instrument card no longer declares its column heads');
  assert.deepEqual(
    head[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')),
    ['Document', 'Kind', 'Added', 'Index state', 'In Ask'],
  );
  assert.doesNotMatch(code, /'Year'/, 'a source year column would have nothing to fill it');

  // `In Ask` IS NOT A SECOND COPY OF `Index state`, which is the one way this
  // table could go quietly wrong. A client's document can be indexed — in THEIR
  // library — and still be uncitable here, so the last column reads the reach
  // the worker computed rather than the state beside it.
  assert.match(card, /d\.in_ask/, 'the In Ask column no longer reads the computed reach');
  assert.match(card, /Indexed in their library, not yours/,
    'a shared document reads as answerable, or as unindexed, instead of as out of reach');

  // The scroller lives in the shared `Instrument`, which is why seven artboards
  // cannot each forget it.
  const kit = codeOnly(read('frontend/src/workspaces/canvasKit.jsx'));
  assert.match(kit, /overflow-x-auto/,
    'the shared instrument table lost its own scroller and the page will scroll sideways');
});

/**
 * Ask's canvas structure — four artboards, eight distinct tiles, and the store
 * that turned seven of them on at once.
 *
 * THE HISTORY MATTERS HERE, because this block has been reversed twice and both
 * reversals were right at the time.
 *
 * `77f53bf28` gave Library its stat strip and argued in writing that Ask should
 * NOT get one: "Four empty tiles and an empty table would restate one absence
 * five more times." A later pass split that by licence — advisor and partner
 * drew a one-tile strip because `Indexed documents` is real, founder and
 * investor drew nothing because not one of their four was.
 *
 * BOTH JUDGEMENTS WERE ABOUT ONE MISSING STORE, and migration 221 built it.
 * `research_ask_sessions` and `research_ask_answers` keep every exchange with
 * its outcome, its citations and the router's own cost receipt, so `Answered`,
 * `No source`, `Session spend`, `Questions asked` and `Answers kept` are all
 * counted from rows now. D56's rule has not moved: a tile with no store is
 * still not drawn, and the file still has one such tile.
 *
 * WHAT THESE TESTS HOLD, THEREFORE, IS NOT "how many tiles" BUT "each licence
 * gets its own artboard's tiles, and every drawn tile reads a real source".
 */
test('each licence draws its own artboard’s tiles, not another licence’s', () => {
  // `Pages · {Advisor,Partner} Research` open Ask with `Indexed documents`,
  // `Answered`, `No source`, `Session spend`. `Pages · {Founder,Investor}
  // Research` open it with `Questions asked`, `Answers kept`, `First-pass
  // cost`, `Follow-up cost`. Four artboards, two sets — drawing one set on all
  // four would be matching one artboard and overwriting three.
  const code = codeOnly(ask);
  assert.match(code, /const ASK_STRIP = \{/, 'the per-licence strip table is gone');
  const table = code.slice(code.indexOf('const ASK_STRIP = {'));
  const decl = table.slice(0, table.indexOf('\n};'));
  const labels = (key) => {
    const at = decl.indexOf(`  ${key}: [`);
    assert.notEqual(at, -1, `the ${key} strip is gone`);
    const block = decl.slice(at, decl.indexOf('\n  ],', at));
    return [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  };
  assert.deepEqual(labels('advisor'),
    ['Indexed documents', 'Answered', 'No source', 'Session spend'],
    'the advisor/partner strip is no longer its artboard’s four tiles, in the artboard’s order');
  assert.deepEqual(labels('founder'),
    ['Questions asked', 'Answers kept', 'First-pass cost', 'Follow-up cost'],
    'the founder/investor strip is no longer its artboard’s four tiles, in the artboard’s order');

  // ALIASED, NOT COPIED. Partner's artboard is advisor's and investor's is
  // founder's, so the second of each pair points at the first — a duplicated
  // array is two lists that can drift, which is the whole reason this file
  // reads the table rather than the JSX.
  assert.match(code, /ASK_STRIP\.partner = ASK_STRIP\.advisor;/,
    'partner has its own copy of the advisor strip and can now drift from it');
  assert.match(code, /ASK_STRIP\.investor = ASK_STRIP\.founder;/,
    'investor has its own copy of the founder strip and can now drift from it');

  // The licence gate that used to draw the strip on two roles is gone, and no
  // bare role comparison replaced it: the table IS the gate.
  assert.doesNotMatch(code, /ASK_STRIP_LICENCES/,
    'the two-licence gate is back — every licence has a strip of its own now');
  assert.doesNotMatch(code, /role === '(founder|investor|advisor|partner)'/,
    'a bare role comparison would let one surface drift from the table');
});

test('every drawn tile reads the store, and a tile with nothing to read is not drawn', () => {
  // D56, unchanged and now enforced at the tile rather than at the strip. A
  // `value` that returns null is dropped by the renderer; a `value` that
  // returns a literal would be a decorative figure, which is worse than an
  // absent one.
  const code = codeOnly(ask);
  assert.match(code, /if \(v === null\) return null;/,
    'a tile whose value is unavailable is drawn anyway');
  assert.doesNotMatch(code, /value="Not recorded"/,
    'a tile states its own absence again instead of not being drawn');

  const table = code.slice(code.indexOf('const ASK_STRIP = {'));
  const decl = table.slice(0, table.indexOf('\n};'));
  // Every `value:` in the table is a function of the context object — never a
  // constant. `x.` is the tell: a tile that never reads `x` is reporting
  // something it did not measure.
  const values = [...decl.matchAll(/value: \(x\) => ([^\n]+)/g)].map((m) => m[1]);
  assert.equal(values.length, 8, 'the two strips no longer declare eight tiles between them');
  for (const v of values) {
    assert.match(v, /\bx\./, `a tile value reads nothing from the page: ${v}`);
  }
  // The two cost tiles average over the rows and return null when there are
  // none of their kind — which is how `Follow-up cost` stays undrawn while
  // `research_ask` is billed uncached.
  assert.equal((decl.match(/return m == null \? null : formatCost\(m\);/g) || []).length, 2,
    'a mean over no rows must be null rather than zero — zero reads as free');
  assert.match(decl, /filter\(\(t\) => t\.cached\)/,
    'the follow-up tile no longer selects the answers billed from cache');
  assert.match(decl, /filter\(\(t\) => !t\.cached\)/,
    'the first-pass tile no longer selects the answers billed at full rate');
});

test('the session history is a thread on screen, not a table nothing writes', () => {
  // The founder/investor artboards draw a `Session history` TABLE — `Question
  // / Drew on / Cost / What you did with it`. It was not drawn because nothing
  // wrote a row. Migration 221 writes them, and they are rendered as the
  // thread every artboard's Ask page actually draws rather than as a fifth
  // table: the questions, in order, each with its answer, its citations and
  // its charge.
  const code = codeOnly(ask);
  const card = threadCard(code);
  assert.match(card, /\{formatCost\(t\.cost_usd\)\}/,
    'a row no longer shows what that question cost');
  assert.match(card, /t\.saved \? 'Kept' : 'Keep'/,
    'the artboard’s "what you did with it" column has no control behind it');
  // ONE INSTRUMENT TABLE IN THE FILE, still. The thread is cards; `What Ask can
  // reach` is the only grid, and a second one would be the session-history
  // table drawn twice in two shapes.
  assert.equal((code.match(/<Instrument/g) || []).length, 1,
    'a second instrument card in this file is the session history in a second shape');
});

test('the ask instrument card lists documents as its canvas’s named columns', () => {
  // `What Ask can reach` — `Document / Kind / Added / Index state / In Ask`.
  // `Added` is the same deliberate relabel the library made: the canvas's slot
  // means the source's own date, `created_at` is when the file arrived here.
  const code = codeOnly(ask);
  assert.match(code, /title="What Ask can reach"/, 'the instrument card is gone');
  const card = code.slice(code.indexOf('title="What Ask can reach"'));
  const head = card.match(/head=\{\[([^\]]*)\]\}/);
  assert.ok(head, 'the instrument card no longer declares its column heads');
  assert.deepEqual(
    head[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')),
    ['Document', 'Kind', 'Added', 'Index state', 'In Ask'],
  );
  // The scroller moved into `canvasKit`'s `Instrument`, which is the point of
  // it existing — seven artboards render this table and one of them owning the
  // overflow rule is how the other six cannot forget it.
  const kit = codeOnly(read('frontend/src/workspaces/canvasKit.jsx'));
  assert.match(kit, /overflow-x-auto/,
    'the shared instrument table lost its own scroller and the page will scroll sideways');
});

test('“In Ask” is derived from the index state, never from a stale passage count', () => {
  // The zone's own question, per row. `chunk_count` is the tempting source and
  // the wrong one: a document that indexed once and later failed a re-index
  // keeps its old count, because the failure path writes the state and leaves
  // the number alone. Reading the count would call that document answerable
  // when Ask cannot see it.
  const code = codeOnly(ask);
  const rows = code.slice(code.indexOf('const libRows = items.map('), code.indexOf('title="What Ask can reach"'));
  assert.ok(rows.length > 0, 'the instrument card’s row builder is gone');
  assert.match(rows, /d\.index_state === 'indexed'\s*\?\s*\{ text: 'Answerable in Ask' \}/,
    'the In Ask column must read the index state');
  assert.match(rows, /\{ text: 'Not answerable until indexed' \}/,
    'a document Ask cannot see must say why, not render a blank cell');
  // `d.chunk_count`, not the bare token: the field is only reachable off the
  // row object, so the property access is the code form and a backticked name
  // in prose is not. Banning the bare token would ban the explanation rather
  // than the behaviour.
  assert.doesNotMatch(rows, /d\.chunk_count/,
    'chunk_count survives a failed re-index and would call an unreachable document answerable');
});

const funds = read('frontend/src/pages/research/FundsZone.jsx');

test('funds lists its canvas’s named columns', () => {
  // `Pages · Founder Research` draws `Fund · Cheque · State · What the research
  // says`. The zone rendered every one of those as a card list and none of them
  // as a column, which is the whole of what task #109 was for this zone: no
  // field was missing, only the shape.
  const code = codeOnly(funds);
  const head = code.match(/\[([^\]]*)\]\.map\(\(head\)/);
  assert.ok(head, 'the funds table no longer declares its column heads');
  assert.deepEqual(
    head[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
    ['Fund', 'Cheque', 'State', 'What the research says'],
  );
  // Its own scroller: a narrow viewport must scroll the table, never the page.
  assert.match(code, /overflow-x-auto/, 'the funds table lost its own scroller');
});

test('a fund nobody has assessed is not a fund at the wrong stage', () => {
  /**
   * THE ONE THING THE RE-LAYOUT COULD SILENTLY LOSE, and the reason this test
   * is beside the table test rather than folded into it.
   *
   * `research_funds.stage_fit` is `right | wrong | NULL`, and migration 216 is
   * explicit that "NULL means not yet assessed, which is a different fact from
   * wrong and must not render as one". A three-way value pushed into a
   * two-tone pill collapses to the wrong half — and the failure is invisible,
   * because a `Wrong stage` pill on an unassessed fund looks exactly like a
   * judgement somebody made. The founder then filters their own shortlist and
   * loses the funds they had not got to yet.
   */
  const code = codeOnly(funds);
  assert.match(code, /STAGE_LABEL\[f\.stage_fit\] \|\| 'Stage not assessed'/,
    'a null stage_fit must read as not assessed rather than falling to a wrong-stage label');
  assert.match(code, /f\.stage_fit === 'right' \? 'ok' : f\.stage_fit === 'wrong' \? 'warn' : 'neutral'/,
    'the pill tone must have three arms — a two-arm ternary paints unassessed as wrong');
  // The editor keeps the blank option, because clearing an assessment back to
  // "not assessed" has to stay possible: a mis-set fit that can only be
  // changed to the other wrong answer is worse than one nobody set.
  assert.match(code, /<option value="">Stage not assessed<\/option>/,
    'the stage editor can no longer be cleared back to unassessed');
});

test('a cheque range that is not recorded is not a cheque of nothing', () => {
  // `cheque()` returns null when both ends are absent and the end it has when
  // one is. A `?? 0` or an empty cell here would say this fund writes cheques
  // your size, or that it writes none — both fabrications over a column the
  // founder fills in by hand, one fund at a time.
  const code = codeOnly(funds);
  assert.match(code, /\{cheque\(f\) \|\| <Unrecorded>/,
    'a missing cheque range must render as unrecorded');
  assert.doesNotMatch(code, /cheque\(f\)\s*(\|\|\s*['"]?0|\?\?)/,
    'a missing cheque range is being defaulted to a figure');
  // And the helper still reports the single end it has rather than nothing.
  assert.match(code, /return lo \|\| hi \|\| null;/,
    'a range with one end recorded must still show that end');
});
