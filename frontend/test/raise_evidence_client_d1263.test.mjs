import test from 'node:test';
import assert from 'node:assert/strict';
import { raiseEvidenceApi } from '../src/lib/api/raiseEvidence.js';
globalThis.localStorage=globalThis.localStorage||{getItem:()=>null,setItem(){},removeItem(){}};
test('evidence client sends project, paging, displayed hash/version and link references to the mounted paths',async()=>{
 const sent=[],previous=globalThis.fetch;
 globalThis.fetch=async(url,init={})=>{sent.push([String(url).replace(/^.*\/api/,''),init.method||'GET',init.body?JSON.parse(init.body):null]);return {ok:true,status:200,headers:{get:()=>'application/json'},json:async()=>({}),text:async()=>'{}'};};
 try{await raiseEvidenceApi.read(7,{limit:10,offset:20});await raiseEvidenceApi.refresh(7);await raiseEvidenceApi.accept(7,'a/b','abc');await raiseEvidenceApi.dismiss(7,'a/b');await raiseEvidenceApi.update(7,'a/b',3,{version:99,visibility:'private'});await raiseEvidenceApi.link(7,'c/d','item',3,'proposal');await raiseEvidenceApi.unlink(7,'c/d','item');}finally{globalThis.fetch=previous;}
 assert.deepEqual(sent,[
 ['/cycles/raise/evidence?project=7&limit=10&offset=20','GET',null],
 ['/cycles/raise/evidence/refresh?project=7','POST',null],
 ['/cycles/raise/evidence/items/a%2Fb/accept?project=7','POST',{snapshot_hash:'abc'}],
 ['/cycles/raise/evidence/items/a%2Fb/dismiss?project=7','POST',null],
 ['/cycles/raise/evidence/items/a%2Fb?project=7','PATCH',{version:3,visibility:'private'}],
 ['/cycles/raise/evidence/claims/c%2Fd/link?project=7','POST',{item_id:'item',item_version:3,proposal_uid:'proposal'}],
 ['/cycles/raise/evidence/claims/c%2Fd/link?project=7','DELETE',{item_id:'item'}],
 ]);
});
