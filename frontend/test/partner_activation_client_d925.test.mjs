import test from 'node:test';
import assert from 'node:assert/strict';
const seen=[];
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
globalThis.fetch=async(url,opts)=>{
  seen.push({url:String(url),method:opts.method});
  return new Response(JSON.stringify({activated:true,partner_deal_id:7}),{status:200,headers:{'Content-Type':'application/json'}});
};
const {api}=await import('../src/lib/api.js');
test('D925: activateDeal POSTs the mounted admin retry route and returns the Worker result',async()=>{
  assert.deepEqual(await api.adminPartners.activateDeal(7),{activated:true,partner_deal_id:7});
  assert.deepEqual(seen,[{url:'/api/admin/partners/deals/7/activate',method:'POST'}]);
});
