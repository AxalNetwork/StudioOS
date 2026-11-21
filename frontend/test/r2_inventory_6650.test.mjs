/** D6650: synthetic typed source fixtures prove complete R2 classification and fail-closed new-prefix/provenance checks. No bucket is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {scanR2,bucketDeclarations,classifyCalls,renderInventory,staleReferences} from '../../scripts/build-r2-inventory.mjs';
const declarations=`interface R2MultipartUpload {uploadPart(n:number,b:unknown):Promise<void>;complete(parts:unknown[]):Promise<void>;abort():Promise<void>}
interface R2Bucket {put(key:string,body:unknown):Promise<void>;delete(key:string|string[]):Promise<void>;createMultipartUpload(key:string):R2MultipartUpload;resumeMultipartUpload(key:string,id:string):R2MultipartUpload}
interface KVNamespace {put(key:string,v:string):Promise<void>;delete(key:string):Promise<void>}
interface Env {FILES:R2Bucket;TOKENS:KVNamespace}`;
function fixture(t,body){
 const root=mkdtempSync(join(tmpdir(),'r2-inventory-6650-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'src'));
 writeFileSync(join(root,'wrangler.toml'),'main="src/index.ts"\n[[r2_buckets]]\nbinding="FILES"\nbucket_name="synthetic-files"\n');
 writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',types:[],skipLibCheck:true},include:['src/**/*.ts']}));
 const source=join(root,'src/index.ts');const write=value=>writeFileSync(source,declarations+'\n'+value);write(body);
 const row=(id,prefix,kind='record')=>({id,bucket:'synthetic-files',prefix,class:kind,purpose:'Synthetic fixture',retention_period:'not recorded',retention_basis:'not recorded',retention_days:null,locked_copy:'no'});
 const registry={version:1,classes:[row('record','records/'),row('media','media/','replaceable')],key_references:[]};
 const scan=()=>scanR2(root,['tsconfig.json']);const classify=calls=>classifyCalls(calls||scan(),registry,bucketDeclarations(root));
 return {root,source,write,registry,scan,classify};
}
test('typed aliases, computed methods and helper parameters map to classified prefixes; KV writes are excluded',t=>{
 const f=fixture(t,'async function save(bucket:R2Bucket,key:string){await bucket.put(key,"synthetic");}\nexport async function run(env:Env,id:string){const alias=env.FILES;const key=`records/${id}/proof`;await alias["put"](key,"synthetic");await save(alias,key);await env.FILES.delete(key);await env.TOKENS.put("unclassified-kv/","x");await env["TOKENS"].put("unclassified-kv/","x");}');
 const sites=f.classify();assert.ok(sites.some(c=>c.scope==='save'&&c.classes.includes('record')));assert.ok(sites.some(c=>c.scope==='run'&&c.method==='put'),'computed bucket alias remains inventoried');assert.ok(sites.some(c=>c.key==='key'&&c.method==='delete'));assert.equal(sites.some(c=>c.key.includes('unclassified-kv')),false);
 assert.ok(sites.every(c=>c.bindings.includes('FILES')&&c.file==='src/index.ts'&&c.line>1));
 const markdown=renderInventory(f.registry,bucketDeclarations(f.root),sites);assert.match(markdown,/synthetic-files/);assert.match(markdown,/src\/index.ts:\d+/);assert.match(markdown,/not recorded/);assert.equal(markdown,renderInventory(f.registry,bucketDeclarations(f.root),sites));
});
test('a new formation-record prefix cannot pass through an existing helper without classification',t=>{
 const f=fixture(t,'async function save(bucket:R2Bucket,key:string){await bucket.put(key,"synthetic");}\nexport async function run(env:Env){await save(env.FILES,"records/synthetic");}');
 f.classify();f.write('async function save(bucket:R2Bucket,key:string){await bucket.put(key,"synthetic");}\nexport async function run(env:Env){await save(env.FILES,"formation-packs/synthetic");}');
 assert.throws(()=>f.classify(),/unclassified synthetic-files prefix "formation-packs/);
});
test('a dominating assignment identifies the actual write prefix, not pre-write or failed-write sentinels',t=>{
 const body='export async function run(env:Env,id:string,flag:boolean){let key="inline:never-stored";if(flag){key=`records/${id}`;try{await env.FILES.put(key,"synthetic");}catch{key="inline:failed";}}}';
 const f=fixture(t,body);const sites=f.classify();assert.ok(sites[0].values.every(v=>v.text.startsWith('records/')));
 f.write(body.replace('records/','unclassified/'));assert.throws(()=>f.classify(),/unclassified synthetic-files prefix/);
});
test('stored-key deletion needs reviewed provenance; a changed key expression or a new site re-opens review',t=>{
 const body='export async function erase(env:Env,row:{key:string,other:string}){await env.FILES.delete(row.key);}';
 const f=fixture(t,body),calls=f.scan();assert.throws(()=>f.classify(calls),/unresolved key row\.key/);
 const c=calls[0];f.registry.key_references.push({site:[c.file,c.scope,c.method,c.key].join(' | '),classes:['record'],evidence:'Synthetic records writer'});
 assert.ok(f.classify(calls)[0].classes.includes('record'));
 f.write(body.replace('delete(row.key)','delete(row.other)'));assert.throws(()=>f.classify(),/unresolved key row\.other/);
 f.write(body.replace('{await','{await env.FILES.delete(row.key);await env.FILES.delete(row.other);await'));assert.throws(()=>f.classify(),/unresolved key row\.other/);
});
test('an unrelated edit to a reviewed handler keeps its provenance: nothing derived from source is committed',t=>{
 const body='export async function erase(env:Env,row:{key:string}){await env.FILES.delete(row.key);}';
 const f=fixture(t,body),c=f.scan()[0];f.registry.key_references.push({site:[c.file,c.scope,c.method,c.key].join(' | '),classes:['record'],evidence:'Synthetic records writer'});
 f.write(body.replace('{await','{console.log("an unrelated change in the same handler");const unused=1+1;await'));
 assert.ok(f.classify()[0].classes.includes('record'));
 f.registry.key_references[0].review_hash='0'.repeat(64);assert.throws(()=>f.classify(),/review_hash; source fingerprints are derived output/);
});
test('multipart initiation, parts, completion, resume and abort are also inventoried',t=>{
 const f=fixture(t,'export async function upload(env:Env,id:string){const h=env.FILES.createMultipartUpload(`media/${id}`);await h.uploadPart(1,"synthetic");await h.complete([]);await env.FILES.resumeMultipartUpload("media/synthetic","upload").abort();}');
 const methods=new Set(f.classify().map(c=>c.method));for(const method of ['createMultipartUpload','uploadPart','complete','resumeMultipartUpload','abort'])assert.ok(methods.has(method),method);
});
test('unknown legal retention cannot accidentally enable a locked copy',t=>{
 const f=fixture(t,'export async function run(env:Env){await env.FILES.put("records/synthetic","x");}');
 f.registry.classes[0].locked_copy='yes';f.registry.classes[0].retention_days=2555;assert.throws(()=>f.classify(),/Unapproved locked-copy/);
});
test('unrecognised buckets fail rather than silently dropping call sites; stale provenance is reported',t=>{
 const f=fixture(t,'export async function run(env:Env){await env.FILES.put("records/synthetic","x");}');
 const calls=f.scan();assert.throws(()=>classifyCalls(calls,f.registry,[{binding:'FILES',bucket:'other-bucket'}]),/unclassified other-bucket prefix/);
 f.registry.key_references.push({site:'removed site',classes:['record'],evidence:'old'});assert.deepEqual(staleReferences(calls,f.registry),['removed site']);assert.ok(f.classify(calls).every(c=>c.classes.includes('record')),'a removed site is a note, never a mutation left unclassified');
});

test('destructured and computed aliases cannot hide a new unclassified write',t=>{
 const f=fixture(t,'export async function run(env:Env){const {put:write}=env.FILES;const operation="put";await write("records/synthetic","x");await env.FILES[operation]("records/synthetic","x");}');
 assert.ok(f.classify().every(c=>c.method==='put'));
 f.write('export async function run(env:Env){const {put:write}=env.FILES;await write("new-prefix/synthetic","x");}');assert.throws(()=>f.classify(),/unclassified synthetic-files prefix/);
});

test('the actual CLI check exits nonzero when a new source prefix is not classified',t=>{
 const body='export async function run(env:Env){await env.FILES.put("records/synthetic","x");}';const f=fixture(t,body);
 mkdirSync(join(f.root,'scripts'));mkdirSync(join(f.root,'documentation/operations'),{recursive:true});
 for(const dir of ['cloudflare-worker','cloudflare-worker-tail']){mkdirSync(join(f.root,dir));writeFileSync(join(f.root,dir,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',types:[]},include:['../src/**/*.ts']}));}
 mkdirSync(join(f.root,'scripts/lib'));for(const file of ['build-r2-inventory.mjs','lib/generatedOutput.mjs'])copyFileSync(fileURLToPath(new URL(`../../scripts/${file}`,import.meta.url)),join(f.root,'scripts',file));
 symlinkSync(fileURLToPath(new URL('../../node_modules',import.meta.url)),join(f.root,'node_modules'),'dir');
 writeFileSync(join(f.root,'documentation/operations/R2_INVENTORY.json'),JSON.stringify(f.registry));
 const cli=join(f.root,'scripts/build-r2-inventory.mjs');execFileSync(process.execPath,[cli,'--write']);execFileSync(process.execPath,[cli,'--check']);
 execFileSync('git',['init','-q'],{cwd:f.root});execFileSync('git',['add','-f','documentation/operations/R2_INVENTORY.md'],{cwd:f.root});
 assert.throws(()=>execFileSync(process.execPath,[cli,'--check'],{stdio:'pipe'}),error=>error.status===1&&/R2_INVENTORY\.md is tracked by git/.test(String(error.stderr)));
 execFileSync('git',['rm','-q','--cached','documentation/operations/R2_INVENTORY.md'],{cwd:f.root});execFileSync(process.execPath,[cli,'--check']);
 f.write(body.replace('records/','new-unclassified/'));
 assert.throws(()=>execFileSync(process.execPath,[cli,'--check'],{stdio:'pipe'}),error=>error.status===1&&/unclassified.*new-unclassified/.test(String(error.stderr)));
});

test('ambiguous duplicate classes and non-string key flows cannot create empty green coverage',t=>{
 const f=fixture(t,'export async function run(env:Env){await env.FILES.put("records/synthetic","x");}');
 f.registry.classes.push({...f.registry.classes[0],id:'conflicting',class:'replaceable'});assert.throws(()=>f.classify(),/duplicate R2 class/);
 f.registry.classes.pop();f.write('export async function run(env:Env){await env.FILES.put(null as any,"x");}');assert.throws(()=>f.classify(),/non-string R2 key/);
});
