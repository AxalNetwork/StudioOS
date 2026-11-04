/** D1487/D1488 (#3724): the recommendation client uses the mounted Worker verbs and paths. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventRecommendationsApi as client } from '../src/lib/api/eventRecommendations.js';
test('the client sends preferences, feedback, quotes and Explain through its scoped routes',async()=>{
 const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;const calls=[];
 globalThis.localStorage={getItem(){return null;},setItem(){},removeItem(){}};
 globalThis.fetch=async(url,init={})=>{calls.push({path:new URL(String(url),'http://test').pathname,method:init.method||'GET',body:init.body?JSON.parse(init.body):null});return new Response('{}',{headers:{'Content-Type':'application/json'}});};
 try {
  await client.recommended();await client.prefs();await client.savePrefs({enabled:false});await client.feedback(1,'not_for_me','topic');await client.quote(1);await client.explain(1);
  assert.deepEqual(calls.map(c=>[c.path,c.method]),[['/api/events/recommended','GET'],['/api/events/recommendation-prefs','GET'],['/api/events/recommendation-prefs','PUT'],['/api/events/1/recommendation-feedback','POST'],['/api/events/1/recommendation/explain/quote','POST'],['/api/events/1/recommendation/explain','POST']]);
  assert.deepEqual(calls[2].body,{enabled:false});assert.deepEqual(calls[3].body,{verdict:'not_for_me',reason:'topic'});assert.equal(calls[4].body,null);assert.equal(calls[5].body,null);
 }finally{globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
