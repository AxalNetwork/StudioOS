/**
 * Unit tests for the tail-consumer topology guard
 * (scripts/check-tail-consumer.mjs). Exercises the pure
 * `collectTailConsumerErrors(rootText, tailText)` evaluator with in-memory
 * wrangler.toml fixtures — no filesystem or process.exit involved.
 *
 * Run:
 *   node --test cloudflare-worker/test/check-tail-consumer.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTailConsumerErrors } from '../../scripts/check-tail-consumer.mjs';

// Consumer worker config that correctly declares NO tail-consumer table.
const TAIL_OK = `name = "studioos-tail"\nmain = "src/index.ts"\n`;

// Canonical root config: studioos-tail under both required tables.
const ROOT_OK = `
[[tail_consumers]]
service = "studioos-tail"

[[env.production.tail_consumers]]
service = "studioos-tail"
`;

test('passes on the canonical single-table root config', () => {
  assert.deepEqual(collectTailConsumerErrors(ROOT_OK, TAIL_OK), []);
});

test('passes when a second tail consumer is ordered BEFORE studioos-tail (regression for .find())', () => {
  // The previous `.find()` logic only inspected the FIRST [[tail_consumers]]
  // table; an additional consumer ordered first would false-positive. The
  // all-tables scan must still detect studioos-tail in a later table.
  const root = `
[[tail_consumers]]
service = "some-other-consumer"

[[tail_consumers]]
service = "studioos-tail"

[[env.production.tail_consumers]]
service = "some-other-consumer"

[[env.production.tail_consumers]]
service = "studioos-tail"
`;
  assert.deepEqual(collectTailConsumerErrors(root, TAIL_OK), []);
});

test('fails when studioos-tail is dropped from the top-level [[tail_consumers]]', () => {
  const root = `
[[tail_consumers]]
service = "some-other-consumer"

[[env.production.tail_consumers]]
service = "studioos-tail"
`;
  const errs = collectTailConsumerErrors(root, TAIL_OK);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /top-level \[\[tail_consumers\]\]/);
});

test('fails when studioos-tail is dropped from [[env.production.tail_consumers]]', () => {
  const root = `
[[tail_consumers]]
service = "studioos-tail"

[[env.production.tail_consumers]]
service = "some-other-consumer"
`;
  const errs = collectTailConsumerErrors(root, TAIL_OK);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /env\.production\.tail_consumers/);
});

test('fails when the consumer worker declares a tail-consumer table (reverse binding)', () => {
  const tail = `
name = "studioos-tail"

[[tail_consumers]]
service = "studioos"
`;
  const errs = collectTailConsumerErrors(ROOT_OK, tail);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /must NEVER be a tail/);
});
