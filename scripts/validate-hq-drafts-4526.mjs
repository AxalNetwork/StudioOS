/** D4526: validate the staged, newly authored HQ drafts without database or model calls. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { libraryEntries } from './build-skill-library.mjs';
import { checkLibrary, readLibrarySkill } from '../cloudflare-worker/src/services/agents/skillLibrarySeed.ts';
import { checkCase, judge } from '../cloudflare-worker/src/services/agents/skillLifecycle.ts';
import { READ_KEYS } from '../cloudflare-worker/src/services/agents/catalogue.ts';
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'documentation/skill-drafts/D4526');
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
const taxonomySql = readFileSync(resolve(root, 'cloudflare-worker/sql/migrations/090_seed_skills_values_taxonomy.sql'), 'utf8');
const taxonomy = new Set([...taxonomySql.matchAll(/\('([^']+)',\s*'(?:design|gtm_sales|marketing_brand|legal_compliance)'/g)].map(m=>m[1]));
const entries = libraryEntries(dir);
assert.equal(entries.length, manifest.skills.length);
assert.equal(entries.length, 70, 'D4526 owner-authorized batch size');
assert.equal(new Set(entries.map(e=>e.slug)).size, entries.length);
assert.equal(readdirSync(resolve(dir,'cases')).filter(f=>f.endsWith('.json')).length, entries.length);
const liveSlugs = new Set(libraryEntries().map(e=>e.slug.replaceAll('_','-')));
const results = checkLibrary(taxonomy, entries);
const counts = {};
let mutations = 0;
for (const [i,e] of entries.entries()) {
 const r=results[i];assert.ok(r.ok, `${e.slug}: ${JSON.stringify(r)}`);
 const m=manifest.skills.find(s=>s.slug===e.slug);assert.ok(m);
 counts[m.category]=(counts[m.category]??0)+1;
 assert.equal(e.slug,m.proposal_slug.replaceAll('_','-'));
 assert.ok(!liveSlugs.has(e.slug),`Repository duplicate: ${e.slug}`);
 assert.match(e.skill_md,/provenance: Newly authored.*not recovered or restored/);
 assert.match(e.skill_md,/\nscope: hq\nstatus: draft\ncurrent_version: 0\n/);
 const d=readLibrarySkill(e.skill_md);
 assert.deepEqual(d.roles,m.roles);
 assert.deepEqual(d.tags,[{slug:m.tag,level:'proficient'}]);
 assert.ok(d.steps.length>=6);
 const allowed = new Set(m.reads);
 for(const key of allowed){assert.ok(READ_KEYS.includes(key),key);assert.ok(d.tools.includes(key.split('.')[0]+'.read'),key);}
 for(const c of e.cases){
  const raw={name:e.slug+': golden case',input:c.input,expect:c.expect};assert.ok(checkCase(raw).ok);
  assert.equal(c.expect.output,d.output_kind);
  assert.deepEqual(Object.keys(c.input.records).sort(),[...allowed].sort());
  assert.equal(judge(c.expect,c.predicate_witness).result,'pass',e.slug);
  for(const word of c.expect.must_include){assert.equal(judge(c.expect,c.predicate_witness.replaceAll(word,'')).result,'fail',`${e.slug}: missing ${word}`);mutations++;}
  assert.equal(judge(c.expect,c.predicate_witness.replaceAll('Not recorded','Unknown')).result,'fail');mutations++;
  for(const word of c.expect.must_not_include){assert.equal(judge(c.expect,c.predicate_witness+' '+word).result,'fail');mutations++;}
  assert.equal(checkCase({...raw,input:{records:{}}}).ok,false);mutations++;
 }
 // Confirm the supported validator rejects malformed slugs and write grants.
 for(const [from,to] of [[`name: ${e.slug}`,`name: invalid_slug`],[`tools: [`,`tools: [grow.write, `]]){
  const bad=checkLibrary(taxonomy,[{...e,skill_md:e.skill_md.replace(from,to)}]);assert.equal(bad[0].ok,false);mutations++;
 }
}
assert.deepEqual(counts,{design:20,gtm_sales:15,legal_compliance:16,marketing_brand:19});
console.log(JSON.stringify({definitions:entries.length,cases:entries.length,counts,repository_slug_collisions:0,negative_checks:mutations,importer_validation:'passed',case_validation:'passed',model_evaluations:'not_run',d1_duplicate_check:'pending_before_import',production_writes:0},null,2));
