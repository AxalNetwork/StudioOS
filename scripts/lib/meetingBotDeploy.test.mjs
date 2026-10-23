/** B8 deployment ordering: subprocesses run only against isolated fake tools. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseSections,missingFromProduction,unknownTables } from '../check-wrangler-binding-parity.mjs';
const predeploy=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url))).scripts.predeploy;
function ordered(command=predeploy){
  const root=mkdtempSync(join(tmpdir(),'bot-deploy-test-'));
  try{
    for(const dir of ['bin','scripts/lib','meeting-bot'])mkdirSync(join(root,dir),{recursive:true});
    copyFileSync(new URL('../preflight-meeting-bot-deploy.mjs',import.meta.url),join(root,'scripts/preflight-meeting-bot-deploy.mjs'));
    copyFileSync(new URL('./meetingBotImage.mjs',import.meta.url),join(root,'scripts/lib/meetingBotImage.mjs'));
    writeFileSync(join(root,'scripts/migrate-d1.mjs'),"import{appendFileSync}from'node:fs';appendFileSync(process.env.TRACE,'migrate\\n');");
    writeFileSync(join(root,'bin/git'),'#!/bin/sh\nprintf "'+ 'c'.repeat(40)+'\\n"\n',{mode:0o755});
    writeFileSync(join(root,'bin/docker'),'#!/bin/sh\nprintf "image\\n" >> "$TRACE"\nexit "${IMAGE_EXIT:-0}"\n',{mode:0o755});
    writeFileSync(join(root,'meeting-bot/Dockerfile'),'FROM scratch\n');writeFileSync(join(root,'meeting-bot/.dockerignore'),'*\n');
    writeFileSync(join(root,'package.json'),JSON.stringify({type:'module',scripts:{predeploy:command}}));
    const trace=join(root,'trace');
    const run=exit=>{writeFileSync(trace,'');const result=spawnSync('npm',['run','predeploy'],{cwd:root,encoding:'utf8',env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,TRACE:trace,IMAGE_EXIT:String(exit)}});return {result,trace:readFileSync(trace,'utf8')};};
    const failure=run(7);assert.notEqual(failure.result.status,0);assert.equal(failure.trace,'image\n');
    const success=run(0);assert.equal(success.result.status,0,success.result.stderr);assert.equal(success.trace,'image\nmigrate\n');
  }finally{rmSync(root,{recursive:true,force:true});}
}
test('B8 npm deployment cannot migrate after a failed real image build',()=>ordered());
test('B8 deployment-order mutations fail while restored controls pass',()=>{
  ordered();assert.throws(()=>ordered(predeploy.split(' && ').reverse().join(' && ')));ordered();
  assert.throws(()=>ordered(predeploy.replace('node scripts/preflight-meeting-bot-deploy.mjs && ','')));ordered();
});
function config(source){
  const sections=parseSections(source);
  for(const prefix of ['', 'env.production.', 'env.preview.']){
    const host=sections.find(s=>s.name===prefix+'containers');
    assert.equal(host?.kv.get('class_name'),'"MeetingBotContainer"');assert.equal(host?.kv.get('scheduling_policy'),'"durable_object"');
    const image=sections.find(s=>s.name===prefix+'containers.images.runtime');
    assert.equal(image?.kv.get('dockerfile'),'"./meeting-bot/Dockerfile"');assert.equal(image?.kv.get('build_context'),'"./meeting-bot"');
    assert.ok(sections.some(s=>s.name===prefix+'durable_objects.bindings'&&s.kv.get('name')==='"MEETING_BOT_CONTAINER"'&&s.kv.get('class_name')==='"MeetingBotContainer"'));
    assert.ok(sections.some(s=>s.name===prefix+'migrations'&&s.kv.get('new_sqlite_classes')==='["MeetingBotContainer"]'));
  }
}
test('B8 default, production and preview use the same host/image/binding and SQLite class',()=>{
  const source=readFileSync(new URL('../../wrangler.toml',import.meta.url),'utf8');config(source);
  assert.deepEqual(missingFromProduction(),[]);assert.deepEqual(unknownTables(),[]);
  for(const before of ['[env.preview.containers.images.runtime]','[env.production.containers.images.runtime]','name = "MEETING_BOT_CONTAINER"','scheduling_policy = "durable_object"','new_sqlite_classes = ["MeetingBotContainer"]']){
    assert.ok(source.includes(before));assert.throws(()=>config(source.replace(before,before.replace(/MeetingBotContainer|runtime|durable_object|MEETING_BOT_CONTAINER/,'missing'))));config(source);
  }
});
function workflow(source){
  const end=source.indexOf('  # Step 9');const deploy=source.slice(0,end);
  const image=deploy.indexOf('run: node scripts/preflight-meeting-bot-deploy.mjs'),migrate=deploy.indexOf('run: node scripts/migrate-d1.mjs --remote');
  assert.ok(image>0 && image<migrate);assert.ok(migrate<deploy.indexOf('npx --no-install wrangler deploy'));
}
test('B8 Actions deploy builds before migrations; offline CI validates both environments',()=>{
  const source=readFileSync(new URL('../../.github/workflows/cloudflare-worker-deploy.yml',import.meta.url),'utf8');workflow(source);
  assert.throws(()=>workflow(source.replace('run: node scripts/preflight-meeting-bot-deploy.mjs','run: true')));workflow(source);
  const image=readFileSync(new URL('../../.github/workflows/meeting-bot-image.yml',import.meta.url),'utf8');
  assert.ok(image.includes('node scripts/dry-run-meeting-bot-deploy.mjs'));
});
test('B8 provisioned/new branch workflows also build before any branch migrations',()=>{
  const source=readFileSync(new URL('../../.github/workflows/cloudflare-worker-deploy.yml',import.meta.url),'utf8');
  const provision=readFileSync(new URL('../../.github/workflows/branch-provision.yml',import.meta.url),'utf8');
  const check=(text,migration)=>{const image=text.indexOf('run: node scripts/preflight-meeting-bot-deploy.mjs');assert.ok(image>=0 && image<text.indexOf(migration));};
  const branches=source.slice(source.indexOf('\n  branches:'));
  check(branches,'node scripts/migrate-d1.mjs --branch');check(provision,'node scripts/migrate-d1.mjs --branch');
  for(const text of [branches,provision]){
    assert.ok(text.includes('wrangler@4.149.0'));assert.ok(!text.includes('wrangler@4.131.0'));
    assert.throws(()=>check(text.replace('run: node scripts/preflight-meeting-bot-deploy.mjs','run: true'),'node scripts/migrate-d1.mjs --branch'));
  }
});
