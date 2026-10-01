/**
 * No citation, no fill. What that costs, and what it refuses.
 *
 * A `restatement` is anchored: the tagger refuses a phrase the project does not
 * already contain, so the evidence exists before the proposal does. TAM has no
 * such anchor, and the replacement the product chose is a citation — so this file
 * is where the replacement is actually checked, because a guarantee that holds
 * only when the model cooperates is not a guarantee.
 *
 * THE CASES THAT MATTER ARE THE REFUSALS. A citation that comes back empty, or
 * cites a document with no passage, or names a source with no sentence behind it,
 * is worse than no citation at all: it borrows a source's authority without
 * accepting the check that authority rests on. Every one of those is silent —
 * the figure looks exactly like a well-sourced one — which is why they are pinned
 * here rather than left to review.
 *
 * AND ONE BUG THIS FILE FOUND. `SearchHit.chunk` has been declared "for a
 * citation" since the research library shipped and `upsertEntity` has always
 * written `metadata.chunk`, but `searchSemantic`'s mapping dropped it — so
 * `routes/research.ts` recorded `chunk: null` on every Ask citation it ever
 * wrote. The last test here is that regression.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/fill_citations.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CITE_SCORE_FLOOR, MAX_QUOTE, MIN_QUOTE,
  citeFromLibrary, citeFromResearch, citeFor,
} from '../src/services/fills/citations.ts';
import { refuseReason } from '../src/services/fills/types.ts';
import { fillKind } from '../src/services/fills/registry.ts';
import { searchSemantic, researchNamespace } from '../src/services/vectorize.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, '..', p), 'utf8');

const USER = 91;
const LONG = 'The addressable European mid-market was 41,200 firms at the end of 2025.';

/**
 * A Vectorize stand-in, and an AI stand-in, recording what they were asked.
 *
 * The calls are what several of these tests are about — a fill must not be able
 * to query documents Ask cannot, and it must not spend a model call on a question
 * the founder's own library already answers — so the fake keeps the arguments
 * rather than only the answers.
 */
function fakeEnv(opts: {
  matches?: any[];
  aiOutput?: string | null;
  aiOk?: boolean;
  aiModel?: string | null;
  vectorizeThrows?: boolean;
} = {}) {
  const calls: { vectorize: any[]; ai: any[] } = { vectorize: [], ai: [] };
  const env: any = {
    AI: {
      async run(model: string, args: any) {
        // `embedText` asks for a 768-wide vector and refuses anything else.
        if (String(model).includes('bge')) return { data: [new Array(768).fill(0.1)] };
        calls.ai.push({ model, args });
        return { response: opts.aiOutput ?? '' };
      },
    },
    VECTORIZE: {
      async query(_vector: number[], args: any) {
        calls.vectorize.push(args);
        if (opts.vectorizeThrows) throw new Error('index unavailable');
        return { matches: opts.matches ?? [] };
      },
    },
    DB: {
      prepare() {
        const api: any = {
          bind: () => api,
          async first() { return null; },
          async all() { return { results: [] }; },
          async run() { return { meta: { last_row_id: 0, changes: 0 } }; },
        };
        return api;
      },
      async exec() { return { count: 0, duration: 0 }; },
      async batch() { return []; },
    },
  };
  return { env, calls };
}

/**
 * One library hit, in the shape Vectorize returns it.
 *
 * `metadata` is MERGED rather than replaced. The first version of this helper
 * spread the override at the top level after building metadata, so
 * `hit({ metadata: { chunk: 0 } })` silently dropped `entity_id`,
 * `owner_user_id` and the snippet — and four tests failed for a reason that had
 * nothing to do with the code they were checking.
 */
const hit = (over: { metadata?: Record<string, unknown> } & Record<string, unknown> = {}) => {
  const { metadata, ...rest } = over;
  return {
    id: 'research_doc:41:3',
    score: 0.82,
    ...rest,
    metadata: {
      type: 'research_doc', entity_id: 41, title: 'European mid-market sizing',
      snippet: LONG, owner_user_id: USER, chunk: 3,
      ...(metadata || {}),
    },
  };
};

test('a library hit becomes a citation naming the document, the chunk and the passage', async () => {
  const { env, calls } = fakeEnv({ matches: [hit()] });
  const c = await citeFromLibrary(env, USER, 'how many mid-market firms in Europe');
  assert.ok(c, 'a strong library hit produced no citation');
  assert.equal(c!.kind, 'library');
  assert.equal((c as any).document_id, 41);
  assert.equal((c as any).chunk, 3, 'the passage is cited without saying which passage');
  assert.equal((c as any).quote, LONG);
  assert.equal((c as any).title, 'European mid-market sizing');
  // And it survives the write-path check, or nothing above matters.
  const sourced = { ...fillKind('hypothesis')!, fillClass: 'sourced' as const };
  assert.equal(refuseReason(sourced, {
    payload: {}, targetRef: 'projects.tam', readable: '41200', citation: c!,
  }), null);

  // THE QUERY IS SCOPED THE WAY ASK SCOPES IT — all three layers, not two.
  // `type` is what stops the owner-private default dropping every hit, and the
  // namespace is what keeps one account's documents out of another's fill.
  assert.equal(calls.vectorize.length, 1);
  assert.deepEqual(calls.vectorize[0].filter, { type: 'research_doc' });
  assert.equal(calls.vectorize[0].namespace, researchNamespace(USER));
});

