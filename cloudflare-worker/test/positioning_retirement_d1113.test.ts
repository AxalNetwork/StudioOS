/** D1113: a retired endpoint performs neither user-data reads nor model work. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import decks from '../src/routes/decks.ts';

test('POST /api/decks/positioning is gone before auth, SQL or AI',async()=>{
  let reads=0,runs=0;
  const env:any={ENVIRONMENT:'test',DB:{prepare(){reads++;throw new Error('Unexpected synthetic data read');}},AI:{run(){runs++;throw new Error('Unexpected synthetic model run');}}};
  const app=new Hono<any>().route('/api/decks',decks);
  app.onError((error,c)=>c.json({error:error.message==='Unauthorized'?'unauthorized':'test_failure'},401));
  for(const path of ['/api/decks/positioning','/api/decks/positioning?project_id=1']){
    const response=await app.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:1})},env);
    assert.equal(response.status,404);
  }
  assert.equal(reads,0);assert.equal(runs,0);
});
