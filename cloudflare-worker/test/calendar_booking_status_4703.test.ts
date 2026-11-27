/**
 * D4703 (#4703): an advisor booking's external copy is tentative while the
 * booking is pending and firm once it is confirmed. The confirm pushes the
 * same event again (a PATCH), so the provider must be TOLD "confirmed"; a
 * payload that omitted the status would leave the tentative copy as it was.
 * Synthetic event; provider calls are captured, never sent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pushEventToGoogle, pushEventToMicrosoft } from '../src/services/calendar.ts';

const ev = (ics_status: 'TENTATIVE' | 'CONFIRMED') => ({
  id: 'advisor_booking:1', kind: 'advisor_booking', source_id: 1, source_uid: 'bk-synthetic',
  title: 'Advisor session — Synthetic Advisor', start_at: '2026-12-01T15:00:00Z', end_at: '2026-12-01T16:00:00Z',
  status: ics_status === 'TENTATIVE' ? 'pending' : 'confirmed', ics_status,
  location_kind: 'video', location_uri: null, organizer_email: 'advisor@example.test',
  attendees: [{ email: 'founder@example.test', name: 'Synthetic Founder', role: 'mentee' }], notes: '',
}) as any;

async function capture(fn: () => Promise<unknown>) {
  const bodies: any[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: any) => {
    bodies.push({ method: init.method, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'ext-1' }), { status: 200 });
  }) as any;
  try { await fn(); } finally { globalThis.fetch = real; }
  return bodies;
}

test('a pending booking goes out tentative, and its confirm PATCH says confirmed', async () => {
  // Mutation checked: the CONFIRMED branch removed → the PATCH carries no status and the copy stays tentative.
  const [g1] = await capture(() => pushEventToGoogle('tok', ev('TENTATIVE'), null));
  assert.equal(g1.body.status, 'tentative');
  const [g2] = await capture(() => pushEventToGoogle('tok', ev('CONFIRMED'), 'ext-1'));
  assert.equal(g2.method, 'PATCH');
  assert.equal(g2.body.status, 'confirmed');
  const [m1] = await capture(() => pushEventToMicrosoft('tok', ev('TENTATIVE'), null));
  assert.equal(m1.body.showAs, 'tentative');
  const [m2] = await capture(() => pushEventToMicrosoft('tok', ev('CONFIRMED'), 'ext-1'));
  assert.equal(m2.body.showAs, 'busy');
});
