/**
 * D946 (#2751) — the clients for the Lab participants read, SL10's Lab-only
 * switch on the 83(b) and formation desks, and SL14's support sessions.
 * Mounted on a stubbed fetch: each method calls the Worker route it names
 * (routes/admin_lab_participants.ts, admin_83b_review.ts, admin_incorporations.ts,
 * admin_cohort.ts) with only the parameters that route takes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const seen = [];
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch = async (url, options) => {
  seen.push({ url: String(url), method: options?.method || 'GET' });
  return new Response(JSON.stringify({ available: true, items: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { adminLabApi, section83bReviewApi, adminIncorporationsApi } = await import('../src/lib/api.js');
const at = (i) => new URL(seen[i].url, 'https://fixture.example.test');

test('D946: participants sends every filter, the sort and the page, and nothing else', async () => {
  seen.length = 0;
  await adminLabApi.participants({
    cohort: '2026-11', status: 'active', week: 2, this_week: 'at_risk', incorporated: 'no', needs: true,
    q: '%_ & Lab', sort: 'days_left', limit: 25, offset: 0, rogue: 'ignored',
  });
  assert.equal(at(0).pathname, '/api/admin/cohort/participants');
  assert.deepEqual(Object.fromEntries(at(0).searchParams), {
    cohort: '2026-11', status: 'active', week: '2', this_week: 'at_risk', incorporated: 'no', needs: '1',
    q: '%_ & Lab', sort: 'days_left', limit: '25', offset: '0',
  });
  await adminLabApi.participants({ needs: false });
  assert.equal(seen[1].url, '/api/admin/cohort/participants', 'needs off is not sent');
});

test('D946: the drawer reads one participant by uid, encoded', async () => {
  seen.length = 0;
  await adminLabApi.participant('u/1 2');
  assert.deepEqual(seen, [{ url: '/api/admin/cohort/participants/u%2F1%202', method: 'GET' }]);
});

test('D946: support sessions read the Super Admin route', async () => {
  seen.length = 0;
  await adminLabApi.supportSessions();
  assert.deepEqual(seen, [{ url: '/api/admin/cohort/impersonation-audit', method: 'GET' }]);
});

test('D946: the Lab-only switch sends scope=lab; without it the desks read every startup, as before', async () => {
  seen.length = 0;
  await section83bReviewApi.adminList('lab');
  await section83bReviewApi.adminList();
  await adminIncorporationsApi.list('lab');
  await adminIncorporationsApi.list();
  assert.deepEqual(seen.map((s) => s.url), [
    '/api/admin/83b-review?scope=lab', '/api/admin/83b-review',
    '/api/admin/incorporations?scope=lab', '/api/admin/incorporations',
  ]);
});
