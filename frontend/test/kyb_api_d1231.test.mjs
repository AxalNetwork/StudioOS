import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/lib/api/kyb.js',import.meta.url),'utf8');
async function scenario(fault = false) {
  let code = source.replace("import { request } from '../api.js';", 'const request = (path, options) => ({path, ...options});');
  if (fault) code = code.replace('review_token ?','false ?');
  const {kybApi} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const approval = kybApi.approve('account-3',{review_token:'displayed-token',registry_matches:true});
  assert.equal(approval.headers['If-Match'],'displayed-token');
  assert.deepEqual(JSON.parse(approval.body),{registry_matches:true});
  assert.equal(approval.path,'/kyc/businesses/account-3/approve');
  const link = kybApi.linkAccount('import-2',4,'import-token');
  assert.equal(link.headers['If-Match'],'import-token');
  assert.deepEqual(JSON.parse(link.body),{user_id:4});
  assert.deepEqual(kybApi.approve('account-3',{}).headers,{},'missing tokens are refused by the Worker, never silently refreshed');
}
test('KYB writes carry the displayed review token without putting it in the payload or fetching a replacement',async()=>{
  await scenario();
  await assert.rejects(()=>scenario(true),{code:'ERR_ASSERTION'});
  await scenario();
});
