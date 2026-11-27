/**
 * One account's research documents must never reach another account's search.
 *
 * THE MISTAKE THIS EXISTS TO CATCH LOOKS EXACTLY LIKE DOING IT RIGHT.
 * `routes/search.ts` used to read `const VALID_TYPES = ALL_ENTITY_TYPES`, and
 * the hourly sweep in `index.ts` iterates that same array to decide what to
 * re-index. So the obvious, correct-looking edit for a new type — add it to
 * `ALL_ENTITY_TYPES` so it gets indexed — also published it to every user's
 * global search box, in the same line. For `research_doc`, whose vector
 * snippet is the document's own text, that is a cross-account disclosure with
 * no link to follow first.
 *
 * WHY THE ISOLATION IS THREE LAYERS AND NOT ONE. `search.ts` has an
 * everything-is-allowed shortcut: a caller who may see every type queries with
 * no type filter AND no namespace. Whether a namespace-less Vectorize query
 * returns namespaced vectors decides whether that path leaks — and that is a
 * vendor behaviour, not ours. So the design does not rest on it. These tests
 * cover the two layers that are ours: the type filter and the owner re-check.
 * They are written against a fake VECTORIZE that deliberately IGNORES the
 * namespace — modelling the worst case, where layer 2 does nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchSemantic, ALL_ENTITY_TYPES } from '../src/services/vectorize.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/**
 * A VECTORIZE stand-in that returns every stored vector regardless of the
 * namespace or filter it was asked for. This is the point: if the code only
 * worked because Vectorize partitioned for it, these tests fail.
 */
function makeEnv(vectors: Array<{ id: string; metadata: Record<string, unknown> }>) {
  return {
    AI: {
      // EXACTLY 768 DIMENSIONS OR NOTHING WORKS, and silently. `embedText`
      // rejects any other length and returns null, which makes `searchSemantic`
      // return [] — so a too-short vector here would make every "must return
      // nothing" test below pass while proving nothing. It did, on the first
      // run of this file: two tests were green against a filter that had never
      // executed. The control test at the bottom exists to stop that recurring.
      run: async () => ({ data: [Array.from({ length: 768 }, () => 0.01)] }),
    },
    VECTORIZE: {
      query: async () => ({
        matches: vectors.map((v) => ({ id: v.id, score: 0.9, metadata: v.metadata })),
      }),
      upsert: async () => ({}),
      deleteByIds: async () => ({}),
    },
  } as any;
}

const docOf = (id: number, owner: number, chunk = 0) => ({
  id: `research_doc:${id}:${chunk}`,
  metadata: {
    type: 'research_doc', entity_id: id, owner_user_id: owner, chunk,
    title: `doc ${id}`, url: `/research/library#${id}`,
    snippet: `SECRET BODY TEXT OF DOCUMENT ${id}`,
  },
});
const projectOf = (id: number) => ({
  id: `project:${id}`,
  metadata: { type: 'project', entity_id: id, title: `project ${id}`, url: `/projects/${id}`, snippet: 'public' },
});

test('a search that does not ask for research_doc never returns one', async () => {
  // THE ADMIN PATH. `search.ts` queries with no type and no namespace when the
  // caller may see everything. Without layer 1 this returns the document.
  const env = makeEnv([docOf(1, 100), projectOf(7)]);
  const hits = await searchSemantic(env, 'anything', { topK: 10 });
  assert.deepEqual(hits.map((h) => h.type), ['project'],
    'an unfiltered search returned a research document');
  assert.ok(!JSON.stringify(hits).includes('SECRET BODY TEXT'),
    'document body text reached a caller who did not ask for documents');
});

test('a general search that DOES name an owner still surfaces no documents', async () => {
  // THIS ISOLATES LAYER 1, and without it layer 1 is untested: every other
  // case here is also caught by the owner re-check, so deleting the type
  // filter entirely left the suite green (mutation V1). Here the owner check
  // is satisfied — the caller names owner 100 and the document belongs to 100
  // — so only the type filter can reject it.
  //
  // The rule it pins: a private document does not belong in a general result
  // set even for its own owner. Global search renders snippets in the cmd-K
  // palette, and for this type the snippet IS the document's body. A future
  // caller that starts passing `ownerUserId` into a general search must not
  // quietly turn that palette into a document reader.
  const env = makeEnv([docOf(1, 100), projectOf(7)]);
  const hits = await searchSemantic(env, 'anything', { topK: 10, ownerUserId: 100 });
  assert.deepEqual(hits.map((h) => h.type), ['project'],
    'a document surfaced in a search that never asked for documents');
});

