import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// The production wrapper runs unchanged. Only the external Vite/prerender
// commands are fixture writers, so its destructive rebuild and restore use
// real files without compiling the SPA thousands of times in mutation checks.
function fixture({ assets=2, publicFiles=0, history=false, smallCaps=false }={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asset-wrapper-test-'));
  fs.mkdirSync(path.join(dir,'scripts/lib'),{recursive:true});
  fs.mkdirSync(path.join(dir,'frontend/src'),{recursive:true});
  fs.mkdirSync(path.join(dir,'bin'));
  for(const name of ['build-frontend.mjs','check-docs-assets-closure.mjs','lib/assetRetention.mjs','lib/assetGeneration.mjs','lib/assetsIgnore.mjs','lib/sourceTreeHash.mjs']) {
    fs.copyFileSync(new URL('../'+name,import.meta.url),path.join(dir,'scripts',name));
  }
  // Bound the failure fixtures to 16 assets / 32 total files. The real
  // wrapper still runs unchanged; the pure policy test pins production's
  // 18,000 / 20,000 defaults. This avoids 40,000 writes per mutation run.
  if(smallCaps) {
    const helper=path.join(dir,'scripts/lib/assetRetention.mjs');
    fs.writeFileSync(helper,fs.readFileSync(helper,'utf8')
      .replace(/export const ASSET_MAX_FILES = [\d_]+;/,'export const ASSET_MAX_FILES = 16;')
      .replace(/export const STATIC_FILE_LIMIT = [\d_]+;/,'export const STATIC_FILE_LIMIT = 32;'));
  }
  const fake=path.join(dir,'bin/npm');
  fs.writeFileSync(fake,`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const docs=path.resolve(process.cwd(),'../docs');fs.rmSync(docs,{recursive:true,force:true});fs.mkdirSync(path.join(docs,'assets'),{recursive:true});
for(let i=0;i<${assets};i++)fs.writeFileSync(path.join(docs,'assets',i===0?'current.js':'fresh-'+i+'.js'),'');
fs.writeFileSync(path.join(docs,'index.html'),'<script src="/assets/current.js"></script>');
`);
  fs.chmodSync(fake,0o755);
  fs.writeFileSync(path.join(dir,'scripts/prerender-og.mjs'),`import fs from 'node:fs';const docs=new URL('../docs/',import.meta.url);for(let i=0;i<${publicFiles};i++)fs.writeFileSync(new URL('public-'+i+'.txt',docs),'');`);
  if(history){
    const assetsDir=path.join(dir,'docs/assets');fs.mkdirSync(assetsDir,{recursive:true});
    const builds=(Array.isArray(history)?history:[1,2,3]).map(h=>({ts:new Date(Date.now()-h*3_600_000).toISOString(),deployedAt:new Date(Date.now()-h*3_600_000).toISOString(),files:[`old-${h}.js`,`lazy-${h}.js`]}));
    for(const b of builds){fs.writeFileSync(path.join(assetsDir,b.files[0]),`import './${b.files[1]}'`);fs.writeFileSync(path.join(assetsDir,b.files[1]),'');}
    fs.writeFileSync(path.join(dir,'docs/.asset-retention.json'),JSON.stringify({version:2,builds}));
    fs.writeFileSync(path.join(dir,'docs/index.html'),`<script src="/assets/${builds[0].files[0]}"></script>`);
    fs.writeFileSync(path.join(dir,'docs/.build-source'),'last-successful-source');
  }
  const run=(env={},argv=['--seed-restored-tree'])=>spawnSync(process.execPath,[path.join(dir,'scripts/build-frontend.mjs'),...argv],{cwd:dir,encoding:'utf8',env:{...process.env,...env,PATH:path.join(dir,'bin')+path.delimiter+path.dirname(process.execPath)+path.delimiter+process.env.PATH},timeout:60000});
  return {dir,run,remove:()=>fs.rmSync(dir,{recursive:true,force:true})};
}

test('D1364: real wrapper restores every chunk of recent generations across the Vite wipe',()=>{
  const f=fixture({history:true});
  try {
    const result=f.run();
    assert.equal(result.status,0);
    assert.deepEqual(fs.readdirSync(path.join(f.dir,'docs/assets')).sort(),['current.js','fresh-1.js','lazy-1.js','lazy-2.js','lazy-3.js','old-1.js','old-2.js','old-3.js']);
    const ledger=JSON.parse(fs.readFileSync(path.join(f.dir,'docs/.asset-retention.json'),'utf8'));
    assert.equal(ledger.builds.length,4);
    assert.equal(ledger.builds[0].deployedAt,null);
  } finally {f.remove();}
});

test('D1364: wrapper rejects over-cap output and preserves the last deployed tree for retry',()=>{
  const f=fixture({assets:17,history:true,smallCaps:true});
  try {
    const result=f.run();
    assert.equal(result.status,1);
    assert.match(result.stderr,/protected asset generations exceed/);
    assert.deepEqual(fs.readdirSync(path.join(f.dir,'docs/assets')).sort(),['lazy-1.js','lazy-2.js','lazy-3.js','old-1.js','old-2.js','old-3.js']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'docs/.asset-retention.json'),'utf8')).builds[0].files[0],'old-1.js');
    assert.equal(fs.readFileSync(path.join(f.dir,'docs/.build-source'),'utf8'),'last-successful-source');
  } finally {f.remove();}
});

