import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceModule } from './_form_d695.mjs';

test('D1184: registry list keeps its GET and Mercury add sends the chosen UID to the existing POST', async () => {
  globalThis.__bankRegistryCalls = [];
  const code = readFileSync(new URL('../src/lib/api/bankAccounts.js', import.meta.url), 'utf8')
    .replace(/import \{ request \}[^;]+;/, 'const request=(...args)=>{globalThis.__bankRegistryCalls.push(args);return Promise.resolve({accounts:[]});};');
  try {
    const { bankAccountsApi } = await sourceModule(code, 'lib/api/bankAccounts.js');
    await bankAccountsApi.list();
    assert.deepEqual(globalThis.__bankRegistryCalls[0], ['/admin/bank-accounts']);
    const uid = 'a'.repeat(32), body = { label: 'Synthetic account', mercury_account_uid: 'not-the-selected-account' };
    await bankAccountsApi.addFromMercury(uid, body);
    const [path, options] = globalThis.__bankRegistryCalls[1];
    assert.equal(path, '/admin/bank-accounts'); assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { label: 'Synthetic account', mercury_account_uid: uid });
    assert.equal(body.mercury_account_uid, 'not-the-selected-account');
    await bankAccountsApi.add({ label: 'Manual' });
    assert.deepEqual(JSON.parse(globalThis.__bankRegistryCalls[2][1].body), { label: 'Manual' });
  } finally { delete globalThis.__bankRegistryCalls; }
});