test('chunk 0 is cited as 0, not reported as absent', async () => {
  // The first chunk of a document is the most likely one to be cited, and `||`
  // instead of `??` would silently renumber it.
  const { env } = fakeEnv({ matches: [hit({ id: 'research_doc:41:0', metadata: { chunk: 0 } })] });
  const c = await citeFromLibrary(env, USER, 'anything');
  assert.equal((c as any).chunk, 0);
});

test('a hit below the floor Ask itself uses is not a citation', async () => {
  // THE FLOOR IS ASK'S FLOOR, READ FROM ASK. Asserting only that
  // `CITE_SCORE_FLOOR - 0.01` is refused pins nothing, because both sides of the
  // comparison move when the constant does — loosening it to 0.30 passed that
  // version of this test. What matters is the number, and that it is the SAME
  // number: `routes/research.ts` tells a reader the library had nothing close
  // enough below 0.55, and a fill citing a 0.30 match would be claiming support
  // Ask would have declined to claim, from the same documents, over the same
  // index. Two numbers for one judgement, with the looser one deciding what gets
  // written into `projects.tam`.
  const asks = read('src/routes/research.ts').match(/^const SCORE_FLOOR = ([\d.]+);$/m);
  assert.ok(asks, 'Ask no longer declares a score floor this can be compared against');
  assert.equal(CITE_SCORE_FLOOR, Number(asks![1]),
    `a fill cites at ${CITE_SCORE_FLOOR} where Ask refuses to answer below ${asks![1]}`);

  const { env } = fakeEnv({ matches: [hit({ score: CITE_SCORE_FLOOR - 0.01 })] });
  assert.equal(await citeFromLibrary(env, USER, 'anything'), null);
  const { env: ok } = fakeEnv({ matches: [hit({ score: CITE_SCORE_FLOOR })] });
  assert.ok(await citeFromLibrary(ok, USER, 'anything'), 'the floor itself must pass');
});

test('a hit with no passage cites nothing, however strong it is', async () => {
  for (const snippet of ['', '   ', '42%']) {
    const { env } = fakeEnv({ matches: [hit({ score: 0.99, metadata: { snippet } })] });
    assert.equal(
      await citeFromLibrary(env, USER, 'anything'), null,
      `a hit whose passage is ${JSON.stringify(snippet)} was cited anyway`,
    );
  }
  // The floor is a floor, not a ban: one character over it passes.
  const { env } = fakeEnv({ matches: [hit({ metadata: { snippet: 'x'.repeat(MIN_QUOTE) } })] });
  assert.ok(await citeFromLibrary(env, USER, 'anything'));
});

test('a passage longer than the cap is cut, not dropped', async () => {
  const { env } = fakeEnv({ matches: [hit({ metadata: { snippet: 'y'.repeat(MAX_QUOTE + 200) } })] });
  const c = await citeFromLibrary(env, USER, 'anything');
  assert.equal((c as any).quote.length, MAX_QUOTE);
});

test('an unavailable index is no citation rather than a thrown fill', async () => {
  // The propose run has already cost a model call by the time this is asked. A
  // throw here would lose it and return a 500 for an index problem.
  const { env } = fakeEnv({ vectorizeThrows: true });
  assert.equal(await citeFromLibrary(env, USER, 'anything'), null);
  const { env: none } = fakeEnv({ matches: [] });
  assert.equal(await citeFromLibrary(none, USER, 'anything'), null);
  // An empty question is not a search worth running.
  assert.equal(await citeFromLibrary(none, USER, '   '), null);
});