test('D1364: wrapper counts non-asset files against the full static upload limit',()=>{
  const f=fixture({publicFiles:32,history:true,smallCaps:true});
  try {
    const result=f.run();
    assert.equal(result.status,1);
    assert.match(result.stderr,/static output exceeds/);
    assert.equal(fs.readFileSync(path.join(f.dir,'docs/.build-source'),'utf8'),'last-successful-source');
    assert.equal(fs.existsSync(path.join(f.dir,'docs/public-0.txt')),false);
  } finally {f.remove();}
});

test('D1364: a configured one-build floor cannot delete the two previous deployments',()=>{
  const f=fixture({history:[73,74,75]});
  try {
    assert.equal(f.run({ASSET_RETAIN_BUILDS:'1'}).status,0);
    assert.deepEqual(fs.readdirSync(path.join(f.dir,'docs/assets')).sort(),['current.js','fresh-1.js','lazy-73.js','lazy-74.js','old-73.js','old-74.js']);
  } finally {f.remove();}
});

test('D1364: a failed external build restores the previous shell, chunks and deployment ledger',()=>{
  const f=fixture({history:true});
  try {
    fs.writeFileSync(path.join(f.dir,'bin/npm'),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
fs.rmSync(path.resolve(process.cwd(),'../docs'),{recursive:true,force:true});
process.exit(7);
`);
    const result=f.run();
    assert.equal(result.status,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'docs/.asset-retention.json'),'utf8')).builds[0].files[0],'old-1.js');
    assert.equal(fs.readFileSync(path.join(f.dir,'docs/index.html'),'utf8'),'<script src="/assets/old-1.js"></script>');
    assert.equal(fs.existsSync(path.join(f.dir,'docs/assets/lazy-1.js')),true);
  } finally {f.remove();}
});

test('D1364: an unstamped deployed cache preserves known-served history with an unknown-time grace',()=>{
  const f=fixture({history:true});
  try {
    const ledgerFile=path.join(f.dir,'docs/.asset-retention.json');
    const ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
    ledger.builds[0].deployedAt=null;
    fs.writeFileSync(ledgerFile,JSON.stringify(ledger));
    const result=f.run();
    assert.equal(result.status,0);
    assert.match(result.stderr,/::warning::.*restored deployment ledger is unstamped/);
    const saved=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
    const recovered=saved.builds.find(b=>b.files.includes('old-1.js'));
    assert.deepEqual({deployedAt:recovered?.deployedAt,legacy:recovered?.legacy,hasGrace:Number.isFinite(Date.parse(recovered?.firstSeenAt))},{deployedAt:null,legacy:true,hasGrace:true});
    assert.deepEqual(fs.readdirSync(path.join(f.dir,'docs/assets')).sort(),['current.js','fresh-1.js','lazy-1.js','lazy-2.js','lazy-3.js','old-1.js','old-2.js','old-3.js']);
    assert.equal(f.run({},[]).status,0);
  } finally {f.remove();}
});

test('D1364: explicitly legacy timestamps retain their grace in a restored deployment cache',()=>{
  const f=fixture({history:true});
  try {
    const ledgerFile=path.join(f.dir,'docs/.asset-retention.json');
    const ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
    for(const b of ledger.builds) { b.deployedAt=null; b.legacy=true; b.firstSeenAt=new Date().toISOString(); }
    fs.writeFileSync(ledgerFile,JSON.stringify(ledger));
    assert.equal(f.run().status,0);
    assert.deepEqual(JSON.parse(fs.readFileSync(ledgerFile,'utf8')).builds.map(b=>b.deployedAt),[null,null,null,null]);
  } finally {f.remove();}
});
