// D6170 (#6170) — Deal Overview "What's new" names every change type the
// Worker sends. No row reads "Something changed" for a type
// `GET /api/deals/:id/whats-new` sends today, and a type added later without a
// sentence fails here.
//
// This frontend test reads `cloudflare-worker/src/routes/deal_context.ts` AS
// TEXT: it takes the `sources` list of the whats-new handler (each
// `type: '<name>'` and the quoted names of the per-fact list) and compares it
// with `CHANGE_WORDS`. If the handler's shape changes so that no type can be
// read, the test fails rather than passing on an empty list.
//
// Run with:
//   node --test frontend/test/deal_whats_new_words_6170.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGE_WORDS, whatsNewOf } from '../src/pages/deal/dealFrameModel.js';

const route = readFileSync(new URL('../../cloudflare-worker/src/routes/deal_context.ts', import.meta.url), 'utf8');

function workerTypes() {
  const handler = route.slice(route.indexOf("r.get('/:id/whats-new'"));
  const start = handler.indexOf('const sources = [');
  assert.ok(start >= 0, 'the whats-new handler builds a `sources` list');
  const block = handler.slice(start, handler.indexOf('\n    ];', start));
  const types = [...block.matchAll(/type: '([a-z0-9_]+)'/g)].map((m) => m[1]);
  const facts = block.match(/\.\.\.\[([^\]]+)\]\.flatMap/);
  assert.ok(facts, 'the per-fact type list is readable');
  types.push(...[...facts[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
  return [...new Set(types)].sort();
}

test('the Worker list and the page list are the same types', () => {
  const sent = workerTypes();
  assert.ok(sent.length >= 13, `read ${sent.length} types from deal_context.ts`);
  assert.deepEqual(Object.keys(CHANGE_WORDS).sort(), sent);
});

test('no type the Worker sends is drawn as "Something changed"', () => {
  const changes = workerTypes().map((type) => ({ type, at: '2026-11-14T10:00:00Z' }));
  const w = whatsNewOf({ status: 'ready', data: { since: '2026-11-01T00:00:00Z', changes } });
  assert.equal(w.rows.length, changes.length);
  for (const row of w.rows) {
    assert.notEqual(row.text, 'Something changed');
    assert.ok(row.text.trim().length > 0);
  }
  assert.equal(new Set(w.rows.map((r) => r.text)).size, changes.length, 'each type has its own sentence');
});

test('the sentences name no investor and no amount', () => {
  for (const [type, text] of Object.entries(CHANGE_WORDS)) {
    assert.doesNotMatch(text, /[$€£¥]|\d/, `${type} carries no figure`);
    assert.doesNotMatch(text, /\{/, `${type} interpolates nothing`);
  }
  assert.equal(CHANGE_WORDS.investor_commitment, 'An investor committed');
});

test('a type the page does not know still falls back', () => {
  const w = whatsNewOf({ status: 'ready', data: { since: null, changes: [{ type: 'not_a_type', at: null }] } });
  assert.deepEqual(w.rows, [{ text: 'Something changed', at: 'Date not recorded' }]);
});