test('a research reply naming both a source and a sentence becomes a citation', async () => {
  const { env } = fakeEnv({
    aiOutput: `Here you go: {"source": "Eurostat SBS 2025", "quote": "${LONG}"}`,
  });
  const { citation, model } = await citeFromResearch(env, USER, 'how many mid-market firms');
  assert.ok(citation, 'a well-formed research reply produced no citation');
  assert.equal(citation!.kind, 'research');
  assert.equal((citation as any).source, 'Eurostat SBS 2025');
  assert.equal((citation as any).query, 'how many mid-market firms',
    'the question is not kept, so a reader cannot see what was asked');
  assert.equal((citation as any).task, 'research_ask');
  // THE MODEL THAT RAN, for the provenance row — the router's own `usage.model`,
  // not the one this code asked for. A fill's provenance naming a model that
  // never saw the question is the same class of lie as an uncited figure, and the
  // router's fallback chain makes it reachable: a 503 on the primary silently
  // answers from `SMALL_LLAMA`.
  assert.equal(typeof model, 'string', 'no model is reported, so provenance cannot name one');
  assert.match(model!, /^@cf\//, `usage.model is not a Workers AI model id: ${model}`);
  const router = read('src/services/aiRouter.ts');
  const entry = router.slice(router.indexOf('research_ask: {'));
  assert.ok(entry.slice(0, 200).includes(model!.replace('@cf/', '')) || entry.includes(model!)
    || router.includes(model!), 'the model reported is not one research_ask routes to');
});

test('a research reply missing either half cites nothing', async () => {
  // BOTH OR NEITHER. A source with no sentence asks for trust in a label; a
  // sentence with no source is an assertion in quotation marks. The model's own
  // "I have no source" reply is the last case, and it is the designed outcome
  // rather than a failure.
  const replies = [
    '{"source": "Eurostat", "quote": ""}',
    `{"source": "", "quote": "${LONG}"}`,
    '{"source": null, "quote": null}',
    `{"source": "Eurostat", "quote": "41%"}`,
    'I think it is about forty thousand firms.',
    '',
  ];
  for (const aiOutput of replies) {
    const { env } = fakeEnv({ aiOutput });
    const { citation } = await citeFromResearch(env, USER, 'a question');
    assert.equal(citation, null, `this reply was cited anyway: ${JSON.stringify(aiOutput)}`);
  }
});

test('the library is tried first, and a hit spends no model call', async () => {
  // Not a preference between equals: a library hit is a document the reader owns
  // and can open, and it costs an embedding rather than a generation.
  const { env, calls } = fakeEnv({ matches: [hit()], aiOutput: '{"source":"s","quote":"q"}' });
  const { citation } = await citeFor(env, USER, 'a question');
  assert.equal(citation!.kind, 'library');
  assert.equal(calls.ai.length, 0, 'a library hit still spent a research call');

  // And with nothing in the library, the call is what answers.
  const { env: empty, calls: c2 } = fakeEnv({
    matches: [], aiOutput: `{"source": "Eurostat", "quote": "${LONG}"}`,
  });
  const second = await citeFor(empty, USER, 'a question');
  assert.equal(second.citation!.kind, 'research');
  assert.equal(c2.ai.length, 1, 'the research call did not run when the library was empty');

  // Neither: null, and the proposal is dropped by `refuseReason`.
  const { env: nothing } = fakeEnv({ matches: [], aiOutput: '{"source": null, "quote": null}' });
  const third = await citeFor(nothing, USER, 'a question');
  assert.equal(third.citation, null);
  const sourced = { ...fillKind('hypothesis')!, fillClass: 'sourced' as const };
  assert.match(
    String(refuseReason(sourced, { payload: {}, targetRef: 'projects.tam', readable: '1' })),
    /no citation/,
    'an uncitable sourced proposal is not refused, so it would be written',
  );
});

test('the research prompt forbids inventing a source', async () => {
  // The one instruction this path cannot do without. A model that invents a
  // report title produces a citation that passes every structural check here and
  // is a fabrication — the check a reader makes is the only one left, and it
  // only works if what they are handed is real.
  const src = read('src/services/fills/citations.ts');
  assert.match(src, /Never invent a publication, a report title, a date or a URL\./);
  assert.match(src, /reply exactly \{"source": null, "quote": null\}/,
    'the model is given no way to say it has no source');
});

test('searchSemantic returns the chunk it was given — the Ask citation regression', async () => {
  // `upsertEntity` writes `metadata.chunk` for every chunked document and
  // `SearchHit.chunk` is documented "for a citation", but the mapping dropped it,
  // so `routes/research.ts` recorded `chunk: null` on every citation in both its
  // answered and model-unavailable paths. A citation that names a document and
  // not the passage asks a reader to take the label on trust.
  const { env } = fakeEnv({ matches: [hit()] });
  const hits = await searchSemantic(env, 'q', {
    type: 'research_doc', namespace: researchNamespace(USER), ownerUserId: USER,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].chunk, 3, 'the chunk is dropped again, so Ask cites documents and not passages');
  assert.equal(hits[0].entity_id, 41, 'a chunk id no longer degrades to its document');

  // A vector written before metadata carried the chunk still cites one, from its
  // own id — which is why `chunkVectorId` puts it there.
  const { env: fromId } = fakeEnv({
    matches: [hit({ metadata: { chunk: undefined } })],
  });
  const second = await searchSemantic(fromId, 'q', {
    type: 'research_doc', namespace: researchNamespace(USER), ownerUserId: USER,
  });
  assert.equal(second[0].chunk, 3, 'the id fallback does not recover the chunk');

  // An unchunked entity has no chunk to report, and must not invent 0.
  const { env: whole } = fakeEnv({
    matches: [{
      id: 'project:7', score: 0.9,
      metadata: { type: 'project', entity_id: 7, title: 'A venture', snippet: LONG },
    }],
  });
  const third = await searchSemantic(whole, 'q', { type: 'project' });
  assert.equal(third[0].chunk, undefined, 'a whole-entity hit claims to be a chunk');

  // And the reader of it still reads it.
  const research = read('src/routes/research.ts');
  assert.match(research, /chunk: h\.chunk \?\? null/,
    'the Ask citation no longer carries the chunk it retrieved');
});
