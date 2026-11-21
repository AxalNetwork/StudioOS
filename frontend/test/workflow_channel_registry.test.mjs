import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botMemberships, buildRegistry } from '../../scripts/build-workflow-slack-registry.mjs';
import catalog from '../../engineering-notifications/workflow-channels.json' with { type: 'json' };

const [first, second] = catalog.workflows.filter(row => Number.isSafeInteger(row.id));
const options = { teamId: 'TFAKE', approvedAt: '2026-01-06T12:00:00Z', reviewedBy: 'guillaumelauzier', retentionDays: 10 };
const rooms = new Map([[first.channel, 'CFAKE1'], [second.channel, 'GFAKE2']]);
const room = { id: 'CFAKE1', name: first.channel.slice(1), is_private: true, is_archived: false, is_shared: false, is_ext_shared: false, is_pending_ext_shared: false };
const auth = { ok: true, team_id: 'TFAKE', bot_id: 'BFAKE' };

test('initial registry holds routes; staged canary preserves existing roles and never rebinds silently', () => {
  const seed = buildRegistry({ ...options, rooms });
  assert.equal(seed.active, 0);
  assert.equal(seed.missing, catalog.workflows.filter(row => Number.isSafeInteger(row.id)).length - 2);
  const base = { ...seed.registry, channels: { ...seed.registry.channels, health: { id: 'CHEALTH', private: true, enabled: true, retentionDays: 90, publisher: 'internal-bot' } } };
  const canary = buildRegistry({ ...options, rooms, base, enable: [second.channel] });
  assert.equal(canary.active, 1);
  assert.deepEqual(canary.registry.channels.health, base.channels.health);
  assert.equal(canary.registry.version, base.version + 1);
  assert.equal(canary.registry.channels['workflow:' + second.id].enabled, true);
  assert.equal(buildRegistry({ ...options, rooms, base: canary.registry }).active, 1);
  assert.throws(() => buildRegistry({ ...options, rooms: new Map([[first.channel, 'COTHER']]), base }), /changed/);
  assert.throws(() => buildRegistry({ ...options, rooms, enable: ['all'] }), /membership/);
  assert.throws(() => buildRegistry({ ...options, rooms, enable: ['#other'] }), /Unknown canary/);
  assert.throws(() => buildRegistry({ ...options, rooms, base, teamId: 'TOTHER' }), /workspace/);
});

test('live lookup validates the sender workspace, walks memberships and rejects externally shared rooms', async () => {
  const api = responses => async url => {
    assert.equal(new URL(url).hostname, 'slack.com');
    const item = responses.shift();
    assert.ok(item);
    return Response.json(item);
  };
  const memberships = await botMemberships('test', 'TFAKE', api([auth,
    { ok: true, channels: [], response_metadata: { next_cursor: 'page2' } },
    { ok: true, channels: [room] },
  ]));
  assert.deepEqual(memberships, new Map([[first.channel, room.id]]));
  await assert.rejects(botMemberships('test', 'TOTHER', api([auth])), /workspace/);
  await assert.rejects(botMemberships('test', 'TFAKE', api([auth, { ok: true, channels: [{ ...room, is_ext_shared: true }] }])), /private and internal/);
});
