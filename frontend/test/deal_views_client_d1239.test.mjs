import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../src/lib/api/dealViews.js',import.meta.url),'utf8');
function fixture() {
 const calls=[];const request=(...args)=>{calls.push(args);return Promise.resolve({ok:true});};
 const api=new Function('request',`${source.replace(/^import .*;$/m,'').replace('export const dealViewsApi','const dealViewsApi')}\nreturn dealViewsApi;`)(request);
 return {api,calls};
}
test('saved-view client is lazy, encodes paging and IDs, and preserves write bodies and optimistic versions',async()=>{
 const {api,calls}=fixture();assert.equal(calls.length,0);
 await api.list({limit:10,offset:20});let u=new URL(calls[0][0],'https://example.invalid');assert.equal(u.pathname,'/deals/views');assert.equal(u.searchParams.get('limit'),'10');assert.equal(u.searchParams.get('offset'),'20');
 const body={name:'Synthetic',spec:{view:'table'},shared_with_firm:true,is_default:true};await api.create(body);assert.equal(calls[1][0],'/deals/views');assert.equal(calls[1][1].method,'POST');assert.deepEqual(JSON.parse(calls[1][1].body),body);
 await api.update('a/b?c',{name:'Changed',version:2});assert.equal(calls[2][0],'/deals/views/a%2Fb%3Fc');assert.equal(calls[2][1].method,'PATCH');assert.deepEqual(JSON.parse(calls[2][1].body),{name:'Changed',version:2});
 await api.remove('a/b?c');assert.equal(calls[3][0],'/deals/views/a%2Fb%3Fc');assert.equal(calls[3][1].method,'DELETE');
 await api.fit([2,1]);u=new URL(calls[4][0],'https://example.invalid');assert.equal(u.pathname,'/deals/fit');assert.equal(u.searchParams.get('ids'),'2,1');
});
