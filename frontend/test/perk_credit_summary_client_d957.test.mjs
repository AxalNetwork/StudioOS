/** D957 item15: the existing credit client exposes only the mounted aggregate read. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { memberCreditsApi } from '../src/lib/api/memberCredits.js';

test('summary calls the fixed GET path and preserves the server aggregate',async()=>{
 const fetch=globalThis.fetch,storage=globalThis.localStorage;
 globalThis.localStorage={getItem:()=>null};const seen=[];
 const summary={credits_held:135,accounts:3,roles:['founder','partner'],negative_balances:{total:-7,accounts:1}};
 globalThis.fetch=async(url,init)=>{seen.push({url:String(url),method:new Request(`https://example.test${url}`,init).method,body:init.body});return Response.json(summary);};
 try{assert.deepEqual(await memberCreditsApi.summary(),summary);assert.deepEqual(seen,[{url:'/api/perks/admin/credits/summary',method:'GET',body:undefined}]);}
 finally{globalThis.fetch=fetch;globalThis.localStorage=storage;}
});

test('an unreadable aggregate rejects without a zero fallback',async()=>{
 const fetch=globalThis.fetch,storage=globalThis.localStorage;globalThis.localStorage={getItem:()=>null};
 globalThis.fetch=async()=>Response.json({error:'credit_summary_unreadable',message:'Credit balances could not be read. Try again.'},{status:503});
 try{await assert.rejects(memberCreditsApi.summary(),e=>e.code==='credit_summary_unreadable'&&e.message.includes('Try again'));}
 finally{globalThis.fetch=fetch;globalThis.localStorage=storage;}
});
