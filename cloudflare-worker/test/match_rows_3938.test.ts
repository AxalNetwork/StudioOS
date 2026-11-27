// #3938 part 2 (D1478 task 4, §4.2 fix 15) — a match row: retrieve, rank, then one line.
//
//   1. Retrieve keeps the nearest by cosine; rank reorders those; write gives one line per kept row.
//   2. Each step degrades on its own: unreadable embeddings keep the candidates' order, a refused
//      rank keeps retrieval's, a missing line is null — never an invented reason.
//   3. A member-facing refusal stops the press (it is thrown, never swallowed).
//   4. The four jobs read their models from the plan: bge-m3 to retrieve, llama-3.2-3b to write.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/match_rows_3938.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchRefused, RECALL, cosine, jobModels, matchRows, readLines, type MatchDeps } from '../src/services/ai/matchRows.ts';

/** A tiny embedding: how often each of four words appears. */
const WORDS = ['logistics', 'design', 'finance', 'legal'];
const vec = (t: string) => WORDS.map((w) => (t.toLowerCase().split(w).length - 1) + 0.001);

function deps(o: { embed?: 'ok' | 'fail'; rank?: number[] | null; write?: string | null } = {}) {
  const calls = { embed: 0, rerank: [] as string[][], write: [] as string[] };
  const d: MatchDeps = {
    async embed(text) { calls.embed += 1; return o.embed === 'fail' ? null : vec(text); },
    async rerank(_q, contexts) { calls.rerank.push(contexts); return o.rank === null ? null : (o.rank ?? contexts.map((_, i) => i)).map((index, i) => ({ index, score: 1 - i / 10 })); },
    async write(prompt) { calls.write.push(prompt); return o.write === undefined ? '1. First line.\n2. Second line.' : o.write; },
  };
  return { d, calls };
}
const C = [
  { key: 'a', text: 'A design studio' },
  { key: 'b', text: 'A logistics operator running logistics fleets' },
  { key: 'c', text: 'A finance team' },
];

test('#3938: retrieve by cosine, rank, then one line per kept row', async () => {
  const { d, calls } = deps({ rank: [1, 0] });
  const r = await matchRows('logistics', C, d, { top: 2 });
  assert.deepEqual(r.steps, { retrieved: true, ranked: true, written: true });
  // Retrieval put b first (logistics); the reranker swapped the first two.
  assert.equal(calls.rerank[0][0], 'A logistics operator running logistics fleets', 'retrieval ordered by cosine before the rank');
  // Mutation checked: the ranking ignored (`ordered = recalled`) → b stays first and this fails.
  assert.deepEqual(r.rows.map((x) => [x.key, x.position, x.line]), [['a', 1, 'First line.'], ['b', 2, 'Second line.']]);
  assert.equal(calls.embed, 4, 'the query and each candidate');
  assert.match(calls.write[0], /What the member is looking for: logistics/);
});

test('#3938: retrieval keeps the RECALL nearest, and only those are ranked', async () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ key: `k${i}`, text: i < 5 ? 'logistics logistics' : 'design' }));
  const { d, calls } = deps();
  await matchRows('logistics', many, d, { top: 5 });
  // Mutation checked: no recall cut → all 45 go to the reranker and this fails.
  assert.equal(calls.rerank[0].length, RECALL);
  assert.ok(calls.rerank[0].slice(0, 5).every((t) => t === 'logistics logistics'), 'the nearest first');
});

test('#3938: each step degrades on its own, and a missing line is null, never invented', async () => {
  const noEmbed = deps({ embed: 'fail' });
  const a = await matchRows('logistics', C, noEmbed.d);
  assert.deepEqual(a.steps.retrieved, false);
  assert.deepEqual(noEmbed.calls.rerank[0], C.map((c) => c.text), 'the candidates\' own order goes to the reranker');
  const noRank = deps({ rank: null });
  const b = await matchRows('logistics', C, noRank.d);
  assert.deepEqual([b.steps.retrieved, b.steps.ranked], [true, false]);
  assert.equal(b.rows[0].key, 'b', 'retrieval\'s order stands');
  const noWrite = deps({ write: null });
  const w = await matchRows('logistics', C, noWrite.d);
  assert.deepEqual([w.steps.written, w.rows.map((x) => x.line)], [false, [null, null, null]]);
  const partial = deps({ write: '2. Only the second.' });
  // Mutation checked: `readLines` filling a gap with the next line → row 1 gets a line and this fails.
  assert.deepEqual((await matchRows('logistics', C, partial.d)).rows.map((x) => x.line), [null, 'Only the second.', null]);
  assert.deepEqual((await matchRows('', C, deps().d)).rows, [], 'no query, no run');
  assert.deepEqual((await matchRows('x', [], deps().d)).rows, [], 'nothing to match, no run');
});

test('#3938: a member-facing refusal stops the press', async () => {
  const { d } = deps();
  d.embed = async () => { throw new MatchRefused({ ok: false, refusal: 'assist_off', error: 'off' } as any); };
  // Mutation checked: matchRows catching the throw → the press answers rows and this fails.
  await assert.rejects(matchRows('logistics', C, d), MatchRefused);
});

test('#3938: the reader, the cosine, and the plan\'s models for the four jobs', () => {
  assert.deepEqual(readLines('1. One.\n2) Two.\nnoise\n3.   \n9. Out of range', 3), ['One.', 'Two.', null]);
  assert.deepEqual(readLines(null, 2), [null, null]);
  assert.equal(readLines(`1. ${'x'.repeat(400)}`, 1)[0]!.length, 160);
  assert.ok(cosine([1, 0], [1, 0]) > cosine([1, 0], [0, 1]));
  assert.equal(cosine([1], [1, 2]), -Infinity, 'mismatched dimensions never match');
  for (const job of ['NE1', 'GR4', 'RA11', 'LE10'] as const) {
    assert.deepEqual(jobModels(job), { retrieve: '@cf/baai/bge-m3', write: '@cf/meta/llama-3.2-3b-instruct' }, job);
  }
});
