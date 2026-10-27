// D1303 (#3400) — the account-writes client calls the Worker's mounted routes
// (routes/admin_accounts.ts at /api/admin/accounts), each with its method and
// body, and encodes the view uid it puts in a path. Full access without an
// identity check sends its reason through `kycAdminApprove`.
//
// Run with:
//   node --test frontend/test/account_writes_api_d1303.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceModule } from './_form_d695.mjs';

const WORKER = readFileSync(new URL('../../cloudflare-worker/src/routes/admin_accounts.ts', import.meta.url), 'utf8');
const API = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');

test('D1303: each account write calls its mounted route with its method and body', async () => {
  globalThis.__accountCalls = [];
  const code = readFileSync(new URL('../src/lib/api/adminAccountWrites.js', import.meta.url), 'utf8')
    .replace(/import \{ request \}[^;]+;/, 'const request=(...args)=>{globalThis.__accountCalls.push(args);return Promise.resolve({ok:true});};');
  try {
    const { adminAccountWritesApi: a } = await sourceModule(code, 'lib/api/adminAccountWrites.js');
    await a.adminBulkResendVerification([12, 13], { dryRun: true });
    await a.adminBulkResendVerification([12]);
    await a.adminAccountViews();
    await a.adminSaveAccountView({ name: 'Unverified', scope: 'studio', query: { email: 'unverified' } });
    await a.adminUpdateAccountView('v/1', { name: 'Renamed' });
    await a.adminDeleteAccountView('v/1');
    await a.adminExportAccounts({ reason: 'Quarterly review', user_ids: [12] });
    const calls = globalThis.__accountCalls.map(([path, o]) => [path, o?.method || 'GET', o?.body ? JSON.parse(o.body) : null]);
    assert.deepEqual(calls, [
      ['/admin/accounts/resend-verification', 'POST', { user_ids: [12, 13], dry_run: true }],
      ['/admin/accounts/resend-verification', 'POST', { user_ids: [12] }],
      ['/admin/accounts/views', 'GET', null],
      ['/admin/accounts/views', 'POST', { name: 'Unverified', scope: 'studio', query: { email: 'unverified' } }],
      ['/admin/accounts/views/v%2F1', 'PUT', { name: 'Renamed' }],
      ['/admin/accounts/views/v%2F1', 'DELETE', null],
      ['/admin/accounts/export', 'POST', { reason: 'Quarterly review', user_ids: [12] }],
    ]);
    for (const [method, route] of [['post', '/resend-verification'], ['get', '/views'], ['post', '/views'], ['put', '/views/:uid'], ['delete', '/views/:uid'], ['post', '/export']]) {
      assert.ok(WORKER.includes(`r.${method}('${route}'`), `${method} ${route} is mounted`);
    }
    assert.match(API, /kycAdminApprove: \(userId, body\) => request\(`\/kyc\/admin\/\$\{userId\}\/approve`, \{ method: 'PATCH', \.\.\.\(body \? \{ body: JSON\.stringify\(body\) \} : \{\}\) \}\)/);
  } finally { delete globalThis.__accountCalls; }
});
