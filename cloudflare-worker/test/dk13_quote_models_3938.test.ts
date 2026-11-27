/**
 * #3938 part 7 (D1478 task 4) — DK13 ("Grid and research agents"): the deck's
 * quote retrieval embeds and ranks with the models the plan's DK13 rows name,
 * read from the table rather than typed in the service, and the index's
 * dimensions stay those of the retrieve model.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/dk13_quote_models_3938.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUOTE_DIMENSIONS, QUOTE_EMBED_MODEL, QUOTE_RERANK_MODEL } from '../src/services/decks/quoteRetrieval.ts';
import { jobStep } from '../src/services/ai/modelUseCases.ts';

test('DK13: the quote search embeds with step 0 and ranks with step 1 of the plan', () => {
  assert.equal(jobStep('DK13', 0)?.kind, 'retrieve');
  assert.equal(jobStep('DK13', 1)?.kind, 'rank');
  assert.equal(QUOTE_EMBED_MODEL, jobStep('DK13', 0)?.default);
  assert.equal(QUOTE_RERANK_MODEL, jobStep('DK13', 1)?.default);
  assert.equal(jobStep('DK13', 1)?.fixed, true, 'the rank step is a fixed system run');
});

test('DK13: no model id is typed in the service, and the index keeps bge-m3\'s 1,024 dimensions', () => {
  const src = readFileSync(new URL('../src/services/decks/quoteRetrieval.ts', import.meta.url), 'utf8');
  assert.ok(!/export const QUOTE_(EMBED|RERANK)_MODEL = '@cf\//.test(src), 'read from the table');
  // The index was created at 1,024 dimensions for bge-m3; a plan change to another
  // retrieve model must change the index too, so this holds the pair.
  assert.equal(QUOTE_EMBED_MODEL, '@cf/baai/bge-m3');
  assert.equal(QUOTE_DIMENSIONS, 1024);
});
