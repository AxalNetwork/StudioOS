import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('D1191: capital summary/support clients preserve project, reason, paging and the private-read verb',async()=>{
  const source=readFileSync(new URL('../src/lib/api/capitalRelationships.js',import.meta.url),'utf8');
  const calls=[];
  globalThis.__capitalAccessRequest=async(...args)=>{calls.push(args);return {recorded:true};};
  try {
    const module=await import('data:text/javascript;base64,'+Buffer.from(source.replace("import { request } from '../api.js';","const request=(...args)=>globalThis.__capitalAccessRequest(...args);")).toString('base64'));
    const api=module.capitalRelationshipsApi;
    assert.deepEqual(await api.summary(null,2),{recorded:true});
    await api.summary(101,3);await api.supportRead(101,'Fixture reason',{page:2,prospectId:7});await api.supportReads(101,4);
    for(const [index,params] of [[0,{page:'2'}],[1,{project:'101',page:'3'}],[3,{project:'101',page:'4'}]]) {
      const url=new URL(calls[index][0],'https://example.test/api/');
      assert.deepEqual(Object.fromEntries(url.searchParams),params);
      assert.equal(url.pathname,index===3?'/cycles/raise/capital-relationships/support-reads':'/cycles/raise/capital-relationships/summary');
    }
    assert.equal(calls[2][0],'/cycles/raise/capital-relationships/support-read?project=101');assert.equal(calls[2][1].method,'POST');
    assert.deepEqual(JSON.parse(calls[2][1].body),{reason:'Fixture reason',page:2,prospect_id:7});
    await api.summary('101&project=202');assert.equal(new URL(calls[4][0],'https://example.test').searchParams.get('project'),'101&project=202');
  }finally{delete globalThis.__capitalAccessRequest;}
});
