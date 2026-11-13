// D5680: synthetic live-metadata refusal before restricted transport; no real channel or finding is used.
import test from 'node:test';import assert from 'node:assert/strict';
import {restrictedTransport5680} from '../../engineering-slack/restricted-transport-5680.mjs';
test('only a current private internal member destination receives the fixed restricted payload',async()=>{
 for(const override of [{is_ext_shared:true},{is_ext_shared:undefined},{is_private:false},{is_member:false},{is_pending_ext_shared:true},{is_archived:true},{}]){
 const calls=[];const send=restrictedTransport5680({token:'fixture',fetchImpl:async(url)=>{const method=url.split('/').at(-1);calls.push(method);return Response.json(method==='auth.test'?{ok:true,team_id:'TFIXTURE'}:method==='conversations.info'?{ok:true,channel:{id:'CPRIVATE',is_private:true,is_member:true,is_ext_shared:false,...override}}:{ok:true,channel:'CPRIVATE',ts:'1000.000001'})}});
 const result=await send({registry:{teamId:'TFIXTURE'},channel:{id:'CPRIVATE',private:true},text:'synthetic restricted case',operation:'post'});
 const permitted=Object.keys(override).length===0;assert.equal(result.state,permitted?'acknowledged':'dead');assert.equal(calls.includes('chat.postMessage'),permitted);
 }
});
