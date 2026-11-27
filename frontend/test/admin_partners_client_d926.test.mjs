/**
 * D926 (#2722) — the adminPartners clients for the server-side lists and the
 * create lookup: today's calls send what they sent, and the new options reach
 * the Worker's parameter names. What the Worker answers is tested in
 * cloudflare-worker/test/partner_lists_d926.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const seen = [];
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
globalThis.fetch = async (url, init = {}) => {
  seen.push({ url: String(url).replace(/^https?:\/\/[^/]+/, ''), method: init.method || 'GET' });
  return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { api } = await import('../src/lib/api.js');
const calls = async (fn) => { seen.length = 0; await fn(); return seen.map((s) => [s.method, s.url]); };

test('listInvitations: today\'s calls are unchanged, and every D926 option reaches its parameter', async () => {
  assert.deepEqual(await calls(() => api.adminPartners.listInvitations()), [['GET', '/api/admin/partners/invitations']]);
  assert.deepEqual(await calls(() => api.adminPartners.listInvitations({ status: 'sent', email: 'a@b' })),
    [['GET', '/api/admin/partners/invitations?status=sent&email=a%40b']]);
  assert.deepEqual(await calls(() => api.adminPartners.listInvitations({
    q: 'ada', stage: ['sent', 'lapsed'], dealType: 'custom', invitedBy: 5, sentWithin: 30, sort: 'oldest_open', limit: 25, offset: 50,
  })), [['GET', '/api/admin/partners/invitations?q=ada&stage=sent&stage=lapsed&deal_type=custom&invited_by=5&sent_within=30&sort=oldest_open&limit=25&offset=50']]);
  assert.deepEqual(await calls(() => api.adminPartners.listInvitations({ stage: 'lapsed' })),
    [['GET', '/api/admin/partners/invitations?stage=lapsed']], 'one stage as a string');
});

test('listDeals: a state string as today, or D926\'s options with several states', async () => {
  assert.deepEqual(await calls(() => api.adminPartners.listDeals()), [['GET', '/api/admin/partners/deals?status=active']]);
  assert.deepEqual(await calls(() => api.adminPartners.listDeals('voided')), [['GET', '/api/admin/partners/deals?status=voided']]);
  assert.deepEqual(await calls(() => api.adminPartners.listDeals({
    status: ['active', 'awaiting_signature'], q: 'SYN', dealType: 'custom', endsWithin: 30, hasRedemptions: true, sort: 'ends_soonest', limit: 25, offset: 25,
  })), [['GET', '/api/admin/partners/deals?status=active&status=awaiting_signature&q=SYN&deal_type=custom&ends_within=30&has_redemptions=true&sort=ends_soonest&limit=25&offset=25']]);
  assert.deepEqual(await calls(() => api.adminPartners.listDeals({ status: 'all' })), [['GET', '/api/admin/partners/deals?status=all']]);
});

test('lookupInvitation reads the create lookup for one address', async () => {
  assert.deepEqual(await calls(() => api.adminPartners.lookupInvitation('Ada+x@example.invalid')),
    [['GET', '/api/admin/partners/invitations/lookup?email=Ada%2Bx%40example.invalid']]);
});
