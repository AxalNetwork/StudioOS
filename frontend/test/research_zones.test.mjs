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
  assert.match(code, /<Unrecorded>No passages indexed<\/Unrecorded>/,
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
