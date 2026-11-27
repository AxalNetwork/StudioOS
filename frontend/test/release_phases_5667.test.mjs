/**
 * From frontend/test/README.md (moved by #6472): `release_phases_5667.test.mjs` verifies
 * release/target isolation, ordered receipt selection, phase failures and the existing publication
 * relay boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { releasePhases } from '../../engineering-notifications/release-policy-5667.mjs';

const sha = 'a'.repeat(40);
const input = { releaseId: '81', target: 'production', sha };
const receipt = (phase, state, run = 10, attempt = 1) => ({
  ...input, phase, state, run, attempt, recordedAt: '2026-11-18T12:00:00Z',
});

test('out-of-order release attempts keep exact phase evidence and unknown publication', () => {
  const rows = [receipt('migration', 'success'), receipt('publish', 'failure', 10, 2), receipt('publish', 'success')];
  const forward = releasePhases({ ...input, receipts: rows });
  assert.deepEqual(forward, releasePhases({ ...input, receipts: [...rows].reverse() }));
  assert.equal(forward.phases.migration.state, 'success');
  assert.equal(forward.phases.publish.state, 'failure');
  assert.equal(forward.phases.smoke.state, 'unknown');
});

test('release identity separates tags sharing a SHA and isolates targets', () => {
  const rows = [receipt('publish', 'success'), { ...receipt('parity', 'failure'), releaseId: '82' }, { ...receipt('smoke', 'failure'), target: 'staging' }];
  const result = releasePhases({ ...input, receipts: rows });
  assert.equal(result.phases.publish.state, 'success');
  assert.equal(result.phases.parity.state, 'unknown');
  assert.equal(result.phases.smoke.state, 'unknown');
});

test('cancelled publication, failed parity, rollback and recovered smoke remain separate phases', () => {
  const result = releasePhases({ ...input, receipts: [
    receipt('publish', 'cancelled'), receipt('parity', 'failure'),
    receipt('rollback', 'success'), receipt('smoke', 'failure'), receipt('smoke', 'success', 11),
  ] });
  assert.equal(result.phases.publish.state, 'cancelled');
  assert.equal(result.phases.parity.state, 'failure');
  assert.equal(result.phases.rollback.state, 'success');
  assert.equal(result.phases.smoke.state, 'success');
});

test('contradictory authoritative receipts are refused', () => {
  assert.throws(() => releasePhases({ ...input, receipts: [receipt('publish', 'success'), receipt('publish', 'failure')] }), /conflict/);
});

test('PublicationRelay sends correlated releases to the existing outbox policy callback', async () => {
  const { normalizeEvent, eventKey } = await import('../../engineering-notifications/events-v1.mjs');
  const { withReleaseRouting } = await import('../../engineering-notifications/release-policy-5667.mjs');
  const { PublicationRelay } = await import('../../engineering-slack/relay-v1.mjs');
  const { prepare } = await import('../../engineering-slack/presentation-v1.mjs');
  const event = await normalizeEvent({
    kind: 'release', deliveryId: 'synthetic-release', observedAt: '2026-11-18T12:00:00Z',
    payload: { repository: { id: 1, full_name: 'example/project', private: false }, action: 'published',
      release: { id: 81, published_at: '2026-11-18T12:00:00Z', tag_name: 'v1' } },
  });
  // Environment association is supplied by the trusted deployment receipt.
  event.environment = 'production';
  event.key = await eventKey(event);
  const source = { history: async () => [{ ...event, sequence: 1 }] };
  const saved = [];
  const cursors = new Map();
  const relay = new PublicationRelay({
    source, cursors,
    policyFor: withReleaseRouting(() => ({ schema: 1, role: 'activity', disposition: 'routine', material: false })),
    outbox: { enqueue: (row, policy) => {
      saved.push(prepare(row, policy));
      return { state: 'pending' };
    } },
  });
  await relay.poll();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].role, 'releases');
  assert.equal(saved[0].subject, 'release:81:production');
  assert.equal(cursors.get('publication:v1:public'), 1);
});

test('an unassociated release stays in routine history, and restricted records keep their own route', async () => {
  const { normalizeEvent } = await import('../../engineering-notifications/events-v1.mjs');
  const { withReleaseRouting } = await import('../../engineering-notifications/release-policy-5667.mjs');
  const ordinary = { schema: 1, role: 'activity', disposition: 'routine', material: false };
  const event = await normalizeEvent({
    kind: 'release', deliveryId: 'release-no-target', observedAt: '2026-11-18T12:00:00Z',
    payload: { repository: { id: 1, full_name: 'example/project', private: false }, action: 'published',
      release: { id: 81, published_at: '2026-11-18T12:00:00Z' } },
  });
  assert.deepEqual(await withReleaseRouting(() => ordinary)(event), ordinary);
});
