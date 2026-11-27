/** D4447 (#4447) — Grow campaign client requests use mounted routes and encode every path segment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

test('eight campaign client calls preserve project, bodies, methods and encoded identifiers', async () => {
  const calls = [];
  const api = makeCycleWrites((...args) => { calls.push(args); return Promise.resolve({ ok: true }); });
  const grow = api.grow;
  await grow.campaigns(7);
  await grow.campaign(7, { project: 8, name: 'Launch', goal: 'sales' });
  await grow.campaignUpdate(7, 'c/1', { status: 'active' });
  await grow.campaignChannel(7, 'c/1', 'ch/1', { planned_budget_cents: null });
  await grow.campaignChannelRemove(7, 'c/1', 'ch/1');
  await grow.campaignItem(7, 'c/1', { kind: 'content_item', uid: 'piece' });
  await grow.campaignItemRemove(7, 'c/1', 'content_item', 'piece/1');
  await grow.campaignArchive(7, 'c/1');
  assert.deepEqual(calls, [
    ['/cycles/grow/campaigns?project=7'],
    ['/cycles/grow/campaigns', { method: 'POST', body: JSON.stringify({ project: 7, name: 'Launch', goal: 'sales' }) }],
    ['/cycles/grow/campaigns/c%2F1', { method: 'PATCH', body: JSON.stringify({ status: 'active', project: 7 }) }],
    ['/cycles/grow/campaigns/c%2F1/channels/ch%2F1', { method: 'PUT', body: JSON.stringify({ planned_budget_cents: null, project: 7 }) }],
    ['/cycles/grow/campaigns/c%2F1/channels/ch%2F1', { method: 'DELETE', body: JSON.stringify({ project: 7 }) }],
    ['/cycles/grow/campaigns/c%2F1/items', { method: 'POST', body: JSON.stringify({ kind: 'content_item', uid: 'piece', project: 7 }) }],
    ['/cycles/grow/campaigns/c%2F1/items/content_item/piece%2F1', { method: 'DELETE', body: JSON.stringify({ project: 7 }) }],
    ['/cycles/grow/campaigns/c%2F1', { method: 'DELETE', body: JSON.stringify({ project: 7 }) }],
  ]);
});
