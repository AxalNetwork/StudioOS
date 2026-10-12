import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';
import { actual, checks, paths } from './_founder_tool_checks.mjs';

for (const [name,check] of Object.entries(checks)) test('#1539 '+name,()=>check(actual));

async function changed(kind,old,replacement,index) {
  if(kind==='existence')return {...actual,oldTabsExist:true};
  const source=readFileSync(paths[kind],'utf8');
  if(!source.includes(old))throw Error('Stale #1539 mutation: '+old);
  const sources={...actual.sources,[kind]:source.replace(old,replacement)};
  if(['app','route','match'].includes(kind))return {...actual,sources};
  const overrides=new Map();
  if(kind==='navigation')overrides.set(resolve(paths.navigation),sources.navigation);
  if(kind==='module')overrides.set(resolve(paths.module),sources.module);
  if(kind==='back')overrides.set(resolve(paths.back),sources.back);
  if(kind==='shell')overrides.set(resolve(paths.shell),sources.shell);
  const cache=new Map();
  async function url(path){
    const full=resolve(path);if(cache.has(full))return cache.get(full);
    const {code}=await transformWithOxc(overrides.get(full)||readFileSync(full,'utf8'),full,{jsx:{runtime:'automatic'}});
    const req=createRequire(pathToFileURL(full));
    const imports=[...code.matchAll(/from (['"])([^'"]+)\1/g)];
    let js=code;
    for(const match of imports){
      const [all,q,spec]=match;let target;
      try{target=spec.startsWith('.')?resolve(dirname(full),spec):req.resolve(spec);
        if(existsSync(target)&&statSync(target).isDirectory())target=['index.js','index.jsx'].map(name=>resolve(target,name)).find(existsSync)||target;
        else if(!existsSync(target))target=['.js','.jsx','.ts'].map(ext=>target+ext).find(existsSync)||target;
      }catch{continue;}
      const destination=overrides.has(target)?await url(target):pathToFileURL(target).href;
      js=js.replace(all,'from '+q+destination+q);
    }
    const result='data:text/javascript;base64,'+Buffer.from(js+'\n// 1539 '+index).toString('base64');cache.set(full,result);return result;
  }
  const out={...actual,sources};
  if(kind==='navigation'){
    out.navigation=await import(await url(paths.navigation));
    out.CycleModulePage=(await import(await url(paths.module))).default;
    out.FounderModuleBackLink=(await import(await url(paths.back))).default;
  }else if(kind==='module')out.CycleModulePage=(await import(await url(paths.module))).default;
  else if(kind==='back')out.FounderModuleBackLink=(await import(await url(paths.back))).default;
  else if(kind==='shell')out.SHELLS=(await import(await url(paths.shell))).SHELLS;
  return out;
}
const probes=[
 ['gates','navigation','hasTier(user, tool.requiredTier)','true'],
 ['gates','navigation',"if (!['admin', 'founder'].includes(user?.role)) return [];","if (false) return [];"],
 ['returns','back','to={link.href}','to="/wrong-module"'],
 ['returns','back','data-testid="founder-module-back"','data-testid="lost-back-link"'],
 ['project','navigation',"params.get('project_id') || params.get('project')","params.get('project_id')"],
 ['otherRoles','navigation',"if (!['admin', 'founder'].includes(user?.role)) return null;","if (false) return null;"],
 ['cleanup','existence','',''],
 ['cleanup','app','const founderEditor =','const FounderWorkspaceTabs = lazy(() => import("./pages/founder/FounderWorkspaceTabs")); const founderEditor ='],
 ['bindings','app','<FounderModuleBackLink user={user} />','<span />'],
 ['bindings','route','tools={moduleToolLinks(cycle, slug, user, q)}','tools={[]}'],
 ['redirect','app',"pathname: '/raise/capital-match'","pathname: '/grow/capital-match'"],
 ['redirect','app','hash: location.hash','hash: ""'],
 ['match','match','workspace="Raise"','workspace="Grow"'],
 ['match','match','<FounderModuleBackLink user={user} />','<span />'],
 ['shell','shell',"prefix: '/raise', tagline:","prefix: '/grow', tagline:"],
 ['guards','navigation',"roles: ['admin', 'founder', 'partner', 'investor', 'advisor']","roles: ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring']"],
 ['doors','module','className={MODULE_LINK_CLASS}','className="rounded-xl border bg-white"'],
];
const nav=readFileSync(paths.navigation,'utf8');
for(const line of nav.split('\n').filter(l=>l.includes('{ path:'))){
 const path=line.match(/path: '([^']+)'/)[1];
 const cycle=line.match(/cycle: '([^']+)'/)[1];
 const other={validate:'problem-discovery',build:'solution-design',raise:'fundraising-readiness',grow:'product-improvement'}[cycle];
 probes.push([line.includes('door: true')?'doors':'returns','navigation',line,line.replace(/module: '[^']+'/, "module: '"+other+"'")]);
 if(line.includes('door: true'))probes.push(['doors','navigation',"path: '"+path+"'","path: '/lost-tool'"]);
}
for(const [index,[name,kind,old,replacement]]of probes.entries())test('#1539 mutation/restoration '+name+' '+index,async()=>{
 const mutant=await changed(kind,old,replacement,index);
 await assert.rejects(async()=>checks[name](mutant),assert.AssertionError);
 checks[name](actual);
});
