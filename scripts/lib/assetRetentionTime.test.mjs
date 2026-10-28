import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planAssetRetention, recordAssetDeployment, ASSET_RETENTION_HOURS, ASSET_MIN_BUILDS, ASSET_MAX_FILES, STATIC_FILE_LIMIT } from './assetRetention.mjs';
const now = '2026-10-28T12:00:00.000Z';
const ago = hours => new Date(Date.parse(now) - hours * 3_600_000).toISOString();
const build = (name, hours, files = [name]) => ({ ts: ago(hours + 1), deployedAt: ago(hours), files });
function plan(builds, options = {}) {
  return planAssetRetention({ now, newFiles: ['current.js'], prevFiles: builds.flatMap(b => b.files), ledgerBuilds: builds, ...options });
}

test('D1364: every deployment inside 72 hours survives, including the boundary and more than three builds', () => {
  const p = plan([build('one.js', 1), build('two.js', 2), build('three.js', 71), build('boundary.js', 72)]);
  assert.deepEqual(p.keep, ['current.js','one.js','two.js','three.js','boundary.js']);
  assert.deepEqual(p.restore, ['one.js','two.js','three.js','boundary.js']);
  assert.deepEqual([ASSET_RETENTION_HOURS,ASSET_MIN_BUILDS,ASSET_MAX_FILES,STATIC_FILE_LIMIT], [72,3,18000,20000]);
});

test('D1364: builds past their last-served window are pruned while the latest three remain', () => {
  assert.deepEqual(plan([build('one.js', 1),build('two.js',2),build('boundary.js',72.001),build('expired.js',100)]).keep,['current.js','one.js','two.js','boundary.js']);
  assert.deepEqual(plan([build('one.js',73),build('two.js',74),build('expired.js',75)]).keep,['current.js','one.js','two.js']);
});

test('D1364: cap removes oldest complete builds by deploy time, not incoming ledger order', () => {
  const p = plan([build('older.js',3),build('oldest.js',4),build('newest.js',1),build('second.js',2)], {maxFiles:4});
  assert.deepEqual(p.keep,['current.js','newest.js','second.js','older.js']);
  assert.deepEqual([p.capPrunedBuilds,p.capExceeded],[1,false]);
  assert.deepEqual(p.nextLedger.builds.slice(1).map(b=>b.deployedAt),[ago(1),ago(2),ago(3)]);
});

test('D1364: shared chunks survive whole-build eviction without falsely consuming the cap twice', () => {
  const p=plan([build('a',1,['a.js','shared.js']),build('b',2,['b.js','shared.js']),build('c',3,['c.js','shared.js']),build('d',4,['d.js','shared.js'])],{newFiles:['current.js','shared.js'],maxFiles:4});
  assert.deepEqual(p.keep,['current.js','shared.js','a.js','b.js']);
  assert.deepEqual(p.restore,['a.js','b.js']);
  assert.deepEqual([p.capPrunedBuilds,p.capExceeded],[2,false]);
});

test('D1364: newest output and the protected floor are never deleted to hide an over-cap build', () => {
  const p=plan([build('a.js',1),build('b.js',2),build('c.js',3)],{newFiles:['current.js','current.css'],maxFiles:1});
  assert.deepEqual(p.keep,['current.js','current.css','a.js','b.js']);
  assert.equal(p.capExceeded,true);
  assert.deepEqual(p.nextLedger.builds[0].files,['current.js','current.css']);
});

test('D1364: legacy ledger gets one conservative grace period, without inventing a deploy time', () => {
  const p=plan([{ts:ago(200),files:['old-a.js']},{ts:ago(201),files:['old-b.js']},{ts:'pre-retention',files:['unknown.js']}]);
  assert.deepEqual(p.keep,['current.js','old-a.js','old-b.js','unknown.js']);
  assert.deepEqual(p.nextLedger.builds.slice(1).map(b=>[b.deployedAt,b.firstSeenAt]),[[null,now],[null,now],[null,now]]);
  const later=planAssetRetention({now:new Date(Date.parse(now)+73*3_600_000).toISOString(),newFiles:['later.js'],prevFiles:p.keep,ledgerBuilds:recordAssetDeployment(p.nextLedger,now).builds});
  assert.deepEqual(later.keep,['later.js','current.js','old-a.js']);
});

test('D1364: an undeployed build neither displaces a deployed build nor crowds out the window', () => {
  const p=plan([{ts:now,deployedAt:null,files:['never-shipped.js']},build('live-a.js',1),build('live-b.js',2)]);
  assert.deepEqual(p.keep,['current.js','live-a.js','live-b.js']);
});

test('D1364: real deployment time controls expiry, not an earlier build time', () => {
  const p=plan([{ts:ago(200),deployedAt:ago(1),files:['late-deploy.js']},build('a.js',2),build('b.js',3)]);
  assert.deepEqual(p.keep,['current.js','late-deploy.js','a.js','b.js']);
  assert.equal(p.nextLedger.builds[0].deployedAt,null);
  const deployed=new Date(Date.parse(now)+30*60_000).toISOString();
  const stamped=recordAssetDeployment(p.nextLedger,deployed);
  assert.equal(stamped.builds[0].deployedAt,deployed);
  assert.equal(p.nextLedger.builds[0].deployedAt,null);
  assert.equal(stamped.builds[1].deployedAt,ago(1));
});

test('D1364: identical redeployment refreshes its timestamp without consuming another generation', () => {
  const p=plan([build('current.js',1),build('prior.js',2)]);
  assert.deepEqual(recordAssetDeployment(p.nextLedger,now).builds.map(b=>[b.files,b.deployedAt]),[[['current.js'],now],[['prior.js'],ago(2)]]);
});

