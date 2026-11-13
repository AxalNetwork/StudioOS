import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';
test('PMF history keeps the venture and only accepts page controls; Re-score carries its explicit engine flag',async()=>{
 const calls=[];const api=makeCycleWrites(async(...args)=>{calls.push(args);return {items:[]};});
 await api.raise.pmfHistory(7,{project:999,limit:12,before:30,other:'ignored'});
 const url=new URL(calls[0][0],'https://example.test');
 assert.equal(url.pathname,'/cycles/raise/pmf/history');assert.deepEqual([...url.searchParams],[['project','7'],['limit','12'],['before','30']]);
 await api.raise.pmfHistory(8);assert.equal(calls[1][0],'/cycles/raise/pmf/history?project=8');
 await api.raise.rescore(7,{pmf:true,items:['pmf'],since:'last'});
 assert.equal(calls[2][0],'/cycles/raise/readiness/rescore?project=7');
 assert.equal(calls[2][1].method,'POST');assert.deepEqual(JSON.parse(calls[2][1].body),{pmf:true,items:['pmf'],since:'last'});
});
