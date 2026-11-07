/**
 * #4673 (Delivery audit 1/6) — a composed status report shows and saves only
 * under the engagement and period it was composed for.
 *
 * The race: the partner composes for engagement A, switches to B while A's
 * response is in flight, and A's response lands. Before #4673 it was shown
 * under B and Save wrote A's words into B's report. `statusReportDraft.js` holds
 * the rule; the composer is pinned to use it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { EMPTY_DRAFT, draftFrom, latestOnly, saveRequest } from '../src/pages/partner/delivery/statusReportDraft.js';

const zone = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/partner/delivery/StatusReportsZone.jsx'), 'utf8'));

test('a response for an older selection is dropped: A composed, B selected, A lands late', async () => {
  const gate = latestOnly();
  let shown = null;
  const compose = async (asked, respond) => {
    const ticket = gate.start();
    const r = await respond;
    if (gate.isCurrent(ticket)) shown = draftFrom(r, asked);
  };
  let releaseA;
  const lateA = new Promise((res) => { releaseA = res; });
  const a = compose({ engagement_id: 1, period: '2026-11' }, lateA);
  gate.invalidate(); // the selection moved to B
  await compose({ engagement_id: 2, period: '2026-11' }, Promise.resolve({ period: '2026-11', existing: { shipped: 'B words' } }));
  releaseA({ period: '2026-11', existing: { shipped: 'A words' } });
  await a;
  // Mutation checked: make isCurrent always true -> A overwrites B and this fails.
  assert.equal(shown.engagement_id, 2);
  assert.equal(shown.existing.shipped, 'B words', 'A\'s late response never shows under B');
});

test('a selection change alone retires an in-flight composition', async () => {
  const gate = latestOnly();
  const ticket = gate.start();
  gate.invalidate();
  assert.equal(gate.isCurrent(ticket), false);
});

test('the draft keeps the identity it was asked for, and the lists never go missing', () => {
  const d = draftFrom({ engagement_id: 99, period: '2026-11', blocked: [{ side: 'client' }] }, { engagement_id: '7', period: '2026-11' });
  assert.equal(d.engagement_id, 7, 'the engagement asked for, whatever the response carries');
  assert.deepEqual(d.shipped_from_log, []);
  assert.equal(d.blocked.length, 1);
  assert.deepEqual(draftFrom(null, { engagement_id: 3, period: '2026-10' }), { ...EMPTY_DRAFT, engagement_id: 3, period: '2026-10' });
});

test('save goes to the draft\'s own engagement and period, and names them in the body for the Worker to check', () => {
  const draft = draftFrom({ period: '2026-11' }, { engagement_id: 7, period: '2026-11' });
  // Mutation checked: build the URL from the selector instead of the draft -> the first element differs and this fails.
  assert.deepEqual(saveRequest(draft, { shipped: 's', next_up: 'n' }), [7, '2026-11', { engagement_id: 7, period: '2026-11', shipped: 's', next_up: 'n' }]);
});

test('the composer uses the rule: gated responses, invalidated on every selection change, saved by the draft', () => {
  assert.match(zone, /const ticket = gate\.current\.start\(\);/);
  assert.equal((zone.match(/if \(!gate\.current\.isCurrent\(ticket\)\) return;/g) || []).length, 2, 'both the success and the failure path are gated');
  assert.equal((zone.match(/gate\.current\.invalidate\(\);/g) || []).length, 2, 'engagement and period changes both retire the composition');
  assert.match(zone, /setDraft\(draftFrom\(r, asked\)\)/);
  assert.match(zone, /api\.savePartnerStatusReport\(\.\.\.saveRequest\(draft, \{ shipped, next_up: nextUp \}\)\)/);
  assert.doesNotMatch(zone, /savePartnerStatusReport\(engagementId/, 'never the selector\'s engagement');
});
