/** D4483 (#4483) — detail, filter and creative clients preserve scope and encode identifiers/text. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';
test('campaign additions encode path/query and keep project authoritative', async () => {
  const calls = [];
  const { grow } = makeCycleWrites((...args) => { calls.push(args); return Promise.resolve({}); });
  await grow.campaigns(7, { status: 'paused', q: '50% & launch', project: 8 });
  await grow.campaignDetail(7, 'c/1');
  await grow.campaignCreatives(7, 'c/1');
  await grow.campaignCreative(7, 'c/1', 'meta/feed', 'head/line', '<script>plain text</script>');
  assert.deepEqual(calls, [
    ['/cycles/grow/campaigns?status=paused&q=50%25+%26+launch&project=7'],
    ['/cycles/grow/campaigns/c%2F1?project=7'],
    ['/cycles/grow/campaigns/c%2F1/creatives?project=7'],
    ['/cycles/grow/campaigns/c%2F1/creatives/meta%2Ffeed/head%2Fline', { method:'PUT', body:JSON.stringify({ project:7, text:'<script>plain text</script>' }) }],
  ]);
});
