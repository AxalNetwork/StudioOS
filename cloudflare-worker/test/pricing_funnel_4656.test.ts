import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEvent } from '../src/routes/track.ts';

test('pricing telemetry retains only controlled dimensions', () => {
  const view = sanitizeEvent({ event: 'pricing_view', props: { audience: 'founder', plan: 'ignored', interval: 'yearly', other: 'ignored' } });
  assert.deepEqual(JSON.parse(view!.props!), { audience: 'founder', plan: null, interval: 'yearly' });
  const selection = { event: 'pricing_plan_selected', props: { audience: 'operating-partner', plan: 'partner:pro', interval: 'monthly' } };
  assert.deepEqual(JSON.parse(sanitizeEvent(selection)!.props!), selection.props);
  for (const props of [
    { ...selection.props, audience: 'founder' },
    { ...selection.props, plan: 'partner:unknown' },
    { ...selection.props, interval: 'other' },
    { ...selection.props, interval: null },
  ]) assert.equal(sanitizeEvent({ ...selection, props }), null);
  const free = { audience: 'advisor', plan: 'advisor:free', interval: null };
  assert.deepEqual(JSON.parse(sanitizeEvent({ ...selection, props: free })!.props!), free);
  assert.deepEqual(JSON.parse(sanitizeEvent({ ...selection, props: { audience: free.audience, plan: free.plan } })!.props!), free);
});
