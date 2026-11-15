#!/usr/bin/env node
/** D6650: source-only R2 binding/prefix inventory and fail-closed classification guard; never contacts a bucket. */
import { API } from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';
import {readdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('../',import.meta.url)));
export function scanR2(root=ROOT,configPaths=['cloudflare-worker/tsconfig.json','cloudflare-worker-tail/tsconfig.json']){
 const bucketNames=new Set(bucketDeclarations(root).map(d=>d.binding));
 const api=new API({cwd:root});
 try{
 const snapshot=api.updateSnapshot({openProjects:configPaths.map(p=>resolve(root,p))});
 const sources=[...new Set(snapshot.getProjects().flatMap(p=>p.program.getSourceFileNames()).filter(p=>p.startsWith(root+'/')&&!p.includes('/node_modules/')&&!p.endsWith('.d.ts')&&!p.includes('/test/')))];
 let program,checker;
const un=n=>{while(n&&(ts.isNonNullExpression(n)||ts.isParenthesizedExpression(n)||ts.isAwaitExpression(n)||ts.isAsExpression(n)||n.kind===ts.SyntaxKind.TypeAssertionExpression||ts.isSatisfiesExpression(n)))n=n.expression;return n;};
function declaration(n){let symbol=checker.getSymbolAtLocation(n);let d=(symbol?.valueDeclaration||symbol?.declarations?.[0])?.resolve();if(d&&(ts.isImportSpecifier(d)||ts.isImportClause(d)||ts.isNamespaceImport(d))){symbol=checker.getAliasedSymbol(symbol);d=(symbol?.valueDeclaration||symbol?.declarations?.[0])?.resolve();}return d;}
const UNKNOWN={text:'',complete:false};
const usageCache=new Map();
function returnValues(fn){if(!fn)return[];if(fn.body&&!ts.isBlock(fn.body))return[fn.body];const out=[];const walk=n=>{if(n!==fn&&n.parameters&&n.body)return;if(ts.isReturnStatement(n)&&n.expression)out.push(n.expression);else n.forEachChild(walk);};walk(fn);return out;}
function callsTo(fn){if(!usageCache.has(fn))usageCache.set(fn,checker.getSignatureUsage(fn).map(u=>u.call?.resolve()).filter(Boolean));return usageCache.get(fn);}
function origins(n,seen=new Set()){
 n=un(n);if(!n||seen.has(n))return[];seen.add(n);
 if(ts.isCallExpression(n)){if(ts.isPropertyAccessExpression(n.expression)&&['createMultipartUpload','resumeMultipartUpload'].includes(n.expression.name.text))return[n.expression.expression];const fn=checker.getResolvedSignature(n)?.declaration?.resolve();return returnValues(fn);}
 if(ts.isPropertyAccessExpression(n)){
  const objects=origins(n.expression,new Set(seen));const values=objects.filter(ts.isObjectLiteralExpression).flatMap(o=>o.properties.filter(p=>p.name?.getText()===n.name.text&&p.initializer).map(p=>p.initializer));if(values.length)return values;
 }
 const d=declaration(ts.isPropertyAccessExpression(n)?n.name:n);
 if(d&&ts.isVariableDeclaration(d)){
  const sym=checker.getSymbolAtLocation(n);const ancestors=new Set();for(let q=n.parent;q;q=q.parent)if(ts.isBlock(q))ancestors.add(q);
  const assignments=checker.getReferencesToSymbolInFile(n.getSourceFile().fileName,sym).map(h=>h.resolve()).filter(r=>r?.parent&&ts.isBinaryExpression(r.parent)&&r.parent.left===r&&r.parent.operatorToken.getText()==='='&&r.getStart()<n.getStart());
  const dominating=assignments.filter(r=>{for(let q=r.parent;q;q=q.parent)if(ts.isBlock(q))return ancestors.has(q);return false;}).sort((a,b)=>b.getStart()-a.getStart());
  if(dominating.length)return[dominating[0].parent.right];
  const possible=assignments.map(r=>r.parent.right);return[d.initializer,...possible].filter(Boolean);
 }
 if(d&&d.parent?.parameters?.includes(d)){const fn=d.parent,index=fn.parameters.indexOf(d);return callsTo(fn).map(c=>c.arguments?.[index]).filter(Boolean);}
 return[];
}
function bindings(n,seen=new Set()){
 n=un(n);if(!n||seen.has(n))return[];seen.add(n);
 if(ts.isPropertyAccessExpression(n)&&bucketNames.has(n.name.text))return[n.name.text];
 if(ts.isElementAccessExpression(n))return val(n.argumentExpression).filter(v=>v.complete&&bucketNames.has(v.text)).map(v=>v.text);
 if(ts.isBinaryExpression(n))return [...bindings(n.left,new Set(seen)),...bindings(n.right,new Set(seen))];
 if(ts.isConditionalExpression(n))return [...bindings(n.whenTrue,new Set(seen)),...bindings(n.whenFalse,new Set(seen))];
 return [...new Set(origins(n).flatMap(v=>bindings(v,new Set(seen))))];
}
function binding(n){return bindings(n).join('|')||null;}
function val(n,seen=new Set()){
 n=un(n);if(!n||seen.has(n))return[UNKNOWN];seen.add(n);
 if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return[{text:n.text,complete:true}];
 if(n.getText()==='null')return[];
 const combine=(left,right)=>left.flatMap(a=>a.complete?right.map(b=>({text:a.text+b.text,complete:b.complete})):[a]);
 if(ts.isTemplateExpression(n)){let out=[{text:n.head.text,complete:true}];for(const span of n.templateSpans){out=combine(out,val(span.expression,new Set(seen)));out=combine(out,[{text:span.literal.text,complete:true}]);}return out;}
 if(ts.isBinaryExpression(n)&&n.operatorToken.getText()==='+')return combine(val(n.left,new Set(seen)),val(n.right,new Set(seen)));
 if(ts.isConditionalExpression(n))return [...val(n.whenTrue,new Set(seen)),...val(n.whenFalse,new Set(seen))];
 if(ts.isCallExpression(n)&&n.expression.getText()==='String')return val(n.arguments[0],seen);
 const values=origins(n).flatMap(v=>val(v,new Set(seen)));return values.length?values:[UNKNOWN];
}
function scopeOf(n){for(let x=n.parent;x;x=x.parent){if(x.parameters&&x.body){if(x.name)return x.name.getText();if(x.parent&&ts.isVariableDeclaration(x.parent))return x.parent.name.getText();}
 if(ts.isCallExpression(x)&&ts.isPropertyAccessExpression(x.expression)&&['get','put','post','delete','patch'].includes(x.expression.name.text)&&x.arguments[0]&&ts.isStringLiteral(x.arguments[0]))return x.expression.name.text+' '+x.arguments[0].text;
 }return 'module';}
function reviewHash(key){
 const parts=new Set(),seen=new Set();
 const collect=(n,depth=0)=>{if(!n||seen.has(n)||depth>5)return;seen.add(n);const sf=n.getSourceFile();if(!sf.fileName.startsWith(root+'/')||sf.fileName.includes('/node_modules/'))return;
 parts.add(relative(root,sf.fileName)+':'+n.getText().replace(/\s+/g,' '));
 const walk=x=>{if(ts.isIdentifier(x)){const d=declaration(x);if(d&&d!==x){if(d.initializer)collect(d.initializer,depth+1);else if(d.parent?.parameters?.includes(d))for(const v of origins(x))collect(v,depth+1);}}
 if(ts.isCallExpression(x)){const fn=checker.getResolvedSignature(x)?.declaration?.resolve();if(fn?.body)collect(fn.body,depth+1);}
 x.forEachChild(walk);};walk(n);
 };collect(key);
 return createHash('sha256').update([...parts].sort().join('\n')).digest('hex');
}
const calls=[];
for(const path of sources){const project=snapshot.getDefaultProjectForFile(path)||snapshot.getProjects().find(p=>p.program.getSourceFile(path));if(!project)throw Error(`No compiler project for ${path}`);program=project.program;checker=project.checker;const sf=program.getSourceFile(path);function visit(n){
 if(ts.isCallExpression(n)){
 const e=un(n.expression);let method,obj;
 if(ts.isPropertyAccessExpression(e)){method=e.name.text;obj=e.expression;}
 else if(ts.isElementAccessExpression(e)){obj=e.expression;const names=val(e.argumentExpression).filter(v=>v.complete).map(v=>v.text);if(names.length===1)method=names[0];else if(binding(obj)||checker.typeToString(checker.getTypeAtLocation(obj)).includes('R2Bucket'))throw Error(`Unresolved R2 operation in ${relative(root,path)}; use an inspectable SDK method`);}
 else if(ts.isIdentifier(e)){const d=declaration(e);if(d?.parent?.parent&&ts.isVariableDeclaration(d.parent.parent)&&d.parent.parent.initializer){method=(d.propertyName||d.name)?.getText();obj=d.parent.parent.initializer;}}

 if(['put','delete','createMultipartUpload','resumeMultipartUpload','uploadPart','complete','abort'].includes(method)){
  const sig=checker.getResolvedSignature(n);const parent=sig?.declaration?.resolve()?.parent;const type=checker.typeToString(checker.getTypeAtLocation(obj));
  if(type.includes('R2Bucket')||type.includes('R2MultipartUpload')||parent?.name?.text==='R2Bucket'||binding(obj)){
   let key=n.arguments[0],receiver=obj;
   if(['uploadPart','complete','abort'].includes(method)){
    const init=ts.isCallExpression(un(obj))?un(obj):origins(obj).find(v=>ts.isCallExpression(un(v)));const creation=un(init);
    if(!creation||!ts.isPropertyAccessExpression(creation.expression))throw Error(`Unresolved multipart receiver at ${path}`);
    receiver=creation.expression.expression;key=creation.arguments[0];
   }
   const scope=scopeOf(n),arg=key?.getText(sf),bound=bindings(receiver),values=val(key);
   calls.push({file:relative(root,path),line:sf.text.slice(0,n.getStart()).split('\n').length,bindings:[...new Set(bound)],method,key:arg,values,scope,review_hash:createHash('sha256').update(reviewHash(key)+'\n'+(()=>{for(let f=n.parent;f;f=f.parent)if(f.parameters&&f.body)return f.getText().replace(/\s+/g,' ');return n.getText();})()).digest('hex')});

  }
 }
 }
 n.forEachChild(visit);
 }visit(sf);}
return calls.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line);
 }finally{api.close();}
}

