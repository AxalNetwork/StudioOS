/** D4464 (#4464): Network clients preserve filters and use the mounted summary read. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function client(name, exported) {
  const calls = [];
  const source = readFileSync(new URL(`../src/lib/api/${name}.js`, import.meta.url), 'utf8')
    .replace(/import \{ request \} from '\.\.\/api\.js';/, '')
    .replace(`export const ${exported}`, `const ${exported}`);
  const api = Function('request', `${source}; return ${exported};`)((...args) => { calls.push(args); });
  return { api, calls };
}

test('book keeps the existing arguments and forwards source and follow-up independently and together', () => {
  const { api, calls } = client('contacts', 'contactsBookApi');
  api.book();
  api.book('A & B', 2, { source: 'csv', follow_up: 'open' });
  api.book('', 1, { source: 'typed' });
  api.book('', 1, { follow_up: 'open' });
  assert.equal(calls[0][0], '/contacts/book?');
  assert.deepEqual(Object.fromEntries(new URL(calls[1][0], 'https://example.invalid').searchParams), { source: 'csv', follow_up: 'open', q: 'A & B', page: '2' });
  assert.equal(calls[2][0], '/contacts/book?source=typed');
  assert.equal(calls[3][0], '/contacts/book?follow_up=open');
});

test('summary is an authenticated client read of the mounted route', () => {
  const { api, calls } = client('relationships', 'relationshipsApi');
  api.summary();
  assert.deepEqual(calls, [['/relationships/summary']]);
});