test('asking for research_doc without naming an owner returns nothing', async () => {
  // Layer 3 is not optional: a caller that names the type but forgets the
  // owner gets an empty result, not everybody's documents.
  const env = makeEnv([docOf(1, 100), docOf(2, 200)]);
  const hits = await searchSemantic(env, 'anything', { topK: 10, type: 'research_doc' });
  assert.deepEqual(hits, [], 'research_doc was searchable without an owner check');
});

test('one owner never sees another owner’s document', async () => {
  const env = makeEnv([docOf(1, 100), docOf(2, 200), docOf(3, 100)]);
  const hits = await searchSemantic(env, 'anything', {
    topK: 10, type: 'research_doc', namespace: 'research:u100', ownerUserId: 100,
  });
  assert.deepEqual(hits.map((h) => h.entity_id).sort(), [1, 3],
    'the wrong owner’s document came back — and the fake ignores namespaces on purpose');
  assert.ok(!JSON.stringify(hits).includes('DOCUMENT 2'), 'another owner’s body text leaked');
});

test('a research vector with no owner recorded is dropped, not treated as public', async () => {
  // A malformed or half-migrated vector must fail closed. Treating a missing
  // owner as "belongs to nobody, so show everyone" is the wrong default and
  // the easy one to write.
  const env = makeEnv([{
    id: 'research_doc:9:0',
    metadata: { type: 'research_doc', entity_id: 9, title: 'orphan', url: '/x', snippet: 'ORPHAN BODY' },
  }]);
  const hits = await searchSemantic(env, 'anything', {
    topK: 10, type: 'research_doc', namespace: 'research:u100', ownerUserId: 100,
  });
  assert.deepEqual(hits, [], 'a vector with no owner_user_id was returned to a caller');
});

test('the sweep list and the searchable list are different, and differ exactly here', () => {
  // The structural half of the guard. Even if the runtime filters above were
  // somehow satisfied, putting the type back into search.ts's list would
  // expose it, so both directions are pinned.
  assert.ok(ALL_ENTITY_TYPES.includes('research_doc' as any),
    'research_doc must be swept, or documents are never indexed and Ask is always empty');

  const searchSrc = read('../src/routes/search.ts');
  // ANCHOR ON THE DECLARATION, TYPE ANNOTATION AND ALL. The first draft
  // searched for `const VALID_TYPES` and matched the docblock ABOVE it, which
  // quotes the old `const VALID_TYPES = ALL_ENTITY_TYPES` line and discusses
  // research_doc at length — so the slice began in prose and every assertion
  // below fired on the comment explaining why they exist. The annotated form
  // appears only in code.
  const start = searchSrc.indexOf('const VALID_TYPES: EntityType[] = [');
  const end = searchSrc.indexOf('];', start);
  assert.ok(start > -1 && end > start, 'VALID_TYPES is gone or is no longer an array literal');
  const list = searchSrc.slice(start, end);
  assert.ok(!list.includes('research_doc'),
    'research_doc is in global search’s type list — every user’s documents are searchable by every other user');
  assert.ok(!list.includes('ALL_ENTITY_TYPES'),
    'VALID_TYPES was pointed back at ALL_ENTITY_TYPES, which re-merges the two lists');

  // And the import that would let it re-converge silently.
  assert.ok(!/^import .*\bALL_ENTITY_TYPES\b.*from '\.\.\/services\/vectorize'/m.test(searchSrc),
    'search.ts imports ALL_ENTITY_TYPES again');
});

test('CONTROL — the fake actually returns hits, so the tests above mean something', async () => {
  // Every isolation test above asserts that something does NOT come back, and
  // all of them pass trivially if the search returns [] for an unrelated
  // reason. That is not hypothetical: on this file's first run the fake AI
  // returned a 3-dimension vector, `embedText` rejected it as malformed, and
  // two tests went green having never reached the filter.
  //
  // This proves the pipe is open: same fake, a type with no owner rules, one
  // hit expected.
  const env = makeEnv([projectOf(7)]);
  const hits = await searchSemantic(env, 'anything', { topK: 10 });
  assert.equal(hits.length, 1, 'the fake returns nothing at all — every assertion above is vacuous');
  assert.equal(hits[0].type, 'project');

  // And the owner-scoped path returns something too, so "one owner sees their
  // own documents" is proven as well as "they do not see anyone else's".
  const mine = makeEnv([docOf(1, 100)]);
  const ownHits = await searchSemantic(mine, 'anything', {
    topK: 10, type: 'research_doc', namespace: 'research:u100', ownerUserId: 100,
  });
  assert.equal(ownHits.length, 1, 'an owner cannot read their own document — the filter is too strict');
  assert.equal(ownHits[0].entity_id, 1);
});