/** R2 declarations, including preview buckets; reads configuration only. */
export function bucketDeclarations(root=ROOT){
 const configs=readdirSync(root).filter(n=>/^wrangler.*\.toml$/.test(n)).map(n=>n);
 for(const d of readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.name.startsWith('.')&&d.name!=='node_modules')){
  const candidate=resolve(root,d.name,'wrangler.toml');if(existsSync(candidate))configs.push(`${d.name}/wrangler.toml`);
 }
 const found=[];
 for(const file of configs){const text=readFileSync(resolve(root,file),'utf8');const blocks=[...text.matchAll(/^\[\[([^\]]*r2_buckets)\]\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)];
  for(const block of blocks){const binding=/^binding\s*=\s*"([A-Z_]+)"/m.exec(block[2])?.[1],bucket=/^bucket_name\s*=\s*"([a-z0-9-]+)"/m.exec(block[2])?.[1];if(!binding||!bucket)throw Error(`Unreadable R2 declaration in ${file}`);found.push({binding,bucket,environment:block[1].includes('preview')?'preview':block[1].includes('production')?'production':'default',file});}
 }
 return found;
}
const locator=c=>[c.file,c.scope,c.method,c.key].join(' | ');
const recorded=v=>typeof v==='string'&&v.trim()&&!['not recorded','pending','unconfirmed'].includes(v.trim().toLowerCase());
export function classifyCalls(calls,registry,declarations){
 if(registry.version!==1||!Array.isArray(registry.classes)||!Array.isArray(registry.key_references))throw Error('Expected version 1 classes and key_references');
 const ids=new Map(),pairs=new Set(),aliases=registry.bucket_aliases||{};
 for(const c of registry.classes){
  if(!c.id||ids.has(c.id)||pairs.has(c.bucket+'|'+c.prefix)||!['prefix','object','pattern',undefined].includes(c.match)||!['record','replaceable','log'].includes(c.class)||typeof c.prefix!=='string'||!c.prefix||!c.bucket||!['no','yes'].includes(c.locked_copy))throw Error(`Invalid or duplicate R2 class ${c.id}`);
  if(c.class==='record'&&(!c.retention_period||!c.retention_basis))throw Error(`Record ${c.id} needs an explicit period/basis or not recorded`);
  if(c.locked_copy==='yes'&&(c.class!=='record'||!recorded(c.retention_basis)||!recorded(c.approval_source)||!Number.isSafeInteger(c.retention_days)||c.retention_days<1||c.match==='pattern'))throw Error(`Unapproved locked-copy class ${c.id}`);
  ids.set(c.id,c);pairs.add(c.bucket+'|'+c.prefix);
 }
 const refs=new Map();for(const r of registry.key_references){if(refs.has(r.site)||!r.evidence||!r.review_hash)throw Error(`Invalid key provenance ${r.site}`);refs.set(r.site,r);}
 const used=new Set(),errors=[],sites=[];
 for(const call of calls){
  const ref=refs.get(locator(call)),resolved=new Set();
  if(ref){used.add(ref.site);if(ref.review_hash!==call.review_hash)errors.push(`${call.file}:${call.line}: stored-key provenance changed; review ${ref.site}; expected hash ${call.review_hash}`);}
  if(!call.values.length)errors.push(`${call.file}:${call.line}: empty or non-string R2 key cannot be classified`);
  if(!call.bindings.length)errors.push(`${call.file}:${call.line}: unresolved R2 binding`);
  for(const binding of call.bindings){
   const buckets=[...new Set(declarations.filter(d=>d.binding===binding).map(d=>d.bucket))];if(!buckets.length)errors.push(`${call.file}:${call.line}: undeclared R2 binding ${binding}`);
   for(const physical of buckets){const bucket=aliases[physical]||physical;
    for(const value of call.values){
     const candidates=registry.classes.filter(c=>c.bucket===bucket&&c.match!=='pattern'&&(c.match==='object'?value.complete&&value.text===c.prefix:value.text.startsWith(c.prefix))).sort((a,b)=>b.prefix.length-a.prefix.length);
     if(candidates.length){resolved.add(candidates[0].id);continue;}
     if(value.text){errors.push(`${call.file}:${call.line}: unclassified ${physical} prefix ${JSON.stringify(value.text)}`);continue;}
     const mapped=(ref?.classes||[]).map(id=>ids.get(id));
     if(!mapped.length||mapped.some(c=>!c)||!mapped.some(c=>c.bucket===bucket)){errors.push(`${call.file}:${call.line}: unresolved key ${call.key}; add reviewed prefix provenance (${locator(call)}, hash ${call.review_hash})`);continue;}
     for(const c of mapped.filter(c=>c.bucket===bucket))resolved.add(c.id);
    }
   }
  }
  sites.push({...call,classes:[...resolved].sort()});
 }
 for(const site of refs.keys())if(!used.has(site))errors.push(`Stale key provenance: ${site}`);
 if(errors.length)throw Error(errors.join('\n'));
 return sites;
}
const md=v=>String(v??'not recorded').replaceAll('|','\\|').replaceAll('\n',' ');
export function renderInventory(registry,declarations,sites,{includeCalls=true}={}){
 const lines=['# R2 source inventory','', '<!-- Generated by node scripts/build-r2-inventory.mjs --write; edit R2_INVENTORY.json and reviewed provenance, then regenerate. -->','',
 'Source-only inventory for #6650. No live objects, member keys or contents are read. `record` denotes original business/legal evidence requiring recovery planning; classification does not establish a legal retention basis or authorize a locked copy. Unknown periods and legal bases stay **not recorded**. All current locked-copy approvals are **no**; #6428/#6652 require counsel confirmation and synthetic-only drills.','',
 'Scope: typed R2 mutators in the main Worker and tail consumer, including aliases, helper calls, stored-key deletes and multipart video operations. Known external backup prefixes are listed with their source, but external shell/API writers are not covered by the Worker call-site guard. This is not a live bucket listing or proof that a backup/lock is configured.','',
 '## Buckets and environments','', '| Bucket | Binding | Environment | Configuration |','|---|---|---|---|'];
 for(const d of declarations.sort((a,b)=>a.bucket.localeCompare(b.bucket)||a.environment.localeCompare(b.environment)))lines.push(`| ${md(d.bucket)} | ${d.binding} | ${d.environment} | ${d.file} |`);
 lines.push('','## Classified prefixes','', '| Bucket | Prefix | Class | Purpose | Recorded retention | Rule/source | Legal retention basis | Locked copy |','|---|---|---|---|---|---|---|---|');
 const allBuckets=[...new Set(declarations.map(d=>d.bucket))].sort();
 for(const physical of allBuckets){const canonical=registry.bucket_aliases?.[physical]||physical,preview=physical!==canonical;
  for(const c of registry.classes.filter(c=>c.bucket===canonical).sort((a,b)=>a.prefix.localeCompare(b.prefix)))lines.push(`| ${physical} | \`${md(c.prefix)}\`${c.match==='pattern'?' (pattern)':c.match==='object'?' (object)':''} | ${c.class} | ${md(c.purpose)} | ${preview?'not recorded (preview)':md(c.retention_period)} | ${md((c.policy_sources||[]).join('; ')||'not recorded')} | ${preview?'not recorded':md(c.retention_basis)} | ${preview?'no':c.locked_copy} |`);
 }
 if(includeCalls){
 lines.push('','## Worker call sites','', 'Each row is a source call, not an object. Dynamic D1/list-derived keys use reviewed writer/prefix provenance from the JSON; changing that source context fails the guard. Literal/helper-derived prefixes are resolved independently, so an annotation cannot hide a new literal prefix. Lines are regenerated from the source.','', '| File and line | Binding | Operation | Key expression | Classified prefixes |','|---|---|---|---|---|');
 const byId=new Map(registry.classes.map(c=>[c.id,c]));for(const c of sites)lines.push(`| ${c.file}:${c.line} | ${c.bindings.join(', ')} | ${c.method} | \`${md(c.key)}\` | ${c.classes.map(id=>{const x=byId.get(id);return `${x.bucket}: ${x.prefix}`;}).join('; ')} |`);

 }else lines.push('','## Current Worker call sites','','Run `node scripts/build-r2-inventory.mjs` for the current file/line, binding, operation, key expression and classified prefixes of every typed R2 mutator. The committed policy table is generated from classification/configuration; unrelated source line shifts do not churn this document. Stored-key provenance remains fail-closed in `--check`.');
 lines.push('','## Planned formation records','', 'The #6680 follow-up names these record classes. Their physical prefixes are not implemented on this source baseline; none is invented here. Each new writer must add a concrete classified prefix or the guard fails. No identity-file prefix is approved (owner decision 13 A).','', '| Planned class | Prefix | Retention/basis | Approval |','|---|---|---|---|');
 for(const c of registry.planned_formation_records||[])lines.push(`| ${md(c)} | not recorded | not recorded | synthetic only; counsel confirmation pending |`);
 lines.push('','## Maintenance and recovery handoff','', '- `node scripts/build-r2-inventory.mjs` prints this inventory; `--write` regenerates it; `--check` validates classification/provenance and fails stale generated output. No flag approves a prefix automatically.', '- Review changed stored-key provenance against its named writer before updating a review hash. Do not copy an error hash into the JSON without inspecting the source contract.', '- #6428 consumes the version-1 `classes` list. Only explicit `locked_copy: yes`, `class: record`, recorded counsel basis and approved duration may qualify; this inventory currently enables none. Apply #6654 suppression decisions on restore.', '- #6651 owns write-once behavior; this task changes no Worker call site. #6428 owns the existing contracts/KYC recovery rows and setup steps 4–5.', '- Preview aliases share source classification only. They inherit no production retention promise or locked-copy approval.','');return lines.join('\n');
}
export function buildInventory(root=ROOT,configPaths){const registry=JSON.parse(readFileSync(resolve(root,'documentation/operations/R2_INVENTORY.json'),'utf8')),declarations=bucketDeclarations(root),sites=classifyCalls(scanR2(root,configPaths),registry,declarations);return{registry,declarations,sites,markdown:renderInventory(registry,declarations,sites)};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2);if(args.length>1||args.some(a=>!['--check','--write'].includes(a)))throw Error('Usage: build-r2-inventory.mjs [--check|--write]');
  const out=buildInventory(),path=resolve(ROOT,'documentation/operations/R2_INVENTORY.md');
  const policy=renderInventory(out.registry,out.declarations,out.sites,{includeCalls:false});
  if(args[0]==='--write')writeFileSync(path,policy);
  else if(args[0]==='--check'){if(!existsSync(path)||readFileSync(path,'utf8')!==policy)throw Error('R2 inventory is stale; run node scripts/build-r2-inventory.mjs --write');console.log(`R2 inventory: ${out.sites.length} classified mutator call sites; no live bucket access.`);}
  else process.stdout.write(out.markdown);
 }catch(error){console.error(`R2 inventory refused: ${error.message}`);process.exitCode=1;}
}
