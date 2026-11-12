// D5680: synthetic-only recipient, redaction and refusal tests; no real security ledger content is read.
import test from 'node:test';import assert from 'node:assert/strict';
import {securityTriage5680,deliverSecurityTriage5680,securityTriageCounts5680} from '../src/services/securityTriage5680';
const input={kind:'gate',domain:'tenant_isolation',state:'firing',count:100,corroborated:true,caseId:'case_0123456789abcdef'} as const;
const policy={approved:true,minimumCount:10,existenceSensitive:true,genericImpactAllowed:false};
const grant={verified:true,private:true,slackConnect:false,recipientAllowed:true,tenantScopeKnown:true,teamMatches:true,purpose:'restricted-case',domain:'tenant_isolation',caseId:input.caseId,channelId:'CPRIVATE'} as const;
test('only a matching authorized private case receives metadata; raw diagnostic and mention fields never escape',async()=>{
 const sent:unknown[]=[];const result=await deliverSecurityTriage5680({...input,raw:'<!channel> user@example.test https://private/?token=secret'} as any,policy,async()=>grant,async(route,payload)=>{sent.push({route,payload});return {state:'pending',key:'a'.repeat(64)}});
 assert.equal(result.state,'pending');assert.equal(sent.length,1);assert.doesNotMatch(JSON.stringify(sent),/channel|example|token|private\//);assert.match(JSON.stringify(sent),/restricted-security/);
});
test('external channel, missing grants, wrong tenant/domain/case, missing privacy and profile claims produce zero sends',async()=>{
 for(const altered of [{...grant,private:false},{...grant,slackConnect:true},{...grant,tenantScopeKnown:false},{...grant,verified:false},{...grant,recipientAllowed:false},{...grant,teamMatches:false},{...grant,caseId:'case_ffffffffffffffff'},{...grant,domain:'pii'},{...grant,private:undefined},{...grant,private:'false'}]){
 let calls=0;const result=await deliverSecurityTriage5680(input,policy,async()=>altered as any,async()=>{calls++});assert.equal(result.state,'withheld');assert.equal(calls,0);
 }
 assert.equal(securityTriage5680(input,{...policy,approved:false},grant).state,'withheld');
 assert.equal(securityTriage5680({...input,corroborated:false},policy,grant).state,'routine');
 assert.equal(securityTriage5680({...input,count:1},policy,grant).state,'routine');
 assert.equal(securityTriage5680({...input,kind:'step_up',count:1},policy,grant).state,'routine');
 assert.equal(securityTriage5680({...input,kind:'scanner',scannerFailed:true},policy,grant).state,'scanner_unavailable');
 assert.equal(securityTriage5680({...input,state:'recovery'},policy,grant).state,'withheld');
 assert.equal(securityTriage5680({...input,state:'recovery',recoveryVerified:true},policy,grant).state,'permitted');
});
test('generic impact needs separate approval and contains neither finding existence nor a restricted case reference',()=>{
 const section={...grant,purpose:'generic-impact'} as const;
 assert.equal(securityTriage5680({...input,operationalImpactVerified:true},policy,section).state,'withheld');
 assert.equal(securityTriage5680({...input,operationalImpactVerified:true},{...policy,genericImpactAllowed:true},section).state,'withheld');
 const result=securityTriage5680({...input,operationalImpactVerified:true},{...policy,existenceSensitive:false,genericImpactAllowed:true},section);
 assert.equal(result.state,'permitted');assert.doesNotMatch(JSON.stringify(result),/security|tenant|case_|finding/);
});
test('existing HQ Super Admin gate precedes aggregate SQL and a read failure is unavailable, never zero',async()=>{
 let reads=0;const env={DB:{prepare:()=>{reads++;throw Error('unreadable')}}} as any;
 await assert.rejects(securityTriageCounts5680(env,{role:'founder'},'2026-11-12 00:00:00','2026-11-12 01:00:00'),/restricted/);assert.equal(reads,0);
 const result=await securityTriageCounts5680(env,{role:'admin',is_super_admin:1},'2026-11-12 00:00:00','2026-11-12 01:00:00');assert.equal(result.available,false);assert.equal(result.counts,null);
});

test('publication exceptions and missing durable intent receipts never claim accepted delivery',async()=>{
 assert.equal((await deliverSecurityTriage5680(input,policy,async()=>{throw Error('private')},async()=>{})).state,'unavailable');
 assert.equal((await deliverSecurityTriage5680(input,policy,async()=>grant,async()=>{throw Error('private')})).state,'ambiguous');
 assert.equal((await deliverSecurityTriage5680(input,policy,async()=>grant,async()=>undefined)).state,'ambiguous');
});
test('aggregate reads bind a bounded window, omit identifying columns and refuse malformed source counts',async()=>{
 let query='',bindings:unknown[]=[];let invalid=false;
 const env={DB:{prepare:(sql:string)=>{query=sql;return {bind(...args:unknown[]){bindings=args;return this},async all(){return {results:[{kind:invalid?'unknown':'gate',outcome:'refused',count:2}]}}}}}} as any;
 const from='2026-11-12 00:00:00',to='2026-11-12 01:00:00';
 const valid=await securityTriageCounts5680(env,{role:'admin',is_super_admin:1},from,to);assert.equal(valid.available,true);assert.deepEqual(bindings,[from,to]);assert.doesNotMatch(query,/subject_key|user_id|ip_prefix|detail/);
 invalid=true;const bad=await securityTriageCounts5680(env,{role:'admin',is_super_admin:1},from,to);assert.equal(bad.available,false);assert.equal(bad.counts,null);
 await assert.rejects(securityTriageCounts5680(env,{role:'admin',is_super_admin:1},from,'2026-11-14 00:00:00'),/window/);
});
