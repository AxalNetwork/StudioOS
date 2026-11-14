/**
 * D770 (#2095, D720 F3), PR 3 — a run names the record it was started from.
 * The browser sends D768's record as `X-Rail-Record` (`type:id`); `railFor`
 * uses it when the route names none, and the route's own record wins.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/rail_record_d770.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { RAIL_RECORD_HEADER, railFor } from '../src/util/railContext.ts';
import { railRecordKey } from '../src/services/aiRouter.ts';

const app = new Hono();
app.get('/none', (c) => c.json(railFor(c, { page: 'research', option: 'draft:build/retro' })));
app.get('/own', (c) => c.json(railFor(c, { page: 'validate', option: 'fill:pain_tag' }, 'project:3')));
app.get('/fallback', (c) => c.json(railFor(c, { page: 'validate', option: 'ask:transcript', record: 'interview:7' })));
const get = async (path: string, record?: string) => (await app.request(path, record ? { headers: { [RAIL_RECORD_HEADER]: record } } : undefined)).json();

test('railFor takes the browser\'s record when the route names none', async () => {
  assert.equal(RAIL_RECORD_HEADER, 'X-Rail-Record');
  assert.deepEqual(await get('/none', encodeURIComponent('project:12')), { page: 'research', option: 'draft:build/retro', record: 'project:12' });
  assert.deepEqual(await get('/none'), { page: 'research', option: 'draft:build/retro', record: null }, 'no header, no record');
});

test('the route\'s own record wins over the browser\'s, as does its fallback', async () => {
  assert.equal((await get('/own', 'project:99')).record, 'project:3');
  assert.equal((await get('/fallback', 'project:99')).record, 'interview:7');
});

test('a record that breaks D762\'s rule, or does not decode, is dropped', async () => {
  for (const bad of ['has space', encodeURIComponent('a'.repeat(161)), '%E0%A4%A', encodeURIComponent('x;DROP')]) {
    assert.equal((await get('/none', bad)).record, null, bad);
  }
  assert.equal(railRecordKey('interview:41'), 'interview:41');
  assert.equal(railRecordKey('interview 41'), null);
});
