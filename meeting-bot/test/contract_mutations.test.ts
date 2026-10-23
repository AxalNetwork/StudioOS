/** Isolated mutations: tracked files remain unchanged; each failing variant is bracketed by passing scenarios. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const scenarios=['meeting-bot/test/contract_recovery.test.ts','meeting-bot/test/callback_privacy.test.ts','meeting-bot/test/container_smoke.test.ts','meeting-bot/test/lifecycle.test.ts'];
const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
const run=(loader?:string)=>spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',...(loader?['--import',loader]:[]),'--test',...scenarios],{cwd:root,encoding:'utf8',timeout:10_000,env:childEnv});
const cases=[
  ['signature omits route','callback.ts','`v1:${ts}:POST:${path}:${body}`','`v1:${ts}:POST:${body}`'],
  ['wire sequence reused','callback.ts','seq:++seq','seq:seq'],
  ['upload replay gets new seq','callback.ts','const key=`chunk:${chunkSeq}`;','const key=`chunk:${chunkSeq}:${crypto.randomUUID()}`;'],
  ['arbitrary 409 treated as stored','callback.ts',"data?.code==='chunk_already_uploaded'",'true'],
  ['upload host not constrained','callback.ts','target.origin!==base.origin || ',''],
  ['silence replaced by prior speaker','callback.ts','participant_id:e.participant_id,at_ms','participant_id:e.participant_id??\'synthetic\',at_ms'],
  ['rename rewrites join clock','events.ts','old?.joined_ms ?? this.at()','this.at()'],
  ['late PCM captured after stop','lifecycle.ts','return capturing&&!control.signal.aborted;','return true;'],
  ['failed upload looks complete','lifecycle.ts','const incomplete=timedOut||uploader.failedCount>0||events.droppedCount+events.pendingCount>0;','const incomplete=false;'],
  ['notice skipped','lifecycle.ts','()=>adapter.sendChat(cfg.notice)','async()=>{}'],
  ['invalid command signature accepted','runtime.ts','if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))','if(false)'],
  ['start waits on callback','runtime.ts','return reply({accepted:true},202);','await active.done;return reply({accepted:true},202);'],
] as const;

test('D886 new contract assertions survive restore and catch each isolated mutation',{timeout:180_000},()=>{
  assert.equal(run().status,0,'baseline scenarios');
  const temporary=mkdtempSync(join(tmpdir(),'d886-runtime-mutants-'));
  try {
    for(const [name,file,before,after] of cases){
      const target=new URL('../src/'+file,import.meta.url).href;
      assert.ok(readFileSync(new URL(target),'utf8').includes(before),name+' target');
      writeFileSync(join(temporary,'hook.mjs'),`import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';export async function load(url,ctx,next){if(url===${JSON.stringify(target)}){const source=readFileSync(new URL(url),'utf8').replace(${JSON.stringify(before)},()=>${JSON.stringify(after)});return {format:'module',source:stripTypeScriptTypes(source,{mode:'strip'}),shortCircuit:true};}return next(url,ctx);}`);
      writeFileSync(join(temporary,'register.mjs'),"import {register} from 'node:module';register('./hook.mjs',import.meta.url);");
      const mutant=run(join(temporary,'register.mjs'));
      assert.notEqual(mutant.status,0,name+' must fail '+mutant.stdout.slice(-500));
      assert.equal(run().status,0,name+' restored');
    }
  }finally{rmSync(temporary,{recursive:true,force:true});}
});