test('D1364: invalid policy and deployment records fail instead of inventing a timestamp', () => {
  assert.throws(()=>plan([],{maxFiles:0}),/Invalid asset file cap/);
  assert.throws(()=>plan([],{retentionHours:NaN}),/Invalid asset retention window/);
  assert.throws(()=>recordAssetDeployment({builds:[]},now),/valid build ledger/);
  assert.throws(()=>recordAssetDeployment({builds:[{files:[]}]},'bad-time'),/valid build ledger/);
});

test('D1364: the post-deploy CLI records the real timestamp and refuses a missing ledger', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asset-deploy-test-'));
  try {
    fs.mkdirSync(path.join(dir,'scripts/lib'),{recursive:true}); fs.mkdirSync(path.join(dir,'docs'));
    for(const file of ['record-asset-deploy.mjs','lib/assetRetention.mjs','lib/assetsIgnore.mjs']) fs.copyFileSync(new URL('../'+file,import.meta.url),path.join(dir,'scripts',file));
    const ledger=path.join(dir,'docs/.asset-retention.json');
    fs.writeFileSync(ledger,JSON.stringify(plan([]).nextLedger));
    const before=Date.now();
    const result=spawnSync(process.execPath,[path.join(dir,'scripts/record-asset-deploy.mjs')],{encoding:'utf8'});
    assert.equal(result.status,0);
    const time=JSON.parse(fs.readFileSync(ledger,'utf8')).builds[0].deployedAt;
    assert.equal(Date.parse(time)>=before && Date.parse(time)<=Date.now(),true);
    fs.unlinkSync(ledger);
    assert.equal(spawnSync(process.execPath,[path.join(dir,'scripts/record-asset-deploy.mjs')]).status,1);
    assert.equal(fs.existsSync(ledger),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('D1364: manual deployment records success before its live-check postdeploy', () => {
  const pkg=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts.postdeploy,'node scripts/record-asset-deploy.mjs && node scripts/check-spa-live.mjs');
});

test('D1364: an identical rebuild keeps the served timestamp even if it is not deployed',()=>{
  const p=plan([build('current.js',1),build('prior.js',2)]);
  assert.equal(p.nextLedger.builds[0].deployedAt,ago(1));
  const retried=planAssetRetention({now,newFiles:['changed.js'],prevFiles:p.keep,ledgerBuilds:p.nextLedger.builds});
  assert.deepEqual(retried.keep,['changed.js','current.js','prior.js']);
});

test('D1364: a quiet-site build survives 72 hours after supersession despite many rapid deploys',()=>{
  const p=plan([build('recent-a.js',1),build('recent-b.js',2),build('long-lived.js',200),build('expired.js',201)]);
  assert.deepEqual(p.keep,['current.js','recent-a.js','recent-b.js','long-lived.js']);
  const boundary=plan([build('a.js',1),build('b.js',2),build('c.js',72),build('old.js',200),build('expired.js',201)]);
  assert.deepEqual(boundary.keep,['current.js','a.js','b.js','c.js','old.js']);
  const expired=plan([build('a.js',1),build('b.js',2),build('c.js',72.001),build('old.js',200)]);
  assert.deepEqual(expired.keep,['current.js','a.js','b.js','c.js']);
});

test('D1364: CI records deployment success after publish and before saving served assets',()=>{
  const source=fs.readFileSync(new URL('../../.github/workflows/cloudflare-worker-deploy.yml',import.meta.url),'utf8');
  const publish=source.indexOf('if npx --no-install wrangler deploy --config');
  const mark=source.indexOf('run: node scripts/record-asset-deploy.mjs');
  const save=source.indexOf('uses: actions/cache/save@');
  const step=source.slice(source.lastIndexOf('      - name:',mark),mark);
  const publisher=source.slice(source.lastIndexOf('      - name:',publish),publish);
  const cache=source.slice(source.lastIndexOf('      - name:',save),save);
  assert.deepEqual({ordered:publish>=0 && mark>publish && save>mark,
    hardFailure:!step.includes('continue-on-error: true') && !step.includes('if:'),
    ledgerSaved:source.slice(save).includes('docs/.asset-retention.json'),
    publisherId:publisher.includes('id: publish'),
    cacheAfterStampFailure:cache.includes("if: always() && steps.publish.outcome == 'success'")},
    {ordered:true,hardFailure:true,ledgerSaved:true,publisherId:true,cacheAfterStampFailure:true});
});

test('D1364: only a successful-deploy cache recovers unstamped entries, and its grace does not slide',()=>{
  const p=plan([{ts:ago(1),deployedAt:null,files:['unstamped.js']},build('a.js',2),build('b.js',3)],{restoredFromDeploy:true});
  const recovered=p.nextLedger.builds.find(b=>b.files.includes('unstamped.js'));
  assert.deepEqual([recovered?.deployedAt,recovered?.legacy,recovered?.firstSeenAt],[null,true,now]);
  const laterTime=new Date(Date.parse(now)+73*3_600_000).toISOString();
  const recent=h=>new Date(Date.parse(laterTime)-h*3_600_000).toISOString();
  const later=planAssetRetention({now:laterTime,newFiles:['next.js'],prevFiles:p.keep,restoredFromDeploy:true,ledgerBuilds:[
    {ts:recent(1),deployedAt:recent(1),files:['new-a.js']},
    {ts:recent(2),deployedAt:recent(2),files:['new-b.js']},
    ...recordAssetDeployment(p.nextLedger,now).builds,
  ]});
  assert.equal(later.keep.includes('unstamped.js'),false);
});
