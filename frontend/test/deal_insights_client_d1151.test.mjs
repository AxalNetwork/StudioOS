import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../src/lib/api/dealInsights.js',import.meta.url),'utf8');
test('D1151: deal section clients encode the deal and preserve the response without inventing figures',async()=>{
  const calls=[];
  const masked={masked:true,project:{name:'Synthetic'}};
  const request=(...args)=>{calls.push(args);return Promise.resolve(masked);};
  const api=new Function('request',`${source.replace(/^import .*;$/m,'').replace('export const dealInsightsApi','const dealInsightsApi')}\nreturn dealInsightsApi;`)(request);
  assert.deepEqual(calls,[]);
  for(const section of ['team','market','traction']) {
    assert.equal(await api[section]('10/../20?private=true'),masked);
  }
  assert.deepEqual(calls,[['/deals/10%2F..%2F20%3Fprivate%3Dtrue/team'],['/deals/10%2F..%2F20%3Fprivate%3Dtrue/market'],['/deals/10%2F..%2F20%3Fprivate%3Dtrue/traction']]);
});
