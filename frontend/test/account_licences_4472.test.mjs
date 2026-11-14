/** D4472 (#4472): all four mounted account licence routes, verbs, payload and encoded identifiers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountLicencesApi as client } from '../src/lib/api/accountLicences.js';
test('the account licence client uses its Worker routes and never offers a switch or checkout', async () => {
  const oldFetch=globalThis.fetch, oldStorage=globalThis.localStorage, calls=[];
  globalThis.localStorage={getItem(){return null;},setItem(){},removeItem(){}};
  globalThis.fetch=async (url,init={}) => { calls.push({path:new URL(String(url),'http://test').pathname,method:init.method||'GET',body:init.body?JSON.parse(init.body):null}); return new Response('{}',{headers:{'Content-Type':'application/json'}}); };
  try {
    await client.mine(); await client.forAccount(9001); await client.grant(9001,'investor'); await client.revoke(9001,'investor');
    assert.deepEqual(calls,[
      {path:'/api/account/licences',method:'GET',body:null},
      {path:'/api/admin/accounts/9001/licences',method:'GET',body:null},
      {path:'/api/admin/accounts/9001/licences',method:'POST',body:{licence:'investor'}},
      {path:'/api/admin/accounts/9001/licences/investor',method:'DELETE',body:null},
    ]);
    await client.revoke('9001/other','investor/other');
    assert.equal(calls[4].path,'/api/admin/accounts/9001%2Fother/licences/investor%2Fother');
    await client.forAccount('9001/other'); await client.grant('9001/other','investor');
    assert.equal(calls[5].path,'/api/admin/accounts/9001%2Fother/licences');
    assert.equal(calls[6].path,'/api/admin/accounts/9001%2Fother/licences');
  } finally { globalThis.fetch=oldFetch; globalThis.localStorage=oldStorage; }
});
