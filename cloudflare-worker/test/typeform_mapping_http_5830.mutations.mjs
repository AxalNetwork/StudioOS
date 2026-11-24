/** #5830: private-copy mutation proof for dark approval, current ownership and the atomic revocation guard. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolatedMutationSource } from './_isolated_mutation_source.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
const copy=isolatedMutationSource(root);
try {
 const route=join(copy.root,'cloudflare-worker/src/routes/typeform_mappings.ts');
 const original=readFileSync(route,'utf8');
 const run=()=>spawnSync(process.execPath,['--experimental-strip-types','--no-warnings','--import',join(copy.root,'cloudflare-worker/test/_ts-loader.mjs'),'--test',join(copy.root,'cloudflare-worker/test/typeform_mapping_http_5830.test.ts')],{cwd:copy.root,encoding:'utf8',timeout:120000});
 let result=run();assert.equal(result.status,0,result.stdout+result.stderr);console.log('control: PASS, exit 0');
 for(const [name,before,after] of [
  ['approval bypass',"if (c.env.TYPEFORM_APP_APPROVED !== '1')",'if (false)'],
  ['binding-owner bypass',"const currentScope = await scope(c, project);","const currentScope = await scope(c, project); currentScope.userId = 11;"],
  ['atomic revocation bypass','THEN 1 ELSE 0 END','THEN 1 ELSE 1 END']
 ]) {
  assert.ok(original.includes(before),name+' target exists');writeFileSync(route,original.replace(before,after));result=run();
  assert.notEqual(result.status,0,name+' survived');assert.match(result.stdout+result.stderr,/AssertionError/,name+' must fail a behavioral assertion, not imports/syntax');console.log(name+': KILLED, exit '+result.status);
 }
 writeFileSync(route,original);result=run();assert.equal(result.status,0,result.stdout+result.stderr);console.log('restored: PASS, exit 0');
} finally {copy.close();}
