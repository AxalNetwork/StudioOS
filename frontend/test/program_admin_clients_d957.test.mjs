/** D957: request shapes for the Worker-first admin reads and decision. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/lib/api.js';

test('the new admin clients preserve query values, identifiers, decision body and legacy list shape', async () => {
  const previous = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null };
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), method: init.method, body: init.body }); return Response.json({ items: [], total: 0 }); };
  try {
    await api.adminReferralSubmissions({ status: 'submitted,under_review', offset: 200, sort: 'oldest' });
    await api.adminReferralSubmission('r/1');
    await api.adminReferralWeekly(4);
    await api.adminStrategicAccess({ status: 'requested', limit: 1, offset: 1 });
    await api.adminStrategicAccessDecision(7, { decision: 'granted', note: 'reviewed' });
    await api.adminPerkClaims(12);
    await api.adminPerkListings({ status: 'paused', offset: 10 });
    assert.deepEqual(seen.map((x) => x.url), [
      '/api/refer-earn/admin/submissions?status=submitted%2Cunder_review&offset=200&sort=oldest',
      '/api/refer-earn/admin/submissions/r%2F1', '/api/refer-earn/admin/submissions/weekly?weeks=4',
      '/api/refer-earn/admin/strategic-access?status=requested&limit=1&offset=1',
      '/api/refer-earn/admin/strategic-access/7/decision', '/api/perks/admin/claims?weeks=12',
      '/api/perks/admin/listings?status=paused&offset=10',
    ]);
    assert.equal(seen[4].method,'POST'); assert.deepEqual(JSON.parse(seen[4].body), { decision: 'granted', note: 'reviewed' });
  } finally { globalThis.fetch = previous; globalThis.localStorage = previousStorage; }
});
