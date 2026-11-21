/** D7917: exact-run deletion with a fake CLI, refusal/retry, and bounded workflow cleanup after cancellation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
// Match the workflow inventory: CI installs the Worker's YAML parser, not a frontend copy.
const YAML=createRequire(new URL('../../cloudflare-worker/package.json',import.meta.url))('yaml');
const script=resolve('scripts/dr-drill-cleanup.sh');
function fixture(name,fail=false){
 const dir=mkdtempSync(join(tmpdir(),'dr-cleanup-7917-')),file=join(dir,'owned.db'),log=join(dir,'calls');
 writeFileSync(join(dir,'wrangler'),'#!/bin/sh\nprintf "%s\\n" "$@" >> "$CALL_LOG"\nexit "${FAIL_DELETE:-0}"\n',{mode:0o755});
 if(name!==undefined)writeFileSync(file,name+'\n');
 const env={...process.env,PATH:dir+':'+process.env.PATH,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',DR_DRILL_DB_FILE:file,CALL_LOG:log,FAIL_DELETE:fail?'1':'0'};
 return{dir,file,log,env,run:()=>spawnSync('bash',[script],{env,encoding:'utf8'}),calls:()=>existsSync(log)?readFileSync(log,'utf8'):''};
}
test('cancelled step cleanup deletes only the recorded exact run/attempt and is idempotent',()=>{
 const f=fixture('dr-drill-202611202000-123-2-db');try{
 assert.equal(f.run().status,0);assert.equal(f.calls(),'d1\ndelete\ndr-drill-202611202000-123-2-db\n--skip-confirmation\n');assert.equal(existsSync(f.file),false);
 const calls=f.calls();assert.equal(f.run().status,0);assert.equal(f.calls(),calls);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('cleanup refuses production, another run, another attempt, old-format and malformed ownership records',()=>{
 for(const name of ['studioos-db','dr-drill-202611202000-124-2-db','dr-drill-202611202000-123-1-db','dr-drill-202611202000-db','dr-drill-202611202000-123-2-db\nstudioos-db']){
 const f=fixture(name);try{assert.notEqual(f.run().status,0);assert.equal(f.calls(),'');assert.ok(existsSync(f.file));}finally{rmSync(f.dir,{recursive:true,force:true});}}
 const f=fixture();try{const other=join(f.dir,'other');writeFileSync(other,'dr-drill-202611202000-123-2-db');symlinkSync(other,f.file);assert.notEqual(f.run().status,0);assert.equal(f.calls(),'');}finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('delete failure retains ownership for retry; invalid run identity cannot reach the CLI',()=>{
 const f=fixture('dr-drill-202611202000-123-2-db',true);try{assert.notEqual(f.run().status,0);assert.ok(existsSync(f.file));f.env.FAIL_DELETE='0';assert.equal(f.run().status,0);assert.equal(existsSync(f.file),false);}finally{rmSync(f.dir,{recursive:true,force:true});}
 const bad=fixture('dr-drill-202611202000-123-2-db');try{bad.env.GITHUB_RUN_ID='.*';assert.notEqual(bad.run().status,0);assert.equal(bad.calls(),'');}finally{rmSync(bad.dir,{recursive:true,force:true});}
});
test('workflow reserves cleanup time, runs it always, and shares the exact ownership file',()=>{
 const job=YAML.parse(readFileSync('.github/workflows/dr-drill.yml','utf8')).jobs.drill;
 const drill=job.steps.find(s=>s.id==='drill'),cleanup=job.steps.find(s=>s.run==='bash scripts/dr-drill-cleanup.sh');
 assert.equal(cleanup.if,'always()');assert.equal(cleanup['timeout-minutes'],5);assert.ok(drill['timeout-minutes']+cleanup['timeout-minutes']<job['timeout-minutes']);
 assert.equal(drill.env.DR_DRILL_DB_FILE,cleanup.env.DR_DRILL_DB_FILE);assert.match(cleanup.env.DR_DRILL_DB_FILE,/github.run_id/);assert.match(cleanup.env.DR_DRILL_DB_FILE,/github.run_attempt/);
 const source=readFileSync('scripts/dr-drill.sh','utf8');const recorded=source.indexOf("printf '%s\\n'");assert.ok(recorded>=0&&recorded<source.indexOf('wrangler d1 create'));assert.match(source,/GITHUB_RUN_ID.*GITHUB_RUN_ATTEMPT/);
});
