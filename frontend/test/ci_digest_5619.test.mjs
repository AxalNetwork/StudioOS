/** D5619: classifier-supplied verdicts, stable fingerprints, bounded safe details and one comment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest, render } from '../../scripts/lib/ciDigest.mjs';
import { VERDICTS } from '../../scripts/lib/ciClassify.mjs';
import { publish, runDigest, main, pushesToGreen } from '../../scripts/ci-digest.mjs';
const headSha='a'.repeat(40);
const jobs=[{ name:'worker (typecheck)',conclusion:'failure',html_url:'https://github.com/AxalNetwork/StudioOS/actions/runs/123/job/456',steps:[{name:'TypeScript check',conclusion:'failure'}] }];
const fixture=(verdict,extra={})=>digest({classification:{verdict,incident:'https://github.com/AxalNetwork/StudioOS/issues/5500'},jobs,headSha,...extra});
test('each classifier verdict, with and without artifact, preserves the verdict and inherited instructions',()=>{
 for(const verdict of VERDICTS)for(const artifact of [null,{headSha,failures:[{job:jobs[0].name,id:'test:one',testNames:['first test'],excerpt:'failure detail',repro:'npm run test:worker'}]}]){
  const d=fixture(verdict,{artifact});assert.equal(d.verdict,verdict);
  assert.equal(d.dont.length,['inherited_main_failure','infra_failure'].includes(verdict)?3:0);
  assert.equal(d.failures[0].step,'TypeScript check');assert.match(d.failures[0].url,/\/job\/456$/);
  if(verdict==='inherited_main_failure'){assert.match(render(d),/Do not merge main.*Do not port a fix.*Do not re-run/);assert.match(render(d),/issues\/5500/);}
  assert.equal(Boolean(d.failures[0].detail),Boolean(artifact));
 }
});
test('fingerprint ignores job order and run ids, uses sorted artifact ids and changes with verdict',()=>{
 const second={name:'frontend (build)',conclusion:'failure',id:99};
 const a=fixture('pr_failure',{jobs:[...jobs,second]});
 const b=fixture('pr_failure',{jobs:[{...second,id:999},{...jobs[0],id:321,html_url:'https://github.com/AxalNetwork/StudioOS/actions/runs/999/job/888'}]});
 assert.equal(a.fingerprint,b.fingerprint);assert.match(a.fingerprint,/^[a-f0-9]{64}$/);
 assert.notEqual(a.fingerprint,fixture('main_health_unknown',{jobs:[...jobs,second]}).fingerprint);
 const detail=fixture('pr_failure',{artifact:{failures:[{job:jobs[0].name,id:'failure:42'}]}});
 assert.notEqual(detail.fingerprint,fixture('pr_failure').fingerprint);
});
test('5000-character backtick detail remains fenced, truncated, and cannot escape metadata',()=>{
 const d=fixture('pr_failure',{artifact:{failures:[{job:jobs[0].name,testNames:['a test'],excerpt:'```\n<script>@name\n'+'x'.repeat(5000),repro:'node test'}]}});
 assert.equal(d.failures[0].detail.length,300);assert.match(d.failures[0].detail,/Repro: node test/);
 const text=render(d);assert.match(text,/````text\n/);assert.match(text,/\n````/);assert.ok(text.length<1700);
 assert.equal(JSON.parse(/```json\n([\s\S]+?)\n```/.exec(text)[1]).headSha,headSha);
});
test('flaky requires a successful job on the same head; unsafe strings and wrong-head artifact are refused',()=>{
 assert.equal(fixture('pr_failure',{attempts:[{headSha:'b'.repeat(40),jobs:[{name:jobs[0].name,conclusion:'success'}]}]}).failures[0].flaky,false);
 assert.equal(fixture('pr_failure',{attempts:[{headSha,jobs:[{name:jobs[0].name,conclusion:'success'}]}]}).failures[0].flaky,true);
 const d=fixture('pr_failure',{jobs:[{...jobs[0],name:'@owner <SCRIPT>',html_url:'https://evil.example/x',steps:[{name:'```',conclusion:'failure'}]}]});
 assert.doesNotMatch(render(d),/@owner|<script>|evil\.example/i);
 assert.equal(fixture('pr_failure',{artifact:{headSha:'b'.repeat(40),failures:[{job:jobs[0].name,excerpt:'wrong head'}]}}).failures[0].detail,null);
});
test('one existing marker is updated, no comment is created; unchanged digest does not write',async()=>{
 const previous=fixture('main_health_unknown');const comments=[{id:42,user:{login:'github-actions[bot]'},body:render(previous)}],writes=[];
 const api=async(m,p,b)=>{if(m==='GET')return comments;writes.push({m,p,b});comments[0].body=b.body;};
 const d=fixture('pr_failure');assert.deepEqual(await publish({api,pr:5619,d}),{updated:true,created:false});
 assert.equal(writes.length,1);assert.equal(writes[0].m,'PATCH');assert.equal(d.count,2);
 assert.deepEqual(await publish({api,pr:5619,d:fixture('pr_failure')}),{updated:false,created:false});assert.equal(writes.length,1);
});
test('API errors, malformed configuration and CLI errors all exit zero',async()=>{
 const api=async()=>{throw new Error('offline');};
 assert.equal(await runDigest({api,pr:5619,runId:1,headSha,log(){}}),0);
 assert.equal(await main(['--report','bad']),0);
});
test('older pushes and fork runs never write',async()=>{
 for(const fork of [true,false]){
  let calls=0;
  const api=async(m,p)=>{assert.equal(m,'GET');calls++;return p.startsWith('actions/')?{event:'pull_request'}:{head:{sha:fork?headSha:'b'.repeat(40),repo:{full_name:fork?'fork/StudioOS':'AxalNetwork/StudioOS'}},base:{repo:{full_name:'AxalNetwork/StudioOS'}}};};
  assert.equal(await runDigest({api,pr:5619,runId:1,headSha,log(){}}),0);assert.equal(calls,2);
 }
});
test('report counts distinct red pushes through the first green SHA',async()=>{
 const api=async(m,p)=>p.startsWith('pulls/')?{head:{ref:'branch'}}:{workflow_runs:[{pull_requests:[{number:12}],head_sha:'a',conclusion:'failure',created_at:'2026-01-01'},{pull_requests:[{number:12}],head_sha:'a',conclusion:'failure',created_at:'2026-01-02'},{pull_requests:[{number:12}],head_sha:'b',conclusion:'success',created_at:'2026-01-03'}]};
 assert.deepEqual(await pushesToGreen({api,pr:12}),{pr:12,pushesToGreen:2});
});
test('digest alone has write permission, base-SHA checkout and no gate dependency on digest',()=>{
 const source=readFileSync('.github/workflows/ci.yml','utf8');
 const block=/^  digest:\n([\s\S]*?)(?=^  [a-z][\w-]*:|$(?![\s\S]))/m.exec(source)?.[1];assert.ok(block);
 assert.match(block,/needs: \[frontend, worker, suite, drift\]/);assert.match(block,/failure\(\).*pull_request/);
 assert.equal((block.match(/if: github.event.pull_request.head.repo.full_name == github.repository/g)||[]).length,3);assert.match(block,/ref: \$\{\{ github.event.pull_request.base.sha \}\}/);
 assert.match(block,/persist-credentials: false/);assert.match(block,/continue-on-error: true/);
 assert.deepEqual([...block.matchAll(/^      ([\w-]+): (read|write)$/gm)].map(m=>m.slice(1)),[['contents','read'],['actions','read'],['issues','read'],['pull-requests','write']]);
 assert.equal((source.match(/pull-requests: write/g)||[]).length,1);
 const gate=/^  gate:\n([\s\S]*?)(?=^  [a-z][\w-]*:)/m.exec(source)[1];assert.doesNotMatch(gate,/needs:.*digest/);
});
